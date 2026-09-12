"use client";

import { useState, useTransition } from "react";
import { inviteUserAction, revokeInviteAction } from "@/app/actions/setup";
import { buttonClass } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ROLE_LABELS } from "@/lib/roles";
import { UserPlus, X } from "lucide-react";

/**
 * "+ New User" — Owner invites a teammate by email + name + role(s).
 * There's no Supabase Service Role key configured in this app, so an
 * account can't be created instantly from the server; this stores a
 * pending invite instead. The moment the invited person signs up with
 * the same email at /signup, a DB trigger applies the role(s) picked
 * here automatically — see fn_handle_new_user in the Phase 20 migration.
 */
export function InviteUserForm({ allRoles }: { allRoles: { id: string; code: string }[] }) {
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
    if (roleIds.length === 0) {
      setError("Select at least one role for this user.");
      return;
    }
    startTransition(async () => {
      const formData = new FormData();
      formData.set("full_name", fullName.trim());
      formData.set("email", email.trim());
      for (const id of roleIds) formData.append("role_ids", id);

      const res = await inviteUserAction({ error: null }, formData);
      if (res.error) {
        setError(res.error);
      } else {
        setOpen(false);
        setFullName("");
        setEmail("");
        setRoleIds([]);
      }
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Invite a new user</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-ink-faint hover:text-ink transition" aria-label="Close">
          <X size={16} />
        </button>
      </div>

      <p className="text-xs text-ink-faint">
        They&apos;ll get access as soon as they sign up at <span className="font-mono">/signup</span> with this exact
        email — the role(s) below are applied automatically at that point.
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
          {pending ? "Inviting…" : "Send Invite"}
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
        <Badge tone="warn">Pending signup</Badge>
        <button type="button" disabled={pending} onClick={revoke} className="text-xs text-bad underline underline-offset-2 disabled:opacity-50">
          Revoke
        </button>
      </div>
    </div>
  );
}
