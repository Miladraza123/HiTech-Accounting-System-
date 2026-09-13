import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MfaChallengeForm } from "@/components/MfaChallengeForm";

// Deliberately does NOT use getCurrentUser() — that helper now returns
// null for exactly the aal1-but-needs-aal2 session this page exists to
// handle, which would otherwise bounce straight back to /login. Checked
// directly here instead: no session at all -> /login; already at the
// required level (no MFA enrolled, or already completed) -> just go in.
export default async function MfaChallengePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const needsChallenge = !!aal && aal.nextLevel === "aal2" && aal.nextLevel !== aal.currentLevel;
  if (!needsChallenge) redirect("/");

  return (
    <main className="min-h-screen flex items-center justify-center bg-bg px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-ledger text-ledger-soft font-mono text-lg font-semibold">
            H
          </div>
          <h1 className="mt-4 text-xl font-semibold text-ink">Two-Factor Authentication</h1>
          <p className="mt-1 text-sm text-ink-soft">Enter the 6-digit code from your authenticator app to finish signing in.</p>
        </div>

        <MfaChallengeForm />
      </div>
    </main>
  );
}
