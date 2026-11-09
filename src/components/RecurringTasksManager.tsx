"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveRecurringTaskAction,
  setRecurringTaskActiveAction,
  deleteRecurringTaskAction,
  type RecurringTaskInput,
} from "@/app/actions/recurringTasks";
import {
  FREQUENCY_LABELS,
  MONTH_LABELS,
  WEEKDAY_LABELS,
  describeRecurrence,
  nextOccurrence,
  type Frequency,
} from "@/lib/recurringTasks";

export type RecurringRuleRow = {
  id: string;
  title: string;
  description: string | null;
  assigned_to: string;
  assignee_name: string;
  priority: "Low" | "Medium" | "High";
  frequency: Frequency;
  weekdays: number[];
  month_day: number | null;
  month: number | null;
  due_time: string | null;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
};

type Person = { id: string; full_name: string };

function Form({
  initial,
  today,
  people,
  isOwner,
  onDone,
}: {
  initial: RecurringRuleRow | null;
  today: string;
  /** Owner only: the users a task can be set for. */
  people: Person[];
  isOwner: boolean;
  onDone: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [frequency, setFrequency] = useState<Frequency>(initial?.frequency ?? "monthly");
  const [weekdays, setWeekdays] = useState<number[]>(initial?.weekdays ?? [1]);
  const [monthDay, setMonthDay] = useState(String(initial?.month_day ?? 1));
  const [month, setMonth] = useState(String(initial?.month ?? 1));
  const [time, setTime] = useState(initial?.due_time?.slice(0, 5) ?? "");
  const [priority, setPriority] = useState<RecurringRuleRow["priority"]>(initial?.priority ?? "Medium");
  const [start, setStart] = useState(initial?.start_date ?? today);
  const [end, setEnd] = useState(initial?.end_date ?? "");
  const [assignee, setAssignee] = useState(initial?.assigned_to ?? "");
  const [active, setActive] = useState(initial?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggleDay = (d: number) => setWeekdays((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d]));

  function save() {
    setError(null);
    if (!title.trim()) return setError("Enter a title.");
    if (frequency === "weekly" && !weekdays.length) return setError("Choose at least one day of the week.");
    const input: RecurringTaskInput = {
      id: initial?.id,
      title,
      description,
      assigned_to: isOwner && assignee ? assignee : undefined,
      priority,
      frequency,
      weekdays: frequency === "weekly" ? weekdays : [],
      month_day: frequency === "monthly" || frequency === "yearly" ? Number(monthDay) : null,
      month: frequency === "yearly" ? Number(month) : null,
      due_time: time,
      start_date: start,
      end_date: end || null,
      is_active: active,
    };
    startTransition(async () => {
      const res = await saveRecurringTaskAction(input);
      if (res.error) return setError(res.error);
      onDone();
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
      <h3 className="text-sm font-semibold text-ink">{initial ? "Edit Recurring Task" : "Add Recurring Task"}</h3>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-ink-soft">Title *</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="e.g. Pay the electricity bill" className="input" />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-ink-soft">Note (optional)</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="input resize-none" />
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-ink-soft">Repeat</span>
          <select value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)} className="input">
            {(Object.keys(FREQUENCY_LABELS) as Frequency[]).map((f) => (
              <option key={f} value={f}>
                {FREQUENCY_LABELS[f]}
              </option>
            ))}
          </select>
        </label>
        {(frequency === "monthly" || frequency === "yearly") && (
          <label className="block space-y-1">
            <span className="text-xs font-medium text-ink-soft">Day of month</span>
            <select value={monthDay} onChange={(e) => setMonthDay(e.target.value)} className="input">
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        )}
        {frequency === "yearly" && (
          <label className="block space-y-1">
            <span className="text-xs font-medium text-ink-soft">Month</span>
            <select value={month} onChange={(e) => setMonth(e.target.value)} className="input">
              {MONTH_LABELS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block space-y-1">
          <span className="text-xs font-medium text-ink-soft">Time (optional)</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="input" />
        </label>
      </div>

      {frequency === "weekly" && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-ink-soft">On these days</span>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_LABELS.map((w, i) => (
              <button
                key={w}
                type="button"
                onClick={() => toggleDay(i)}
                aria-pressed={weekdays.includes(i)}
                className={`rounded-md border px-3 py-1.5 text-xs ${weekdays.includes(i) ? "border-accent bg-accent text-white" : "border-line-strong text-ink-soft"}`}
              >
                {w}
              </button>
            ))}
          </div>
        </div>
      )}
      {(frequency === "monthly" || frequency === "yearly") && Number(monthDay) > 28 && (
        <p className="text-xs text-ink-faint">In a month without a day {monthDay}, it runs on the last day of that month.</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-ink-soft">Priority</span>
          <select value={priority} onChange={(e) => setPriority(e.target.value as RecurringRuleRow["priority"])} className="input">
            <option>Low</option>
            <option>Medium</option>
            <option>High</option>
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-ink-soft">Starts on</span>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="input" />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-ink-soft">Ends on (optional)</span>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="input" />
        </label>
      </div>

      {isOwner && people.length > 0 && (
        <label className="block space-y-1">
          <span className="text-xs font-medium text-ink-soft">For</span>
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="input">
            <option value="">Me</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
        </label>
      )}
      {initial && (
        <label className="flex items-center gap-2 text-xs text-ink-soft">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active
        </label>
      )}

      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onDone} className="rounded-md border border-line-strong px-3 py-1.5 text-xs">
          Cancel
        </button>
        <button type="button" disabled={pending} onClick={save} className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60">
          {pending ? "Saving…" : initial ? "Save Changes" : "Add Recurring Task"}
        </button>
      </div>
    </div>
  );
}

const PRIORITY_STYLE: Record<string, string> = { Low: "text-ink-faint", Medium: "text-ink-soft", High: "text-bad font-medium" };

function fmtDate(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return `${day} ${MONTH_LABELS[m - 1]} ${y}`;
}

/** The list of recurring tasks with Add / Edit / Pause / Delete. */
export function RecurringTasksManager({
  rules,
  today,
  people,
  isOwner,
  currentUserId,
}: {
  rules: RecurringRuleRow[];
  today: string;
  people: Person[];
  isOwner: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ error: string | null }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) return setError(res.error);
      setConfirmDelete(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {!adding && !editing && (
        <button type="button" onClick={() => setAdding(true)} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white">
          + Add Recurring Task
        </button>
      )}
      {adding && <Form initial={null} today={today} people={people} isOwner={isOwner} onDone={() => setAdding(false)} />}
      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}

      <div className="space-y-2">
        {rules.map((r) => {
          if (editing === r.id) {
            return <Form key={r.id} initial={r} today={today} people={people} isOwner={isOwner} onDone={() => setEditing(null)} />;
          }
          const next = r.is_active ? nextOccurrence(r, today < r.start_date ? r.start_date : today) : null;
          const finished = r.is_active && r.end_date !== null && next !== null && next > r.end_date;
          return (
            <div key={r.id} className={`rounded-xl border border-line bg-surface p-4 space-y-1.5 ${r.is_active ? "" : "opacity-70"}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{r.title}</p>
                  <p className="text-xs text-ink-soft">{describeRecurrence(r)}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-mono ${r.is_active ? "bg-good-soft text-good" : "bg-surface-2 text-ink-faint"}`}>
                  {r.is_active ? "Active" : "Paused"}
                </span>
              </div>
              {r.description && <p className="text-xs text-ink-soft whitespace-pre-line">{r.description}</p>}
              <p className="text-xs text-ink-faint">
                <span className={PRIORITY_STYLE[r.priority]}>{r.priority}</span>
                {r.assigned_to !== currentUserId && ` · For ${r.assignee_name}`}
                {r.is_active && next && !finished && ` · Next: ${fmtDate(next)}`}
                {r.end_date && ` · Ends ${fmtDate(r.end_date)}`}
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-1 text-xs">
                <button type="button" onClick={() => setEditing(r.id)} className="text-accent-ink underline underline-offset-2">
                  Edit
                </button>
                <button type="button" disabled={pending} onClick={() => run(() => setRecurringTaskActiveAction(r.id, !r.is_active))} className="text-accent-ink underline underline-offset-2">
                  {r.is_active ? "Pause" : "Resume"}
                </button>
                {confirmDelete === r.id ? (
                  <span className="inline-flex items-center gap-2 text-ink-soft">
                    Delete? Tasks already made stay.
                    <button type="button" disabled={pending} onClick={() => run(() => deleteRecurringTaskAction(r.id))} className="rounded bg-bad px-2 py-0.5 font-medium text-white">
                      Yes
                    </button>
                    <button type="button" onClick={() => setConfirmDelete(null)} className="rounded border border-line-strong px-2 py-0.5">
                      No
                    </button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirmDelete(r.id)} className="text-bad underline underline-offset-2">
                    Delete
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {!rules.length && !adding && <p className="text-sm text-ink-faint">No recurring tasks yet. Add one, for example &quot;Pay the electricity bill&quot; every month on the 1st.</p>}
      </div>
    </div>
  );
}
