"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCreditTermsAction } from "@/app/actions/parties";
import { diffFields, type SmartMergeConflict } from "@/lib/smartMerge";
import { useOfflineQueue } from "@/components/OfflineQueueProvider";

const FIELD_LABEL: Record<string, string> = {
  credit_limit: "Credit Limit",
  credit_days: "Credit Days",
};

export function EditCreditTermsForm({
  partyId,
  partyName,
  creditLimit,
  creditDays,
}: {
  partyId: string;
  partyName: string;
  creditLimit: number;
  creditDays: number;
}) {
  const router = useRouter();
  const { isOnline, enqueue } = useOfflineQueue();
  const [open, setOpen] = useState(false);
  const [queuedOffline, setQueuedOffline] = useState(false);
  // `base` is what this tab believes is currently saved — it starts as the
  // page's loaded values and advances whenever a conflict is resolved by
  // accepting the server's value for that one field (Smart Merge).
  const [base, setBase] = useState({ creditLimit, creditDays });
  const [limit, setLimit] = useState(String(creditLimit));
  const [days, setDays] = useState(String(creditDays));
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<SmartMergeConflict[]>([]);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setOpen(true)} className="text-xs text-accent-ink underline underline-offset-2">
          Edit credit terms
        </button>
        {queuedOffline && <span className="text-[11px] text-warn">⏳ Saved offline — waiting to sync</span>}
      </div>
    );
  }

  function submit() {
    setError(null);
    const next = { creditLimit: Number(limit) || 0, creditDays: Number(days) || 0 };

    // Offline: queue the write for later instead of failing outright. It
    // will be replayed through the exact same Smart Merge RPC the moment
    // connectivity returns — never a blind overwrite.
    if (!isOnline) {
      startTransition(async () => {
        const changes = diffFields(
          { credit_limit: base.creditLimit, credit_days: base.creditDays },
          { credit_limit: next.creditLimit, credit_days: next.creditDays }
        );
        if (Object.keys(changes).length > 0) {
          await enqueue({
            kind: "edit",
            table: "parties",
            rowId: partyId,
            label: `${partyName} — Credit Terms`,
            base: { credit_limit: base.creditLimit, credit_days: base.creditDays },
            changes,
          });
        }
        setQueuedOffline(true);
        setOpen(false);
      });
      return;
    }

    startTransition(async () => {
      const res = await updateCreditTermsAction(partyId, base, next);
      if (res.error) {
        setError(res.error);
      } else if (res.conflicts && res.conflicts.length > 0) {
        // Every non-conflicting field the user changed was already saved —
        // only the genuinely colliding field(s) still need a decision.
        setConflicts(res.conflicts);
      } else {
        setConflicts([]);
        setOpen(false);
        router.refresh();
      }
    });
  }

  function resolveConflict(conflict: SmartMergeConflict, choice: "mine" | "theirs") {
    const serverValue = Number(conflict.server_value);
    if (conflict.field === "credit_limit") {
      setBase((b) => ({ ...b, creditLimit: serverValue }));
      if (choice === "theirs") setLimit(String(serverValue));
    } else if (conflict.field === "credit_days") {
      setBase((b) => ({ ...b, creditDays: serverValue }));
      if (choice === "theirs") setDays(String(serverValue));
    }
    setConflicts((cs) => cs.filter((c) => c.field !== conflict.field));
  }

  return (
    <div className="space-y-2 rounded-md border border-line bg-bg p-3">
      {conflicts.length > 0 && (
        <div className="space-y-2 rounded-md border border-warn bg-warn-soft p-2 text-xs text-ink">
          <p className="font-medium text-warn">
            Someone else changed this field in the meantime — you can only keep one value at a time:
          </p>
          {conflicts.map((c) => (
            <div key={c.field} className="space-y-1 rounded border border-line-strong bg-bg p-2">
              <p className="text-ink-soft">
                <span className="font-medium">{FIELD_LABEL[c.field] ?? c.field}</span> — Server:{" "}
                <span className="font-mono">{String(c.server_value)}</span>, Your value:{" "}
                <span className="font-mono">{String(c.my_value)}</span>
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => resolveConflict(c, "mine")}
                  className="flex-1 rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-white"
                >
                  Keep my value
                </button>
                <button
                  type="button"
                  onClick={() => resolveConflict(c, "theirs")}
                  className="flex-1 rounded-md border border-line-strong bg-bg px-2 py-1 text-[11px]"
                >
                  Keep server value
                </button>
              </div>
            </div>
          ))}
          <p className="text-ink-faint">Once you decide, click &quot;Save&quot; again.</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1">
          <span className="text-[11px] text-ink-faint">Credit Limit</span>
          <input type="number" step="0.01" min="0" value={limit} onChange={(e) => setLimit(e.target.value)} className="input !py-1 text-xs" />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] text-ink-faint">Credit Days</span>
          <input type="number" step="1" min="0" value={days} onChange={(e) => setDays(e.target.value)} className="input !py-1 text-xs" />
        </label>
      </div>
      {error && <p className="text-xs text-bad">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setConflicts([]);
          }}
          className="flex-1 rounded-md border border-line-strong bg-bg px-2 py-1 text-xs"
        >
          Back
        </button>
        <button type="button" onClick={submit} disabled={pending} className="flex-1 rounded-md bg-accent px-2 py-1 text-xs font-medium text-white disabled:opacity-60">
          {pending ? "…" : "Save"}
        </button>
      </div>
    </div>
  );
}
