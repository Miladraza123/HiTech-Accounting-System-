"use server";

import { createClient } from "@/lib/supabase/server";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  WEAK_PASSWORD_COOKIE,
  encodeWeakPasswordReasons,
  weakPasswordErrorMessage,
} from "@/lib/passwordFeedback";

const SESSION_COOKIE = "app_login_session_id";

export type ActionState = { error: string | null };

export async function signInAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter both email and password." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: error.message };
  }

  // Signing in with a weak or breached password is NOT refused by Supabase --
  // the session is created and `error` stays null, with the finding attached to
  // `data.weakPassword` instead. Reading it here is the only way anyone ever
  // learns about it; the app layout turns this cookie into a banner. Written on
  // every sign-in, so it also clears itself once the password is fixed.
  const cookieStore = await cookies();
  const weakReasons = data.weakPassword?.reasons ?? [];
  if (weakReasons.length) {
    cookieStore.set(WEAK_PASSWORD_COOKIE, encodeWeakPasswordReasons(weakReasons), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
  } else {
    cookieStore.delete(WEAK_PASSWORD_COOKIE);
  }

  // Log this session (login_sessions) and remember its id for logout.
  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
  const device = hdrs.get("user-agent") ?? undefined;

  const { data: sessionId } = await supabase.rpc("fn_log_login", {
    p_ip: ip,
    p_device: device,
  });

  if (sessionId) {
    cookieStore.set(SESSION_COOKIE, sessionId as string, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
  }

  // Password verified — but if this account has Two-Factor Authentication
  // enabled, the session is still only aal1 at this point and must not be
  // treated as fully signed in yet. getAuthenticatorAssuranceLevel() reads
  // this straight off the session's JWT claims (no network round trip),
  // so this adds no real latency to a normal login.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.nextLevel === "aal2" && aal.nextLevel !== aal.currentLevel) {
    redirect("/mfa-challenge");
  }

  redirect("/");
}

export async function signUpAction(
  _prevState: ActionState,
  formData: FormData
): Promise<{ error: string | null; message: string | null }> {
  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!fullName || !email || !password) {
    return { error: "All fields are required.", message: null };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters.", message: null };
  }
  if (password !== confirm) {
    return { error: "Password and confirmation don't match.", message: null };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });

  if (error) {
    return { error: error.message, message: null };
  }

  if (!data.session) {
    return {
      error: null,
      message:
        "Account created. Check your email — you can log in after clicking the confirmation link.",
    };
  }

  redirect("/bootstrap");
}

export async function signOutAction() {
  const supabase = await createClient();
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;

  if (sessionId) {
    await supabase.rpc("fn_log_logout", { p_session_id: sessionId });
    cookieStore.delete(SESSION_COOKIE);
  }

  await supabase.auth.signOut();
  redirect("/login");
}

export async function bootstrapOwnerAction(
  _prevState: ActionState,
  _formData: FormData
): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_bootstrap_owner");
  if (error) {
    return { error: error.message };
  }
  redirect("/");
}

export type ChangePasswordState = { error: string | null; success?: boolean };

// Available to every signed-in user (Owner included) — Supabase has no
// separate "verify this is really my current password" API, so the
// accepted pattern is to re-authenticate with it via signInWithPassword
// first; only once that succeeds is the password actually changed.
export async function changePasswordAction(
  _prevState: ChangePasswordState,
  formData: FormData
): Promise<ChangePasswordState> {
  const currentPassword = String(formData.get("current_password") ?? "");
  const newPassword = String(formData.get("new_password") ?? "");
  const confirm = String(formData.get("confirm_password") ?? "");

  if (!currentPassword || !newPassword) {
    return { error: "Enter your current and new password." };
  }
  if (newPassword.length < 8) {
    return { error: "New password must be at least 8 characters." };
  }
  if (newPassword !== confirm) {
    return { error: "New password and confirmation don't match." };
  }
  if (newPassword === currentPassword) {
    return { error: "New password must be different from your current password." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) {
    return { error: "You must be logged in to change your password." };
  }

  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (verifyError) {
    return { error: "Current password is incorrect." };
  }

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) {
    // A password refused for being weak or breached gets the app's own wording;
    // anything else is reported as Supabase phrased it.
    return { error: weakPasswordErrorMessage(updateError) ?? updateError.message };
  }

  // Recorded for the Activity Log (Phase 35) — this is a Supabase Auth API
  // call, not a write to any `public` schema row, so nothing here would
  // otherwise leave a trail. Best-effort: a logging failure must never turn
  // an already-successful password change into a reported error.
  await supabase.rpc("fn_log_password_change", { p_subject_user_id: user.id, p_self_change: true });

  // The password just cleared Supabase's own rules, so whatever the sign-in
  // banner was warning about no longer applies.
  const cookieStore = await cookies();
  cookieStore.delete(WEAK_PASSWORD_COOKIE);

  return { error: null, success: true };
}

// Clears the "your password should be changed" banner for this browser. The
// warning is rewritten on every sign-in, so dismissing it hides it until the
// next login rather than for good -- the finding itself is not dismissable,
// only the reminder.
export async function dismissWeakPasswordWarningAction(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(WEAK_PASSWORD_COOKIE);
  revalidatePath("/", "layout");
}
