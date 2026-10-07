"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveAttendanceAction, type AttendanceRowInput } from "@/app/actions/hr";
import { asRules, type HrRules } from "@/lib/hrRules";
import { STATUS_LABELS, WARNING_LABELS, calcDay, minutesLabel, type DayKind, type Mark } from "@/lib/hrDayCalc";

export type GridEmployee = {
  employee_id: string;
  code: string;
  full_name: string;
  designation: string | null;
  day_kind: DayKind;
  rules: unknown;
  locked: boolean;
  entry: {
    mark: Mark;
    check_in: string | null;
    check_out: string | null;
    extra_pairs: { in: string; out: string }[];
    leave_type_id: string | null;
    leave_fraction: number | null;
    note: string | null;
  };
};

type Row = {
  mark: Mark;
  check_in: string;
  check_out: string;
  extra_pairs: { in: string; out: string }[];
  leave_type_id: string;
  leave_fraction: number;
  note: string;
};

function toRow(e: GridEmployee["entry"]): Row {
  return {
    mark: e.mark,
    check_in: e.check_in ?? "",
    check_out: e.check_out ?? "",
    extra_pairs: e.extra_pairs ?? [],
    leave_type_id: e.leave_type_id ?? "",
    leave_fraction: e.leave_fraction ?? 1,
    note: e.note ?? "",
  };
}

function rowKey(r: Row): string {
  const timed = r.mark === "present" || (r.mark === "leave" && r.leave_fraction === 0.5);
  return JSON.stringify([
    r.mark,
    timed ? r.check_in : "",
    timed ? r.check_out : "",
    timed ? r.extra_pairs.filter((p) => p.in || p.out) : [],
    r.mark === "leave" ? r.leave_type_id : "",
    r.mark === "leave" ? r.leave_fraction : null,
    r.note.trim(),
  ]);
}

const STATUS_STYLE: Record<string, string> = {
  P: "bg-good-soft text-good",
  W: "bg-good-soft text-good",
  HD: "bg-warn-soft text-warn",
  HL: "bg-warn-soft text-warn",
  A: "bg-bad-soft text-bad",
  NE: "bg-bad-soft text-bad",
  L: "bg-accent-soft text-accent-ink",
  OFF: "bg-surface-2 text-ink-faint",
  HOL: "bg-surface-2 text-ink-faint",
};

export function AttendanceGrid({
  date,
  employees,
  leaveTypes,
  canEdit,
  isFuture,
}: {
  date: string;
  employees: GridEmployee[];
  leaveTypes: { id: string; name: string; is_paid: boolean }[];
  canEdit: boolean;
  isFuture: boolean;
}) {
  const router = useRouter();
  const initial = useMemo(() => Object.fromEntries(employees.map((e) => [e.employee_id, toRow(e.entry)])), [employees]);
  const [rows, setRows] = useState<Record<string, Row>>(initial);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const rulesById = useMemo(() => Object.fromEntries(employees.map((e) => [e.employee_id, asRules(e.rules)])), [employees]);
  const dirtyIds = employees.filter((e) => rowKey(rows[e.employee_id]) !== rowKey(initial[e.employee_id])).map((e) => e.employee_id);

  useEffect(() => {
    if (!dirtyIds.length) return;
    const warn = (ev: BeforeUnloadEvent) => {
      ev.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtyIds.length]);

  const calcs = Object.fromEntries(
    employees.map((e) => {
      const r = rows[e.employee_id];
      const pairs = [{ in: r.check_in || null, out: r.check_out || null }, ...r.extra_pairs.map((p) => ({ in: p.in || null, out: p.out || null }))];
      return [e.employee_id, calcDay(rulesById[e.employee_id], e.day_kind, r.mark, pairs, r.mark === "leave" ? r.leave_fraction : null)];
    })
  );

  const counts = employees.reduce(
    (acc, e) => {
      const s = calcs[e.employee_id].status;
      acc[s] = (acc[s] ?? 0) + 1;
      if (calcs[e.employee_id].late_counted) acc.late = (acc.late ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  function update(id: string, patch: Partial<Row>) {
    setMessage(null);
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function fillEmpty(mode: "present" | "absent") {
    setMessage(null);
    setRows((prev) => {
      const next = { ...prev };
      for (const e of employees) {
        if (e.locked || e.day_kind !== "work" || next[e.employee_id].mark !== null) continue;
        const r: HrRules = rulesById[e.employee_id];
        next[e.employee_id] =
          mode === "present"
            ? { ...next[e.employee_id], mark: "present", check_in: r.shift_start, check_out: r.shift_end }
            : { ...next[e.employee_id], mark: "absent", check_in: "", check_out: "", extra_pairs: [] };
      }
      return next;
    });
  }

  function save() {
    setError(null);
    setMessage(null);
    for (const id of dirtyIds) {
      const r = rows[id];
      if (r.mark === "leave" && !r.leave_type_id) {
        const name = employees.find((e) => e.employee_id === id)?.full_name;
        return setError(`Pick a leave type for ${name}.`);
      }
    }
    const payload: AttendanceRowInput[] = dirtyIds.map((id) => {
      const r = rows[id];
      const timed = r.mark === "present" || (r.mark === "leave" && r.leave_fraction === 0.5);
      return {
        employee_id: id,
        mark: r.mark,
        check_in: timed ? r.check_in || null : null,
        check_out: timed ? r.check_out || null : null,
        extra_pairs: timed ? r.extra_pairs.filter((p) => p.in || p.out) : [],
        leave_type_id: r.mark === "leave" ? r.leave_type_id : null,
        leave_fraction: r.mark === "leave" ? r.leave_fraction : null,
        note: r.note.trim() || null,
      };
    });
    startTransition(async () => {
      const res = await saveAttendanceAction(date, payload);
      if (res.error) return setError(res.error);
      setMessage(`Saved ${res.saved ?? 0} row(s).`);
      router.refresh();
    });
  }

  const editable = canEdit;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {(["P", "HD", "A", "L", "HL", "NE", "W", "OFF", "HOL"] as const)
          .filter((s) => counts[s])
          .map((s) => (
            <span key={s} className={`rounded-full px-2 py-0.5 font-mono ${STATUS_STYLE[s]}`}>
              {STATUS_LABELS[s]}: {counts[s]}
            </span>
          ))}
        {counts.late ? <span className="rounded-full px-2 py-0.5 font-mono bg-warn-soft text-warn">Late: {counts.late}</span> : null}
        {editable && !isFuture && (
          <span className="ml-auto flex gap-2">
            <button type="button" onClick={() => fillEmpty("present")} className="rounded-md border border-line-strong bg-bg px-2 py-1 hover:bg-surface-2">
              Empty rows → Present at shift time
            </button>
            <button type="button" onClick={() => fillEmpty("absent")} className="rounded-md border border-line-strong bg-bg px-2 py-1 hover:bg-surface-2">
              Empty rows → Absent
            </button>
          </span>
        )}
      </div>
      {isFuture && <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">This date is in the future: only leave can be entered.</p>}

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-3 py-2.5">Employee</th>
                <th className="text-left px-3 py-2.5">Mark</th>
                <th className="text-left px-3 py-2.5">In / Out</th>
                <th className="text-left px-3 py-2.5">Result</th>
                <th className="text-left px-3 py-2.5">Note</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => {
                const r = rows[e.employee_id];
                const c = calcs[e.employee_id];
                const rules = rulesById[e.employee_id];
                const disabled = !editable || e.locked || pending;
                const timed = r.mark === "present" || (r.mark === "leave" && r.leave_fraction === 0.5);
                const dirty = dirtyIds.includes(e.employee_id);
                return (
                  <tr key={e.employee_id} className={`border-t border-line align-top ${dirty ? "bg-accent-soft/30" : ""}`}>
                    <td className="px-3 py-2">
                      <p className="text-ink">{e.full_name}</p>
                      <p className="text-[11px] text-ink-faint">
                        <span className="font-mono">{e.code}</span> · {rules.shift_start}–{rules.shift_end}
                        {e.day_kind !== "work" && <span className="ml-1 text-warn">{e.day_kind === "holiday" ? "Holiday" : "Weekly off"}</span>}
                        {e.locked && <span className="ml-1 text-bad">Salary finalised</span>}
                      </p>
                    </td>
                    <td className="px-3 py-2 min-w-[9rem]">
                      <select
                        aria-label={`Mark for ${e.full_name}`}
                        value={r.mark ?? ""}
                        disabled={disabled}
                        onChange={(ev) => {
                          const mark = (ev.target.value || null) as Mark;
                          if (mark === "present" && !r.check_in && !r.check_out) update(e.employee_id, { mark, check_in: rules.shift_start, check_out: rules.shift_end });
                          else update(e.employee_id, { mark });
                        }}
                        className="input text-xs"
                      >
                        <option value="">— Not entered —</option>
                        {!isFuture && <option value="present">Present</option>}
                        {!isFuture && <option value="absent">Absent</option>}
                        <option value="leave">Leave</option>
                      </select>
                      {r.mark === "leave" && (
                        <div className="mt-1 space-y-1">
                          <select
                            aria-label={`Leave type for ${e.full_name}`}
                            value={r.leave_type_id}
                            disabled={disabled}
                            onChange={(ev) => update(e.employee_id, { leave_type_id: ev.target.value })}
                            className="input text-xs"
                          >
                            <option value="">— Leave type —</option>
                            {leaveTypes.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name} ({t.is_paid ? "paid" : "unpaid"})
                              </option>
                            ))}
                          </select>
                          <select
                            aria-label={`Leave length for ${e.full_name}`}
                            value={String(r.leave_fraction)}
                            disabled={disabled}
                            onChange={(ev) => update(e.employee_id, { leave_fraction: Number(ev.target.value) })}
                            className="input text-xs"
                          >
                            <option value="1">Full day</option>
                            <option value="0.5">Half day</option>
                          </select>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 min-w-[13rem]">
                      {timed ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1">
                            <input
                              type="time"
                              aria-label={`In time for ${e.full_name}`}
                              value={r.check_in}
                              disabled={disabled}
                              onChange={(ev) => update(e.employee_id, { check_in: ev.target.value })}
                              className="input text-xs px-1.5"
                            />
                            <input
                              type="time"
                              aria-label={`Out time for ${e.full_name}`}
                              value={r.check_out}
                              disabled={disabled}
                              onChange={(ev) => update(e.employee_id, { check_out: ev.target.value })}
                              className="input text-xs px-1.5"
                            />
                          </div>
                          {r.extra_pairs.map((p, i) => (
                            <div key={i} className="flex items-center gap-1">
                              <input
                                type="time"
                                aria-label={`Extra in ${i + 1} for ${e.full_name}`}
                                value={p.in}
                                disabled={disabled}
                                onChange={(ev) =>
                                  update(e.employee_id, { extra_pairs: r.extra_pairs.map((x, j) => (j === i ? { ...x, in: ev.target.value } : x)) })
                                }
                                className="input text-xs px-1.5"
                              />
                              <input
                                type="time"
                                aria-label={`Extra out ${i + 1} for ${e.full_name}`}
                                value={p.out}
                                disabled={disabled}
                                onChange={(ev) =>
                                  update(e.employee_id, { extra_pairs: r.extra_pairs.map((x, j) => (j === i ? { ...x, out: ev.target.value } : x)) })
                                }
                                className="input text-xs px-1.5"
                              />
                              {!disabled && (
                                <button
                                  type="button"
                                  aria-label="Remove pair"
                                  onClick={() => update(e.employee_id, { extra_pairs: r.extra_pairs.filter((_, j) => j !== i) })}
                                  className="text-xs text-bad px-1"
                                >
                                  ×
                                </button>
                              )}
                            </div>
                          ))}
                          {!disabled && r.extra_pairs.length < 4 && (
                            <button
                              type="button"
                              onClick={() => update(e.employee_id, { extra_pairs: [...r.extra_pairs, { in: "", out: "" }] })}
                              className="text-[11px] text-accent-ink underline underline-offset-2"
                            >
                              + extra In/Out
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-ink-faint">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 min-w-[11rem]">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${STATUS_STYLE[c.status] ?? ""}`}>{STATUS_LABELS[c.status]}</span>
                      {c.net > 0 && (
                        <p className="mt-1 text-[11px] text-ink-soft">
                          Worked {minutesLabel(c.net)}
                          {c.late > 0 && ` · late ${minutesLabel(c.late)}`}
                          {c.early > 0 && ` · early ${minutesLabel(c.early)}`}
                          {c.ot + c.offday_ot > 0 && ` · OT ${minutesLabel(c.ot + c.offday_ot)}`}
                        </p>
                      )}
                      {c.warnings.filter((w) => w !== "late" && w !== "overtime").length > 0 && (
                        <ul className="mt-1 text-[11px] text-warn">
                          {c.warnings
                            .filter((w) => w !== "late" && w !== "overtime")
                            .map((w) => (
                              <li key={w}>⚠ {WARNING_LABELS[w] ?? w}</li>
                            ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-3 py-2 min-w-[8rem]">
                      <input
                        aria-label={`Note for ${e.full_name}`}
                        value={r.note}
                        disabled={disabled}
                        onChange={(ev) => update(e.employee_id, { note: ev.target.value })}
                        className="input text-xs"
                      />
                    </td>
                  </tr>
                );
              })}
              {!employees.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-ink-faint">
                    No employee was employed on this date.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
      {message && <p className="rounded-md bg-good-soft px-3 py-2 text-sm text-good">{message}</p>}
      {editable && (
        <div className="sticky bottom-2 flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={pending || dirtyIds.length === 0}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white shadow hover:opacity-90 transition disabled:opacity-60"
          >
            {pending ? "Saving…" : `Save ${dirtyIds.length ? `(${dirtyIds.length} changed)` : ""}`}
          </button>
          {dirtyIds.length > 0 && (
            <button type="button" onClick={() => setRows(initial)} className="text-xs text-ink-soft underline underline-offset-2">
              Undo changes
            </button>
          )}
        </div>
      )}
    </div>
  );
}
