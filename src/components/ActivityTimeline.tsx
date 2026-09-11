"use client";

import { useRef, useState, useTransition } from "react";
import { addActivityNoteAction } from "@/app/actions/queries";

type ActivityRow = {
  id: string;
  event_type: string;
  note: string | null;
  at: string;
  actor_name: string;
};

const EVENT_STYLE: Record<string, string> = {
  note: "bg-ledger-soft text-ledger",
  status_change: "bg-warn-soft text-warn",
  followup: "bg-accent-soft text-accent-ink",
  system: "bg-surface-2 text-ink-faint",
};

export function ActivityTimeline({
  ownerTable,
  ownerId,
  revalidateTo,
  events,
  canAdd,
}: {
  ownerTable: string;
  ownerId: string;
  revalidateTo: string;
  events: ActivityRow[];
  canAdd: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const [followup, setFollowup] = useState("");

  function submit(formData: FormData) {
    const note = String(formData.get("note") ?? "").trim();
    if (!note) return;
    startTransition(async () => {
      await addActivityNoteAction(ownerTable, ownerId, note, followup || null, revalidateTo);
      formRef.current?.reset();
      setFollowup("");
    });
  }

  return (
    <div className="space-y-4">
      {canAdd && (
        <form ref={formRef} action={submit} className="rounded-xl border border-line bg-surface p-4 space-y-2">
          <textarea name="note" rows={2} placeholder="Follow-up note likhen…" required className="input resize-none" />
          <div className="flex items-center gap-3">
            <label className="text-xs text-ink-faint">Next follow-up:</label>
            <input
              type="date"
              value={followup}
              onChange={(e) => setFollowup(e.target.value)}
              className="input !w-auto text-xs"
            />
            <button
              type="submit"
              disabled={pending}
              className="ml-auto rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition disabled:opacity-60"
            >
              {pending ? "…" : "Add karen"}
            </button>
          </div>
        </form>
      )}

      <ul className="space-y-2">
        {events.map((e) => (
          <li key={e.id} className="flex gap-3 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm">
            <span className={`shrink-0 h-fit rounded-full px-2 py-0.5 text-[10px] font-mono uppercase ${EVENT_STYLE[e.event_type] ?? ""}`}>
              {e.event_type}
            </span>
            <div className="min-w-0">
              <p className="text-ink">{e.note}</p>
              <p className="text-[11px] text-ink-faint mt-0.5">
                {e.actor_name} · {new Date(e.at).toLocaleString("en-PK")}
              </p>
            </div>
          </li>
        ))}
        {!events.length && <li className="text-xs text-ink-faint">Koi activity nahi hui abhi tak.</li>}
      </ul>
    </div>
  );
}
