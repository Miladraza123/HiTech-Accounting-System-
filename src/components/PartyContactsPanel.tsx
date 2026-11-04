"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deletePartyContactAction, savePartyContactAction } from "@/app/actions/parties";
import { EMPTY_CONTACT, isPlausibleEmail, type PartyContactInput } from "@/lib/partyDetails";

export type PartyContactRow = { id: string; name: string; designation: string | null; phone: string | null; email: string | null; is_primary: boolean };

/**
 * Contact people of a client/supplier. The primary contact's name, phone and email are what the invoice print,
 * the service invoice and the quotation suggestions use. Anyone who can edit the party can add or change a
 * contact; only the Owner can remove one.
 */
export function PartyContactsPanel({ partyId, contacts, canEdit, canDelete }: { partyId: string; contacts: PartyContactRow[]; canEdit: boolean; canDelete: boolean }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<PartyContactInput>(EMPTY_CONTACT);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function open(c: PartyContactRow | null) {
    setError(null);
    setEditingId(c ? c.id : "new");
    setForm(c ? { name: c.name, designation: c.designation ?? "", phone: c.phone ?? "", email: c.email ?? "", is_primary: c.is_primary } : { ...EMPTY_CONTACT, is_primary: contacts.length === 0 });
  }

  function save() {
    setError(null);
    if (!form.name.trim()) {
      setError("The contact's name is required.");
      return;
    }
    if (!isPlausibleEmail(form.email)) {
      setError("That email address does not look right.");
      return;
    }
    startTransition(async () => {
      const res = await savePartyContactAction(partyId, editingId === "new" ? null : editingId, form);
      if (res.error) setError(res.error);
      else {
        setEditingId(null);
        router.refresh();
      }
    });
  }

  function remove(c: PartyContactRow) {
    if (!window.confirm(`Remove ${c.name}?`)) return;
    startTransition(async () => {
      const res = await deletePartyContactAction(partyId, c.id);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-ink">Contacts</h2>
          <p className="text-[11px] text-ink-faint">The primary contact&apos;s phone and email are printed on invoices.</p>
        </div>
        {canEdit && editingId === null && (
          <button type="button" onClick={() => open(null)} className="text-xs text-accent-ink underline underline-offset-2">
            + Add contact
          </button>
        )}
      </div>

      {contacts.length === 0 && editingId === null && <p className="text-xs text-ink-faint">No contact yet.</p>}

      <ul className="space-y-2">
        {contacts.map((c) =>
          editingId === c.id ? null : (
            <li key={c.id} className="flex items-start justify-between gap-3 rounded-md border border-line bg-bg px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="text-ink">
                  {c.name}
                  {c.designation ? <span className="text-ink-faint"> — {c.designation}</span> : null}
                  {c.is_primary && <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-mono text-accent-ink">Primary</span>}
                </p>
                <p className="text-xs text-ink-soft">{[c.phone, c.email].filter(Boolean).join(" · ") || "—"}</p>
              </div>
              {canEdit && (
                <div className="flex shrink-0 gap-3 text-xs">
                  <button type="button" onClick={() => open(c)} className="text-accent-ink underline underline-offset-2">
                    Edit
                  </button>
                  {canDelete && (
                    <button type="button" onClick={() => remove(c)} disabled={pending} className="text-bad underline underline-offset-2 disabled:opacity-50">
                      Remove
                    </button>
                  )}
                </div>
              )}
            </li>
          )
        )}
      </ul>

      {editingId !== null && (
        <div className="space-y-2 rounded-md border border-line bg-bg p-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="block space-y-1">
              <span className="text-[11px] text-ink-faint">Contact person *</span>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} maxLength={150} className="input !py-1.5 text-sm" />
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] text-ink-faint">Designation</span>
              <input value={form.designation} onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))} maxLength={100} className="input !py-1.5 text-sm" />
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] text-ink-faint">Phone</span>
              <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} maxLength={60} className="input !py-1.5 text-sm" />
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] text-ink-faint">Email</span>
              <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} maxLength={150} className="input !py-1.5 text-sm" />
            </label>
          </div>
          <label className="flex items-center gap-2 text-xs text-ink-soft">
            <input type="checkbox" checked={form.is_primary} onChange={(e) => setForm((f) => ({ ...f, is_primary: e.target.checked }))} />
            Primary contact (printed on invoices)
          </label>
          {error && <p className="text-xs text-bad">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setEditingId(null)} disabled={pending} className="rounded-md border border-line-strong bg-bg px-3 py-1 text-xs disabled:opacity-60">
              Cancel
            </button>
            <button type="button" onClick={save} disabled={pending} className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white disabled:opacity-60">
              {pending ? "Saving…" : "Save contact"}
            </button>
          </div>
        </div>
      )}
      {editingId === null && error && <p className="text-xs text-bad">{error}</p>}
    </div>
  );
}
