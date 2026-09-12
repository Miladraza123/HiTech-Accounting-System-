"use client";

import { useState, useTransition } from "react";
import {
  getRestorePlanAction,
  commitRestoreAction,
  getSafetySnapshotAction,
  type RestorePlanRow,
  type RestoreTableOutcome,
} from "@/app/actions/backupRestore";

type Mode = "merge" | "replace";

function downloadJson(filename: string, json: string) {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function RestoreBackupPanel() {
  const [fileText, setFileText] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ data_date?: string; taken_at_karachi?: string; missed?: string[] } | null>(null);
  const [plan, setPlan] = useState<RestorePlanRow[] | null>(null);
  const [mode, setMode] = useState<Mode>("merge");
  const [snapshotDownloaded, setSnapshotDownloaded] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [outcomes, setOutcomes] = useState<RestoreTableOutcome[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setFileText(null);
    setFileName(null);
    setMeta(null);
    setPlan(null);
    setSnapshotDownloaded(false);
    setConfirmText("");
    setOutcomes(null);
    setError(null);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    reset();
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setFileText(text);
      startTransition(async () => {
        const res = await getRestorePlanAction(text);
        if (res.error) {
          setError(res.error);
          return;
        }
        setMeta(res.meta ?? null);
        setPlan(res.plan ?? null);
      });
    };
    reader.readAsText(file);
  }

  function downloadSafetySnapshot() {
    startTransition(async () => {
      const res = await getSafetySnapshotAction();
      if (res.error || !res.json) {
        setError(res.error ?? "Failed to create safety snapshot.");
        return;
      }
      downloadJson(`HiTech-Before-Restore-${new Date().toISOString().slice(0, 10)}.json`, res.json);
      setSnapshotDownloaded(true);
    });
  }

  function commit() {
    if (!fileText || confirmText !== "RESTORE") return;
    startTransition(async () => {
      const res = await commitRestoreAction(fileText, mode);
      setOutcomes(res.outcomes ?? []);
      setError(res.error);
    });
  }

  const totals = plan?.reduce(
    (acc, p) => ({
      to_add: acc.to_add + p.to_add,
      to_update: acc.to_update + p.to_update,
      to_delete: acc.to_delete + p.to_delete_if_replace,
    }),
    { to_add: 0, to_update: 0, to_delete: 0 }
  );

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-line bg-surface p-5">
        <h2 className="text-sm font-semibold text-ink mb-3">Upload Restore File</h2>
        <p className="text-sm text-ink-soft mb-3">
          Upload the <code className="font-mono text-xs">HiTech-Restore-YYYY-MM-DD.json</code> file received from the Daily Backup email here.
        </p>
        <input
          type="file"
          accept="application/json,.json"
          onChange={onFileChange}
          className="block w-full text-sm text-ink-soft file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-bg file:px-3 file:py-1.5 file:text-xs file:text-ink hover:file:bg-surface-2"
        />
        {fileName && <p className="mt-2 text-xs text-ink-faint">Selected: {fileName}</p>}
      </div>

      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}

      {meta && (
        <div className="rounded-xl border border-line bg-surface p-5 text-sm">
          <p className="text-ink-soft">
            This file contains data for <span className="text-ink font-medium">{meta.data_date ?? "—"}</span> — taken at:{" "}
            <span className="text-ink">{meta.taken_at_karachi ?? "—"}</span>
          </p>
          {!!meta.missed?.length && (
            <p className="mt-1 text-warn">⚠ This file does not include the following tables (they failed during the backup): {meta.missed.join(", ")}</p>
          )}
        </div>
      )}

      {plan && totals && (
        <>
          <div className="rounded-xl border border-line bg-surface p-5">
            <h2 className="text-sm font-semibold text-ink mb-3">Restore Plan — Review Before Committing</h2>
            <div className="flex gap-2 mb-4">
              <label className={`flex-1 rounded-md border px-3 py-2 text-sm cursor-pointer ${mode === "merge" ? "border-accent bg-accent-soft/30" : "border-line"}`}>
                <input type="radio" name="mode" checked={mode === "merge"} onChange={() => setMode("merge")} className="mr-2 accent-accent" />
                <span className="font-medium text-ink">Merge (Safe)</span>
                <p className="text-xs text-ink-faint mt-0.5">Only what is missing will be added — no existing row will be touched.</p>
              </label>
              <label className={`flex-1 rounded-md border px-3 py-2 text-sm cursor-pointer ${mode === "replace" ? "border-bad bg-bad-soft/30" : "border-line"}`}>
                <input type="radio" name="mode" checked={mode === "replace"} onChange={() => setMode("replace")} className="mr-2 accent-bad" />
                <span className="font-medium text-bad">Replace (Destructive)</span>
                <p className="text-xs text-ink-faint mt-0.5">The database will become an exact match of the file — anything not in the file will be deleted.</p>
              </label>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="rounded-lg border border-line bg-bg p-3 text-center">
                <p className="text-xl font-semibold text-good tabular">+{totals.to_add}</p>
                <p className="text-[11px] text-ink-faint uppercase font-mono">Rows To Be Added</p>
              </div>
              <div className="rounded-lg border border-line bg-bg p-3 text-center">
                <p className="text-xl font-semibold text-warn tabular">{mode === "replace" ? totals.to_update : 0}</p>
                <p className="text-[11px] text-ink-faint uppercase font-mono">{mode === "replace" ? "Rows To Be Updated" : "Will Be Skipped (already exist)"}</p>
              </div>
              <div className="rounded-lg border border-line bg-bg p-3 text-center">
                <p className={`text-xl font-semibold tabular ${mode === "replace" && totals.to_delete > 0 ? "text-bad" : "text-ink-faint"}`}>
                  {mode === "replace" ? totals.to_delete : 0}
                </p>
                <p className="text-[11px] text-ink-faint uppercase font-mono">Rows To Be Deleted</p>
              </div>
            </div>

            <div className="overflow-x-auto max-h-80 overflow-y-auto rounded-md border border-line">
              <table className="w-full text-xs">
                <thead className="bg-surface-2 font-mono uppercase tracking-wide text-ink-faint sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2">Table</th>
                    <th className="text-right px-3 py-2">Incoming</th>
                    <th className="text-right px-3 py-2">Add</th>
                    <th className="text-right px-3 py-2">Update</th>
                    <th className="text-right px-3 py-2">Existing</th>
                    <th className="text-right px-3 py-2">Delete (Replace)</th>
                  </tr>
                </thead>
                <tbody>
                  {plan
                    .filter((p) => p.incoming > 0 || p.existing_total > 0)
                    .map((p) => (
                      <tr key={p.table} className="border-t border-line">
                        <td className="px-3 py-1.5 text-ink font-mono">{p.table}</td>
                        <td className="px-3 py-1.5 text-right tabular text-ink-soft">{p.incoming}</td>
                        <td className="px-3 py-1.5 text-right tabular text-good">{p.to_add || "—"}</td>
                        <td className="px-3 py-1.5 text-right tabular text-warn">{p.to_update || "—"}</td>
                        <td className="px-3 py-1.5 text-right tabular text-ink-soft">{p.existing_total}</td>
                        <td className="px-3 py-1.5 text-right tabular text-bad">{p.to_delete_if_replace || "—"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border border-bad bg-bad-soft/20 p-5 space-y-4">
            <h2 className="text-sm font-semibold text-bad">Before You Commit</h2>
            {!snapshotDownloaded ? (
              <button
                type="button"
                onClick={downloadSafetySnapshot}
                disabled={pending}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-50"
              >
                1. First Download a Safety Snapshot of Current Data
              </button>
            ) : (
              <p className="text-sm text-good">✓ Safety snapshot has been downloaded.</p>
            )}

            {snapshotDownloaded && (
              <div>
                <label className="block text-sm text-ink mb-1.5">
                  2. Type <span className="font-mono font-semibold">RESTORE</span> below to confirm:
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  className="input max-w-xs"
                  placeholder="RESTORE"
                />
              </div>
            )}

            <button
              type="button"
              onClick={commit}
              disabled={!snapshotDownloaded || confirmText !== "RESTORE" || pending}
              className="rounded-md bg-bad px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {pending ? "Restoring…" : `3. Commit ${mode === "replace" ? "Replace" : "Merge"} Restore`}
            </button>
          </div>
        </>
      )}

      {outcomes && (
        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          <div className="px-4 py-2.5 border-b border-line">
            <h2 className="text-sm font-semibold text-ink">Restore Report</h2>
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-surface-2 font-mono uppercase tracking-wide text-ink-faint sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2">Table</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-right px-3 py-2">Rows</th>
                  <th className="text-left px-3 py-2">Detail</th>
                </tr>
              </thead>
              <tbody>
                {outcomes.map((o, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="px-3 py-1.5 text-ink font-mono">{o.table}</td>
                    <td className="px-3 py-1.5">
                      <span className={`rounded-full px-2 py-0.5 font-mono ${o.ok ? "bg-good-soft text-good" : "bg-bad-soft text-bad"}`}>
                        {o.ok ? "OK" : "FAILED"}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular text-ink-soft">{o.added_or_updated ?? o.deleted ?? "—"}</td>
                    <td className="px-3 py-1.5 text-ink-faint">{o.error ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
