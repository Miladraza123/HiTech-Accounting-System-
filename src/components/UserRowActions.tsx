"use client";

import { useState, useTransition } from "react";
import {
  resetUserPasswordAction,
  deactivateUserAction,
  reactivateUserAction,
} from "@/app/actions/setup";
import { buttonClass } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { KeyRound, Copy, Check, UserX, UserCheck, X } from "lucide-react";

function generatePassword(): string {
  // Same scheme as InviteUserForm's generator — avoids visually-ambiguous
  // characters (0/O, 1/l/I) so it's easy to read back and retype by hand.
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
  const bytes = new Uint32Array(14);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

/**
 * Owner-only per-user row controls on the Users & Roles page:
 * reset password (Admin API, no email needed) and deactivate/reactivate
 * (bans the Auth account + flips profiles.is_active). `isSelf` hides the
 * deactivate control entirely — the server also refuses it, but there's
 * no reason to show a button that can only ever fail here.
 */
export function UserRowActions({
  userId,
  fullName,
  isActive,
  isSelf,
}: {
  userId: string;
  fullName: string;
  isActive: boolean;
  isSelf: boolean;
}) {
  const [resetOpen, setResetOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [resetDone, setResetDone] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submitReset() {
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    startTransition(async () => {
      const res = await resetUserPasswordAction(userId, password);
      if (res.error) {
        setError(res.error);
      } else {
        setResetDone(res.password ?? password);
        setResetOpen(false);
        setPassword("");
      }
    });
  }

  function toggleActive() {
    setError(null);
    startTransition(async () => {
      const res = isActive ? await deactivateUserAction(userId) : await reactivateUserAction(userId);
      if (res.error) setError(res.error);
      setConfirmingDeactivate(false);
    });
  }

  if (resetDone) {
    return (
      <div className="rounded-lg border border-good bg-good-soft p-3 space-y-2 max-w-xs">
        <p className="text-xs font-semibold text-good">New password — copy it now, it won&apos;t be shown again.</p>
        <p className="rounded-md border border-line bg-surface px-2 py-1.5 font-mono text-sm break-all">{resetDone}</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(resetDone).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
            className={buttonClass("secondary", "sm", "gap-1.5")}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" onClick={() => setResetDone(null)} className={buttonClass("primary", "sm")}>
            Done
          </button>
        </div>
      </div>
    );
  }

  if (resetOpen) {
    return (
      <div className="rounded-lg border border-line bg-surface p-3 space-y-2 max-w-xs">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-ink">Reset password for {fullName}</p>
          <button type="button" onClick={() => setResetOpen(false)} className="text-ink-faint hover:text-ink transition" aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            className="input flex-1 font-mono text-sm"
          />
          <button type="button" onClick={() => setPassword(generatePassword())} className={buttonClass("secondary", "sm")}>
            Generate
          </button>
        </div>
        {error && <p className="rounded-md bg-bad-soft px-2 py-1.5 text-xs text-bad">{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={submitReset} disabled={pending} className={buttonClass("primary", "sm")}>
            {pending ? "Saving…" : "Set Password"}
          </button>
          <button type="button" onClick={() => setResetOpen(false)} className={buttonClass("secondary", "sm")}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {!isActive && <Badge tone="bad">Inactive</Badge>}
      <button
        type="button"
        onClick={() => setResetOpen(true)}
        className={buttonClass("secondary", "sm", "gap-1")}
        title="Reset this user's password"
      >
        <KeyRound size={12} /> Reset Password
      </button>

      {!isSelf &&
        (confirmingDeactivate ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="text-xs text-ink-faint">Deactivate {fullName}?</span>
            <button type="button" disabled={pending} onClick={toggleActive} className={buttonClass("danger", "sm")}>
              {pending ? "…" : "Confirm"}
            </button>
            <button type="button" onClick={() => setConfirmingDeactivate(false)} className={buttonClass("secondary", "sm")}>
              Cancel
            </button>
          </span>
        ) : isActive ? (
          <button
            type="button"
            onClick={() => setConfirmingDeactivate(true)}
            className={buttonClass("secondary", "sm", "gap-1")}
            title="Block this user from logging in"
          >
            <UserX size={12} /> Deactivate
          </button>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={toggleActive}
            className={buttonClass("secondary", "sm", "gap-1")}
            title="Allow this user to log in again"
          >
            <UserCheck size={12} /> {pending ? "…" : "Reactivate"}
          </button>
        ))}

      {error && <p className="w-full text-xs text-bad">{error}</p>}
    </div>
  );
}
