import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { canManageHr, canReadHr } from "@/lib/hrAccess";
import { RULE_LABELS, asRules, formatRuleValue, summarizeRules, type HrRules, type RuleKey } from "@/lib/hrRules";
import { karachiToday } from "@/lib/karachiTime";
import { deletePolicyVersionAction } from "@/app/actions/hr";
import { PolicyGroupEditForm } from "@/components/PolicyGroupEditForm";
import { PolicyVersionForm } from "@/components/PolicyVersionForm";
import { ConfirmActionButton } from "@/components/ConfirmActionButton";

function changedKeys(prev: HrRules, next: HrRules): RuleKey[] {
  return (Object.keys(RULE_LABELS) as RuleKey[]).filter((k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k]));
}

export default async function PolicyGroupPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!canReadHr(user)) redirect("/");
  const canManage = canManageHr(user);
  const { id } = await params;

  const supabase = await createClient();
  const [{ data: group }, { data: versions }, { data: employees }] = await Promise.all([
    supabase.from("hr_policy_groups").select("*").eq("id", id).maybeSingle(),
    supabase.from("hr_policy_versions").select("*, profiles(full_name)").eq("group_id", id).order("effective_from", { ascending: false }),
    supabase.from("hr_employees_current").select("id, code, full_name, has_overrides, status").eq("policy_group_id", id).order("full_name"),
  ]);
  if (!group) notFound();

  const today = karachiToday();
  const list = versions ?? [];
  const current = list.find((v) => v.effective_from <= today) ?? null;
  const first = list[list.length - 1];

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <Link href="/hr/policies" className="text-xs text-accent-ink underline underline-offset-2">
          ← Attendance Policies
        </Link>
        <h1 className="mt-2 text-lg font-semibold text-ink">{group.name}</h1>
        {group.description && <p className="text-sm text-ink-soft">{group.description}</p>}
      </div>

      {canManage && <PolicyGroupEditForm group={group} />}

      <section className="rounded-xl border border-line bg-surface p-4 sm:p-5 space-y-2">
        <h2 className="text-sm font-semibold text-ink">
          {current ? `Rules in force today (since ${current.effective_from})` : `Rules start on ${first?.effective_from}`}
        </h2>
        <ul className="text-sm text-ink-soft list-disc list-inside space-y-0.5">
          {summarizeRules(asRules((current ?? first)?.rules)).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </section>

      {canManage && list[0] && <PolicyVersionForm groupId={group.id} latest={asRules(list[0].rules)} firstFrom={first.effective_from} />}

      <section className="rounded-xl border border-line bg-surface overflow-hidden">
        <h2 className="px-4 pt-4 text-sm font-semibold text-ink">Version History</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm mt-2">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-4 py-2.5">From</th>
                <th className="text-left px-4 py-2.5">What changed</th>
                <th className="text-left px-4 py-2.5">Reason · By</th>
                {canManage && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {list.map((v, i) => {
                const rules = asRules(v.rules);
                const prev = list[i + 1] ? asRules(list[i + 1].rules) : null;
                const keys = prev ? changedKeys(prev, rules) : [];
                return (
                  <tr key={v.id} className={`border-t border-line align-top ${v.id === current?.id ? "bg-accent-soft/40" : ""}`}>
                    <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap">
                      {v.effective_from}
                      {v.effective_from > today && <span className="ml-1 text-[10px] text-warn">upcoming</span>}
                      {v.id === current?.id && <span className="ml-1 text-[10px] text-good">current</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-ink-soft">
                      {prev ? (
                        keys.length ? (
                          <ul className="space-y-0.5">
                            {keys.map((k) => (
                              <li key={k}>
                                {RULE_LABELS[k]}: <span className="line-through text-ink-faint">{formatRuleValue(k, prev)}</span> → {formatRuleValue(k, rules)}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          "No rule changed"
                        )
                      ) : (
                        <ul className="space-y-0.5">
                          {summarizeRules(rules).map((l) => (
                            <li key={l}>{l}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-ink-soft">
                      {v.reason ?? "—"}
                      <span className="block text-[10px] text-ink-faint">{(v.profiles as unknown as { full_name: string } | null)?.full_name}</span>
                    </td>
                    {canManage && (
                      <td className="px-4 py-2.5 text-right">
                        {prev && (
                          <ConfirmActionButton
                            label="Remove"
                            confirmText="Remove this version?"
                            action={deletePolicyVersionAction.bind(null, group.id, v.id)}
                          />
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-line bg-surface p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-ink">Employees on this group today ({employees?.length ?? 0})</h2>
        <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1 text-sm">
          {(employees ?? []).map((e) => (
            <li key={e.id}>
              <Link href={`/hr/employees/${e.id}`} className="text-accent-ink underline underline-offset-2">
                {e.full_name}
              </Link>{" "}
              <span className="font-mono text-xs text-ink-faint">{e.code}</span>
              {e.has_overrides && <span className="ml-1 rounded bg-surface-2 px-1 text-[10px]">own rules</span>}
              {e.status !== "Active" && <span className="ml-1 text-[10px] text-ink-faint">({e.status})</span>}
            </li>
          ))}
          {!employees?.length && <li className="text-ink-faint">None.</li>}
        </ul>
      </section>
    </div>
  );
}
