"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * A label/value pair that turns into a text input on click, for a single
 * free-edit external-reference field (a typo fix, not a workflow action) —
 * e.g. a Sales Order's Client PO Number, a Service Job's Client's DC No.,
 * a Supplier Bill's Supplier Bill Ref. `onSave` is a bound Server Action
 * reference, not a plain closure (Server Components can't pass a plain
 * arrow function to a Client Component).
 */
export function InlineFieldEdit({
  label,
  value,
  placeholder = "—",
  onSave,
}: {
  label: string;
  value: string | null;
  placeholder?: string;
  onSave: (next: string) => Promise<{ error: string | null }>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <div>
        <div className="flex items-center gap-2">
          <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">{label}</p>
          <button
            type="button"
            onClick={() => {
              setDraft(value ?? "");
              setError(null);
              setEditing(true);
            }}
            className="text-[11px] text-accent-ink underline underline-offset-2 hover:opacity-80"
          >
            Edit
          </button>
        </div>
        <p className="text-ink mt-0.5">{value || placeholder}</p>
      </div>
    );
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await onSave(draft.trim());
      if (res.error) {
        setError(res.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <div>
      <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="input !py-1 text-sm"
          autoFocus
        />
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 transition disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={pending}
          className="rounded-md border border-line-strong px-2.5 py-1 text-xs text-ink hover:bg-surface-2 transition"
        >
          Cancel
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-bad">{error}</p>}
    </div>
  );
}
