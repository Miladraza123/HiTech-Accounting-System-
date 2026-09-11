"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateJobProgressAction, markJobReadyForDispatchAction, cancelJobAction } from "@/app/actions/jobs";

const TERMINAL = ["ReadyForDispatch", "Delivered", "Cancelled"];

export function JobStatusPanel({
  jobId,
  status,
  progressPct,
  canManage,
}: {
  jobId: string;
  status: string;
  progressPct: number;
  canManage: boolean;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState(String(progressPct));
  const [note, setNote] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!canManage) return null;

  const terminal = TERMINAL.includes(status);
  const canMarkReady = ["FabricationStarted", "InProcess"].includes(status);

  function submitProgress() {
    setError(null);
    const pct = Number(progress);
    if (Number.isNaN(pct) || pct < 0 || pct > 100) {
      setError("Progress 0-100 ke darmiyan honi chahiye.");
      return;
    }
    startTransition(async () => {
      const res = await updateJobProgressAction(jobId, pct, note.trim() || null);
      if (res.error) setError(res.error);
      else {
        setNote("");
        router.refresh();
      }
    });
  }

  function markReady() {
    setError(null);
    startTransition(async () => {
      const res = await markJobReadyForDispatchAction(jobId);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  function submitCancel() {
    setError(null);
    if (!reason.trim()) {
      setError("Cancel karne ki wajah likhna zaroori hai.");
      return;
    }
    startTransition(async () => {
      const res = await cancelJobAction(jobId, reason);
      if (res.error) setError(res.error);
      else {
        setCancelOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4 space-y-4">
      <h2 className="text-sm font-semibold text-ink">Actions</h2>

      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-xs text-bad">{error}</p>}

      {!terminal && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-ink-soft">Progress Update</p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              max="100"
              value={progress}
              onChange={(e) => setProgress(e.target.value)}
              className="input !py-1 text-xs w-20"
            />
            <span className="text-xs text-ink-faint">%</span>
          </div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Note (optional)" className="input resize-none text-xs" />
          <button
            type="button"
            onClick={submitProgress}
            disabled={pending}
            className="w-full rounded-md border border-line-strong bg-bg px-3 py-1.5 text-xs text-ink hover:bg-surface-2 transition disabled:opacity-60"
          >
            {pending ? "…" : "Progress Update Karen"}
          </button>
        </div>
      )}

      {canMarkReady && (
        <button
          type="button"
          onClick={markReady}
          disabled={pending}
          className="w-full rounded-md bg-good px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition disabled:opacity-60"
        >
          {pending ? "…" : "Ready for Dispatch Mark Karen"}
        </button>
      )}

      {!terminal &&
        (cancelOpen ? (
          <div className="space-y-2 rounded-md border border-bad bg-bad-soft p-3">
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Cancel karne ki wajah…" className="input resize-none text-xs" />
            <div className="flex gap-2">
              <button type="button" onClick={() => setCancelOpen(false)} className="flex-1 rounded-md border border-line-strong bg-bg px-2 py-1 text-xs">
                Wapis
              </button>
              <button
                type="button"
                onClick={submitCancel}
                disabled={pending}
                className="flex-1 rounded-md bg-bad px-2 py-1 text-xs font-medium text-white disabled:opacity-60"
              >
                {pending ? "…" : "Confirm Cancel"}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCancelOpen(true)}
            className="w-full rounded-md border border-bad text-bad bg-bg px-3 py-1.5 text-xs hover:bg-surface-2 transition"
          >
            Job Cancel Karen
          </button>
        ))}
    </div>
  );
}
