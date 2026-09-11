"use server";

import { createClient } from "@/lib/supabase/server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

const SESSION_COOKIE = "app_login_session_id";

export type ActionState = { error: string | null };

export async function signInAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email aur password dono likhen." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: error.message };
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
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE, sessionId as string, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
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
    return { error: "Sab fields zaroori hain.", message: null };
  }
  if (password.length < 8) {
    return { error: "Password kam az kam 8 characters ka hona chahiye.", message: null };
  }
  if (password !== confirm) {
    return { error: "Password aur confirmation match nahi karte.", message: null };
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
        "Account ban gaya. Apna email check karen — confirmation link pe click karne ke baad login kar sakte hain.",
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
