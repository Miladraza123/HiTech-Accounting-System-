"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * The one place in the app that completes a Two-Factor Authentication
 * challenge — reached right after a password-only sign-in when the
 * account has a verified TOTP factor (see signInAction / getCurrentUser's
 * AAL check). Entirely client-side: listFactors -> challenge -> verify,
 * exactly as Supabase's own documented flow. On success the session's
 * JWT itself carries aal2 from then on, so this never needs repeating
 * until the next sign-out/sign-in.
 */
export function MfaChallengeForm() {
  const router = useRouter();
  const supabase = createClient();
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setPending(true);
    try {
      const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
      if (factorsError) throw factorsError;
      const factor = factors.totp.find((f) => f.status === "verified");
      if (!factor) throw new Error("No two-factor device is set up on this account.");

      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: factor.id });
      if (challengeError) throw challengeError;

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: factor.id,
        challengeId: challenge.id,
        code: code.trim(),
      });
      if (verifyError) throw verifyError;

      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-line bg-surface p-6 shadow-sm space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="code" className="text-xs font-medium text-ink-soft">
          6-digit code
        </label>
        <input
          id="code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          className="w-full rounded-md border border-line bg-bg px-3 py-2 text-center text-lg font-mono tracking-[0.3em] text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          placeholder="000000"
        />
      </div>

      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Verifying…" : "Verify"}
      </button>
    </form>
  );
}
