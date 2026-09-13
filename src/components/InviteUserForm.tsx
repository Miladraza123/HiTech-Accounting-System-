"use client";

import { useState, useTransition } from "react";
import { createUserAction, revokeInviteAction } from "@/app/actions/setup";
import { buttonClass } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ROLE_LABELS } from "@/lib/roles";
import { UserPlus, X, Copy, Check } from "lucide-react";

function generatePassword(): string {
  // Avoids visually-ambiguous characters (0/O, 1/l/I) so it's easy to
  // read back and retype by hand when handing it to someone.
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
  const bytes = new Uint32Array(14);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

/**
 * "+ New User" — the Owner sets the email and password directly and the
 * account is created instantly (via the Supabase Admin API — see
 * createUserAction). No self-signup step, no email sent: the Owner
 * copies the credentials shown after creation and hands them to the
 * new teammate, who logs in immediately with them.
 */
export function InviteUserForm({ allRoles }: { allRoles: { id: string; code: string }[] }) {
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [created, setCreated] = useState<{ email: string; password: string; fullName: string } | null>(null);
  const [copied, setCopied] = useState(false);

  if (created) {
    return (
      <div className="rounded-xl border border-good bg-good-soft p-5 space-y-3">
        <p className="text-sm font-semibold text-good">Account created — copy these now, they won&apos;t be shown again.</p>
        <div className="rounded-md border border-line bg-surface p-3 space-y-1.5 font-mono text-sm">
          <p>
            <span className="text-ink-faint">Email:</span> {created.email}
          </p>
          <p>
            <span className="text-ink-faint">Password:</span> {created.password}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(`Email: ${created.email}\nPassword: ${created.password}`).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
            className={buttonClass("secondary", "sm", "gap-1.5")}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy credentials"}
          </button>
          <button type="button" onClick={() => setCreated(null)} className={buttonClass("primary", "sm")}>
            Done
          </button>
        </div>
        <p className="text-xs text-ink-faint">
          Share these with {created.fullName} — they can log in immediately. There&apos;s no way to see this password
          again once you close this; if it&apos;s lost, create a new user record won&apos;t work (the email is now
          taken) — ask them to sign in and use Change Password instead once they have the current one, or contact
          support to reset it.
        </p>
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("primary", "sm", "gap-1.5")}>
        <UserPlus size={14} /> New User
      </button>
    );
  }

  function toggleRole(id: string) {
    setRoleIds((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));
  }

  function submit() {
    setError(null);
    if (!fullName.trim() || !email.trim()) {
      setError("Full name and email are required.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (roleIds.length === 0) {
      setError("Select at least one role for this user.");
      return;
    }
    startTransition(async () => {
      const formData = new FormData();
      formData.set("full_name", fullName.trim());
      formData.set("email", email.trim());
      formData.set("password", password);
      for (const id of roleIds) formData.append("role_ids", id);

      const res = await createUserAction({ error: null }, formData);
      if (res.error) {
        setError(res.error);
      } else {
        setCreated({ email: email.trim(), password, fullName: fullName.trim() });
        setOpen(false);
        setFullName("");
        setEmail("");
        setPassword("");
        setRoleIds([]);
      }
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">New User</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-ink-faint hover:text-ink transition" aria-label="Close">
          <X size={16} />
        </button>
      </div>

      <p className="text-xs text-ink-faint">
        Set their email and a password below — the account is created immediately. Share the credentials with them
        so they can log in; there&apos;s no separate sign-up step.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-ink-soft">Full name</span>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="input" />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-ink-soft">Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
        </label>
      </div>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-ink-soft">Password</span>
        <div className="flex gap-2">
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            className="input flex-1 font-mono"
          />
          <button type="button" onClick={() => setPassword(generatePassword())} className={buttonClass("secondary", "sm")}>
            Generate
          </button>
        </div>
      </label>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-ink-soft">Role(s)</p>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {allRoles.map((r) => (
            <label key={r.id} className="flex items-center gap-1.5 text-sm text-ink">
              <input
                type="checkbox"
                checked={roleIds.includes(r.id)}
                onChange={() => toggleRole(r.id)}
                className="h-3.5 w-3.5 accent-[var(--accent)]"
              />
              {ROLE_LABELS[r.code] ?? r.code}
            </label>
          ))}
        </div>
      </div>

      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}

      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={pending} className={buttonClass("primary", "sm")}>
          {pending ? "Creating…" : "Create User"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={buttonClass("secondary", "sm")}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function PendingInviteRow({
  invite,
}: {
  invite: { id: string; email: string; full_name: string; role_ids: string[] };
}) {
  const [pending, startTransition] = useTransition();

  function revoke() {
    startTransition(async () => {
      await revokeInviteAction(invite.id);
    });
  }

  return (
    <div className="px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
      <div>
        <p className="text-sm text-ink font-medium">{invite.full_name}</p>
        <p className="text-xs text-ink-faint">{invite.email}</p>
      </div>
      <div className="flex items-center gap-2">
        <Badge tone="warn">Pending — account not created</Badge>
        <button type="button" disabled={pending} onClick={revoke} className="text-xs text-bad underline underline-offset-2 disabled:opacity-50">
          Revoke
        </button>
      </div>
    </div>
  );
}
