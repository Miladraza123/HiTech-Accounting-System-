"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buttonClass } from "@/components/ui/Button";

/**
 * Self-service Two-Factor Authentication (TOTP) enrollment, on the
 * Account page — available to every signed-in user (Owner included,
 * since financial data here isn't only theirs to protect), following
 * Supabase's own documented enroll -> challenge -> verify flow. Entirely
 * client-side: enroll/challenge/verify/unenroll are plain GoTrue calls
 * against the signed-in user's own session, no service role or server
 * action needed. Server-side enforcement of an enabled factor happens
 * separately — see signInAction and getCurrentUser()'s AAL check.
 */
export function TwoFactorSettings() {
  const [supabase] = useState(() => createClient());
  const [loading, setLoading] = useState(true);
  const [verifiedFactorId, setVerifiedFactorId] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [qr, setQr] = useState("");
  const [pendingFactorId, setPendingFactorId] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingDisable, setConfirmingDisable] = useState(false);

  // Doesn't reset `loading` back to true on later calls (after enroll/
  // disable) — only the initial mount needs the "Loading…" placeholder;
  // updating verifiedFactorId directly afterward is smoother than
  // flashing that placeholder again.
  async function refreshFactors() {
    const { data, error: listError } = await supabase.auth.mfa.listFactors();
    if (!listError) {
      const verified = data.totp.find((f) => f.status === "verified");
      setVerifiedFactorId(verified?.id ?? null);
    }
    setLoading(false);
  }

  useEffect(() => {
    // Deferred to a microtask rather than called directly in the effect
    // body, so its state updates happen strictly after this render has
    // committed (same pattern as OfflineQueueProvider's `reconcile`).
    queueMicrotask(refreshFactors);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startEnroll() {
    setError(null);
    setBusy(true);
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    setBusy(false);
    if (enrollError) {
      setError(enrollError.message);
      return;
    }
    setPendingFactorId(data.id);
    setQr(data.totp.qr_code);
    setEnrolling(true);
  }

  async function confirmEnroll() {
    setError(null);
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: pendingFactorId });
    if (challengeError) {
      setBusy(false);
      setError(challengeError.message);
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: pendingFactorId,
      challengeId: challenge.id,
      code: code.trim(),
    });
    setBusy(false);
    if (verifyError) {
      setError(verifyError.message);
      return;
    }
    setEnrolling(false);
    setCode("");
    setQr("");
    setPendingFactorId("");
    await refreshFactors();
  }

  async function cancelEnroll() {
    // Clean up the not-yet-verified factor so it doesn't linger unused.
    if (pendingFactorId) await supabase.auth.mfa.unenroll({ factorId: pendingFactorId });
    setEnrolling(false);
    setQr("");
    setCode("");
    setPendingFactorId("");
    setError(null);
  }

  async function disable() {
    if (!verifiedFactorId) return;
    setBusy(true);
    const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: verifiedFactorId });
    setBusy(false);
    if (unenrollError) {
      setError(unenrollError.message);
      return;
    }
    setConfirmingDisable(false);
    await refreshFactors();
  }

  if (loading) return <p className="text-sm text-ink-faint">Loading…</p>;

  if (enrolling) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-ink-soft">
          Scan this QR code with an authenticator app (Google Authenticator, Authy, 1Password, etc.), then enter the
          6-digit code it shows.
        </p>
        {qr && (
          // eslint-disable-next-line @next/next/no-img-element -- Supabase returns a data: URL SVG, not a static asset Next's Image component can optimize.
          <img src={qr} alt="Scan this QR code with your authenticator app" className="h-40 w-40 rounded-md border border-line bg-white p-2" />
        )}
        <label className="block space-y-1.5 max-w-xs">
          <span className="text-xs font-medium text-ink-soft">6-digit code</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            className="input font-mono tracking-widest"
            placeholder="000000"
          />
        </label>
        {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={confirmEnroll} disabled={busy} className={buttonClass("primary", "sm")}>
            {busy ? "Verifying…" : "Enable"}
          </button>
          <button type="button" onClick={cancelEnroll} disabled={busy} className={buttonClass("secondary", "sm")}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (verifiedFactorId) {
    return (
      <div className="space-y-3">
        <p className="rounded-md bg-good-soft px-3 py-2 text-sm text-good">Two-factor authentication is ON.</p>
        {confirmingDisable ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-faint">Turn off two-factor authentication?</span>
            <button type="button" disabled={busy} onClick={disable} className={buttonClass("danger", "sm")}>
              {busy ? "…" : "Confirm"}
            </button>
            <button type="button" onClick={() => setConfirmingDisable(false)} className={buttonClass("secondary", "sm")}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmingDisable(true)} className={buttonClass("secondary", "sm")}>
            Disable
          </button>
        )}
        {error && <p className="text-xs text-bad">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-soft">
        Add an extra layer of security — after your password, you&apos;ll also need a 6-digit code from an
        authenticator app to sign in.
      </p>
      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
      <button type="button" onClick={startEnroll} disabled={busy} className={buttonClass("primary", "sm")}>
        {busy ? "Starting…" : "Enable Two-Factor Authentication"}
      </button>
    </div>
  );
}
