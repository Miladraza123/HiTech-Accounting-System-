"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  reserveJobMaterialAction,
  releaseJobMaterialAction,
  issueJobMaterialAction,
  returnJobMaterialAction,
} from "@/app/actions/jobs";
import { useOfflineQueue } from "@/components/OfflineQueueProvider";

type Requirement = {
  id: string;
  item_id: string;
  required_qty: number;
  reserved_qty: number;
  issued_qty: number;
  returned_qty: number;
  unit: string | null;
  item: { item_code: string; description: string; base_unit: string } | null;
  free_qty: number;
};

type Reservation = {
  id: string;
  item_id: string;
  reserved_qty: number;
  reservation_mode: string;
  status: string;
  item: { item_code: string; description: string } | null;
};

const TERMINAL = ["ReadyForDispatch", "Delivered", "Cancelled"];

export function JobMaterialPanel({
  jobId,
  jobStatus,
  warehouseId,
  requirements,
  reservations,
  canHandleMaterial,
}: {
  jobId: string;
  jobStatus: string;
  warehouseId: string;
  requirements: Requirement[];
  reservations: Reservation[];
  canHandleMaterial: boolean;
}) {
  const router = useRouter();
  const [reserveQty, setReserveQty] = useState<Record<string, string>>({});
  const [issueQty, setIssueQty] = useState<Record<string, string>>({});
  const [returnQty, setReturnQty] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [offlineNotice, setOfflineNotice] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { isOnline, enqueue } = useOfflineQueue();

  const canIssue = canHandleMaterial && !TERMINAL.includes(jobStatus);
  const activeReservations = reservations.filter((r) => r.status === "Active");

  function doReserve(itemId: string) {
    setError(null);
    setOfflineNotice(null);
    const qty = Number(reserveQty[itemId] ?? 0);
    if (!qty || qty <= 0) {
      setError("Reserve qty must be greater than zero.");
      return;
    }
    setPendingKey(`reserve-${itemId}`);

    // Phase 7 (Master Offline-First Roadmap): re-validated against LIVE
    // free stock at sync time (see this panel's RPC entries in
    // offlineQueue.ts), never a stale offline snapshot.
    if (!isOnline) {
      startTransition(async () => {
        await enqueue({
          kind: "create",
          table: "stock_reservations",
          recordId: crypto.randomUUID(),
          label: "Reserve Job Material",
          payload: { job_id: jobId, item_id: itemId, warehouse_id: warehouseId, qty },
        });
        setReserveQty((q) => ({ ...q, [itemId]: "" }));
        setOfflineNotice("⏳ Reservation saved offline — will sync once you're back online.");
        setPendingKey(null);
      });
      return;
    }

    startTransition(async () => {
      const res = await reserveJobMaterialAction(jobId, itemId, warehouseId, qty);
      if (res.error) setError(res.error);
      else {
        setReserveQty((q) => ({ ...q, [itemId]: "" }));
        router.refresh();
      }
      setPendingKey(null);
    });
  }

  function doRelease(reservationId: string) {
    setError(null);
    setPendingKey(`release-${reservationId}`);
    startTransition(async () => {
      const res = await releaseJobMaterialAction(reservationId, jobId);
      if (res.error) setError(res.error);
      else router.refresh();
      setPendingKey(null);
    });
  }

  function doIssue(itemId: string) {
    setError(null);
    setOfflineNotice(null);
    const qty = Number(issueQty[itemId] ?? 0);
    if (!qty || qty <= 0) {
      setError("Issue qty must be greater than zero.");
      return;
    }
    setPendingKey(`issue-${itemId}`);

    // Phase 7: negative-balance guard (advisory-lock-protected, same as
    // every other stock movement) is re-checked against LIVE stock at
    // sync time — an offline issue that would take stock negative is
    // authoritatively rejected then, not silently accepted now.
    if (!isOnline) {
      startTransition(async () => {
        await enqueue({
          kind: "create",
          table: "job_material_issues",
          recordId: crypto.randomUUID(),
          label: "Issue Job Material",
          payload: { job_id: jobId, item_id: itemId, qty },
        });
        setIssueQty((q) => ({ ...q, [itemId]: "" }));
        setOfflineNotice("⏳ Material issue saved offline — will sync once you're back online.");
        setPendingKey(null);
      });
      return;
    }

    startTransition(async () => {
      const res = await issueJobMaterialAction(jobId, itemId, qty);
      if (res.error) setError(res.error);
      else {
        setIssueQty((q) => ({ ...q, [itemId]: "" }));
        router.refresh();
      }
      setPendingKey(null);
    });
  }

  function doReturn(itemId: string) {
    setError(null);
    setOfflineNotice(null);
    const qty = Number(returnQty[itemId] ?? 0);
    if (!qty || qty <= 0) {
      setError("Return qty must be greater than zero.");
      return;
    }
    setPendingKey(`return-${itemId}`);

    // Phase 7: re-validated against LIVE issued_qty/returned_qty at sync
    // time, never a stale offline snapshot.
    if (!isOnline) {
      startTransition(async () => {
        await enqueue({
          kind: "create",
          table: "job_material_returns",
          recordId: crypto.randomUUID(),
          label: "Return Job Material",
          payload: { job_id: jobId, item_id: itemId, qty },
        });
        setReturnQty((q) => ({ ...q, [itemId]: "" }));
        setOfflineNotice("⏳ Material return saved offline — will sync once you're back online.");
        setPendingKey(null);
      });
      return;
    }

    startTransition(async () => {
      const res = await returnJobMaterialAction(jobId, itemId, qty);
      if (res.error) setError(res.error);
      else {
        setReturnQty((q) => ({ ...q, [itemId]: "" }));
        router.refresh();
      }
      setPendingKey(null);
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="px-4 py-2.5 border-b border-line">
          <h2 className="text-sm font-semibold text-ink">Material Requirements</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-3 py-2">Item</th>
                <th className="text-right px-3 py-2">Required</th>
                <th className="text-right px-3 py-2">Reserved</th>
                <th className="text-right px-3 py-2">Issued</th>
                <th className="text-right px-3 py-2">Returned</th>
                <th className="text-right px-3 py-2">Free Stock</th>
                <th className="text-left px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {requirements.map((r) => {
                const shortfall = r.required_qty - r.reserved_qty;
                return (
                  <tr key={r.id} className="border-t border-line align-top">
                    <td className="px-3 py-2 text-ink">
                      {r.item ? `${r.item.item_code} — ${r.item.description}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular text-ink-soft">
                      {r.required_qty} {r.unit ?? r.item?.base_unit}
                    </td>
                    <td className="px-3 py-2 text-right tabular text-ink-soft">{r.reserved_qty}</td>
                    <td className="px-3 py-2 text-right tabular text-ink-soft">{r.issued_qty}</td>
                    <td className="px-3 py-2 text-right tabular text-ink-soft">{r.returned_qty}</td>
                    <td className="px-3 py-2 text-right tabular text-ink-soft">{r.free_qty}</td>
                    <td className="px-3 py-2">
                      {shortfall > 0 ? (
                        <span className="rounded-full bg-bad-soft px-2 py-0.5 text-xs text-bad whitespace-nowrap">
                          Purchase Required ({shortfall.toFixed(3)})
                        </span>
                      ) : (
                        <span className="rounded-full bg-good-soft px-2 py-0.5 text-xs text-good whitespace-nowrap">Covered</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!requirements.length && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-ink-faint">
                    No material requirement found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {canHandleMaterial && (
          <div className="border-t border-line p-4 space-y-3">
            {requirements.map((r) => {
              const shortfall = r.required_qty - r.reserved_qty;
              const returnable = r.issued_qty - r.returned_qty;
              return (
                <div key={r.id} className="rounded-lg border border-line bg-bg p-3 space-y-2">
                  <p className="text-xs font-medium text-ink">{r.item ? `${r.item.item_code} — ${r.item.description}` : "—"}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {shortfall > 0 && (
                      <div className="flex gap-1.5">
                        <input
                          type="number"
                          step="0.001"
                          min="0"
                          max={Math.min(r.free_qty, shortfall) || undefined}
                          value={reserveQty[r.item_id] ?? ""}
                          onChange={(e) => setReserveQty((q) => ({ ...q, [r.item_id]: e.target.value }))}
                          placeholder="Reserve qty"
                          className="input !py-1 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => doReserve(r.item_id)}
                          disabled={pending}
                          className="shrink-0 rounded-md border border-line-strong bg-bg px-2 py-1 text-xs text-ink hover:bg-surface-2 transition disabled:opacity-60"
                        >
                          {pendingKey === `reserve-${r.item_id}` ? "…" : isOnline ? "Reserve" : "Reserve (Offline)"}
                        </button>
                      </div>
                    )}
                    {canIssue && (
                      <div className="flex gap-1.5">
                        <input
                          type="number"
                          step="0.001"
                          min="0"
                          value={issueQty[r.item_id] ?? ""}
                          onChange={(e) => setIssueQty((q) => ({ ...q, [r.item_id]: e.target.value }))}
                          placeholder="Issue qty"
                          className="input !py-1 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => doIssue(r.item_id)}
                          disabled={pending}
                          className="shrink-0 rounded-md bg-accent px-2 py-1 text-xs font-medium text-white hover:opacity-90 transition disabled:opacity-60"
                        >
                          {pendingKey === `issue-${r.item_id}` ? "…" : isOnline ? "Issue" : "Issue (Offline)"}
                        </button>
                      </div>
                    )}
                    {returnable > 0 && (
                      <div className="flex gap-1.5">
                        <input
                          type="number"
                          step="0.001"
                          min="0"
                          max={returnable}
                          value={returnQty[r.item_id] ?? ""}
                          onChange={(e) => setReturnQty((q) => ({ ...q, [r.item_id]: e.target.value }))}
                          placeholder="Return qty"
                          className="input !py-1 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => doReturn(r.item_id)}
                          disabled={pending}
                          className="shrink-0 rounded-md border border-line-strong bg-bg px-2 py-1 text-xs text-ink hover:bg-surface-2 transition disabled:opacity-60"
                        >
                          {pendingKey === `return-${r.item_id}` ? "…" : isOnline ? "Return" : "Return (Offline)"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {!isOnline && canHandleMaterial && (
        <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
          ⏳ You&apos;re offline — Reserve/Issue/Return actions here are saved on this device and synced
          automatically once you&apos;re back online.
        </p>
      )}
      {offlineNotice && <p className="rounded-md bg-good-soft px-3 py-2 text-sm text-good">{offlineNotice}</p>}
      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}

      {!!activeReservations.length && (
        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          <div className="px-4 py-2.5 border-b border-line">
            <h2 className="text-sm font-semibold text-ink">Active Reservations</h2>
          </div>
          <ul className="divide-y divide-line">
            {activeReservations.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <div>
                  <span className="text-ink">{r.item ? `${r.item.item_code} — ${r.item.description}` : "—"}</span>{" "}
                  <span className="text-ink-soft tabular">— {r.reserved_qty}</span>{" "}
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-ink-faint font-mono">{r.reservation_mode}</span>
                </div>
                {canHandleMaterial && (
                  <button
                    type="button"
                    onClick={() => doRelease(r.id)}
                    disabled={pending}
                    className="rounded-md border border-line-strong bg-bg px-2 py-1 text-xs text-ink hover:bg-surface-2 transition disabled:opacity-60"
                  >
                    {pendingKey === `release-${r.id}` ? "…" : "Release"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
