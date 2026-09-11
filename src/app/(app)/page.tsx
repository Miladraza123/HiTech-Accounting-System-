import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner } from "@/lib/auth";

export default async function HomePage() {
  const user = await getCurrentUser();
  const supabase = await createClient();

  const [
    { data: company },
    { count: warehouseCount },
    { count: userCount },
    { count: partyCount },
    { count: openQueryCount },
    { count: quotationCount },
    { count: openSoCount },
    { count: openPoCount },
    { count: pendingAdjCount },
  ] = await Promise.all([
    supabase.from("company").select("legal_name").maybeSingle(),
    supabase.from("warehouses").select("*", { count: "exact", head: true }),
    supabase.from("user_roles").select("*", { count: "exact", head: true }),
    supabase.from("parties").select("*", { count: "exact", head: true }),
    supabase.from("queries").select("*", { count: "exact", head: true }).in("status", ["Open", "Quoted"]),
    supabase.from("quotations").select("*", { count: "exact", head: true }),
    supabase.from("sales_orders").select("*", { count: "exact", head: true }).not("status", "in", "(Closed,Cancelled)"),
    supabase.from("purchase_orders").select("*", { count: "exact", head: true }).not("status", "in", "(Closed,Cancelled,Received)"),
    supabase.from("stock_adjustments").select("*", { count: "exact", head: true }).eq("status", "Pending"),
  ]);

  const checklist = [
    { label: "Company profile set", done: !!company, href: "/setup/company" },
    { label: "At least one warehouse", done: (warehouseCount ?? 0) > 0, href: "/setup/warehouses" },
    { label: "Chart of Accounts ready", done: true, href: "/setup/chart-of-accounts" },
    { label: "Team member roles assigned", done: (userCount ?? 0) > 0, href: "/setup/users" },
    { label: "Existing clients/suppliers imported", done: (partyCount ?? 0) > 0, href: "/setup/import" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-ink">
          Assalam-o-Alaikum, {user?.fullName?.split(" ")[0] ?? "there"}
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          {company?.legal_name ? company.legal_name : "Ab tak koi company set nahi hui"} — Query se
          lekar Purchase, GRN aur Inventory (Phase 3 tak) chal rahe hain. Fabrication aur baqi
          modules agle phases mein aayenge.
        </p>
      </div>

      <div className="rounded-xl border border-line bg-surface p-5">
        <h2 className="text-sm font-semibold text-ink mb-4">Setup checklist</h2>
        <ul className="space-y-2.5">
          {checklist.map((item) => (
            <li key={item.label} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2.5">
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${
                    item.done ? "bg-good-soft text-good" : "bg-surface-2 text-ink-faint"
                  }`}
                >
                  {item.done ? "✓" : "·"}
                </span>
                <span className={item.done ? "text-ink" : "text-ink-soft"}>{item.label}</span>
              </div>
              {!item.done && isOwner(user) && (
                <Link href={item.href} className="text-xs text-accent-ink underline underline-offset-2">
                  Complete karen
                </Link>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Open Queries" value={openQueryCount ?? 0} />
        <StatCard label="Quotations" value={quotationCount ?? 0} />
        <StatCard label="Active Sales Orders" value={openSoCount ?? 0} />
        <StatCard label="Open Purchase Orders" value={openPoCount ?? 0} />
        <StatCard label="Pending Stock Adjustments" value={pendingAdjCount ?? 0} />
        <StatCard label="Clients / Suppliers" value={partyCount ?? 0} />
        <StatCard label="Warehouses" value={warehouseCount ?? 0} />
        <StatCard label="Team members" value={userCount ?? 0} />
      </div>

      <div className="rounded-xl border border-line bg-surface-2 p-5 text-sm text-ink-soft">
        <p className="font-medium text-ink mb-1">Aage kya?</p>
        <p>
          Phase 4 mein Fabrication / Work Order banega — material reservation, shortage detection,
          BOM templates aur job costing ke sath.
        </p>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-2xl font-semibold text-ink tabular">{value}</p>
      <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">{label}</p>
    </div>
  );
}
