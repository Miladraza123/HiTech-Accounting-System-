import type { createClient } from "@/lib/supabase/server";
import { isOwner, hasRole, type CurrentUser } from "@/lib/auth";

export type NotificationItem = {
  id: string;
  type: "task_due" | "credit_limit" | "low_stock";
  tone: "bad" | "warn";
  title: string;
  description: string;
  href: string;
};

// Same threshold the Credit Limit Warning report itself uses — this bell
// should never disagree with that report about who's flagged.
const CREDIT_WARNING_THRESHOLD = 0.9;
const MAX_PER_TYPE = 8;

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Live-computed, not persisted: there is no `notifications` table and no
 * background job generating rows. Every call here re-derives the current
 * true state (my open tasks due/overdue, parties near/over their credit
 * limit, items at/under their reorder level) straight from the same data
 * the relevant report pages already show — so the bell can never drift
 * out of sync with those pages, never needs a "mark as read" that could
 * hide a condition still actually true, and needs no scheduler running
 * in this environment. The cost is that it re-queries on every page
 * load; each part is skipped entirely for a user whose role can't act
 * on it (mirrors the same `show` role gates already used for nav links).
 */
export async function getNotifications(supabase: ServerSupabase, user: CurrentUser): Promise<NotificationItem[]> {
  const notifications: NotificationItem[] = [];
  const today = new Date().toISOString().slice(0, 10);

  // 1. My own open tasks that are due today or overdue.
  const { data: dueTasks } = await supabase
    .from("tasks")
    .select("id, title, due_date")
    .eq("assigned_to", user.id)
    .eq("status", "Open")
    .lte("due_date", today)
    .order("due_date")
    .limit(MAX_PER_TYPE);
  for (const t of dueTasks ?? []) {
    const overdue = !!t.due_date && t.due_date < today;
    notifications.push({
      id: `task:${t.id}`,
      type: "task_due",
      tone: overdue ? "bad" : "warn",
      title: t.title,
      description: overdue ? `Overdue since ${t.due_date}` : "Due today",
      href: `/tasks/${t.id}`,
    });
  }

  // 2. Clients at/over their credit limit — Owner, Accounts, Sales, Auditor
  // (same visibility as /reports/credit-limit-warning).
  if (isOwner(user) || hasRole(user, "accounts") || hasRole(user, "sales") || hasRole(user, "auditor")) {
    const [{ data: parties }, { data: arSummary }] = await Promise.all([
      supabase.from("parties").select("id, legal_name, credit_limit").in("party_type", ["client", "both"]).gt("credit_limit", 0),
      supabase.from("party_ar_summary").select("*"),
    ]);
    const outstandingById = new Map((arSummary ?? []).map((s) => [s.party_id, s.total_outstanding ?? 0]));
    const flagged = (parties ?? [])
      .map((p) => {
        const outstanding = outstandingById.get(p.id) ?? 0;
        const pct = p.credit_limit > 0 ? outstanding / p.credit_limit : 0;
        return { ...p, pct };
      })
      .filter((p) => p.pct >= CREDIT_WARNING_THRESHOLD)
      .sort((a, b) => b.pct - a.pct)
      .slice(0, MAX_PER_TYPE);
    for (const p of flagged) {
      const overLimit = p.pct >= 1;
      notifications.push({
        id: `credit:${p.id}`,
        type: "credit_limit",
        tone: overLimit ? "bad" : "warn",
        title: p.legal_name,
        description: `${overLimit ? "Over" : "Near"} credit limit (${Math.round(p.pct * 100)}%)`,
        href: `/clients/${p.id}`,
      });
    }
  }

  // 3. Items at/under their (opt-in) reorder level — Owner, Store, Production.
  if (isOwner(user) || hasRole(user, "store") || hasRole(user, "production")) {
    const { data: items } = await supabase
      .from("items")
      .select("id, item_code, description, base_unit, reorder_level")
      .eq("is_active", true)
      .eq("is_stocked", true)
      .not("reorder_level", "is", null);

    if (items?.length) {
      const itemIds = items.map((i) => i.id);
      const { data: stock } = await supabase.from("current_stock").select("item_id, qty_on_hand").in("item_id", itemIds);
      const qtyByItem = new Map<string, number>();
      for (const s of stock ?? []) {
        if (!s.item_id) continue;
        qtyByItem.set(s.item_id, (qtyByItem.get(s.item_id) ?? 0) + (s.qty_on_hand ?? 0));
      }
      const low = items
        .map((it) => ({ ...it, qty: qtyByItem.get(it.id) ?? 0 }))
        .filter((it) => it.reorder_level !== null && it.qty <= it.reorder_level)
        .sort((a, b) => a.qty - b.qty)
        .slice(0, MAX_PER_TYPE);
      for (const it of low) {
        notifications.push({
          id: `stock:${it.id}`,
          type: "low_stock",
          tone: it.qty <= 0 ? "bad" : "warn",
          title: `${it.item_code} — ${it.description}`,
          description: `${it.qty} ${it.base_unit} on hand (reorder at ${it.reorder_level})`,
          href: `/items/${it.id}`,
        });
      }
    }
  }

  return notifications;
}
