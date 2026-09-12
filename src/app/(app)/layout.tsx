import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, isOwner, ROLE_LABELS } from "@/lib/auth";
import { signOutAction } from "@/app/actions/auth";
import { createClient } from "@/lib/supabase/server";
import { MobileNav } from "@/components/MobileNav";
import { OfflineQueueProvider } from "@/components/OfflineQueueProvider";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const owner = isOwner(user);

  const supabase = await createClient();
  const [{ count: ownerCount }, { count: dueTaskCount }] = await Promise.all([
    supabase.from("user_roles").select("*, roles!inner(code)", { count: "exact", head: true }).eq("roles.code", "owner"),
    supabase
      .from("tasks")
      .select("*", { count: "exact", head: true })
      .eq("assigned_to", user.id)
      .eq("status", "Open")
      .lte("due_date", new Date().toISOString().slice(0, 10)),
  ]);

  const noOwnerYet = (ownerCount ?? 0) === 0;
  const noRoleYet = user.roles.length === 0 && !noOwnerYet;

  const navItems: { href: string; label: string; show: boolean; badge?: number }[] = [
    { href: "/", label: "Home", show: true },
    { href: "/tasks", label: "Tasks & Follow-ups", show: true, badge: dueTaskCount || undefined },
    { href: "/clients", label: "Clients & Suppliers", show: true },
    { href: "/queries", label: "Queries", show: true },
    { href: "/quotations", label: "Quotations", show: true },
    { href: "/sales-orders", label: "Sales Orders", show: true },
    { href: "/items", label: "Item Master", show: true },
    { href: "/purchase-orders", label: "Purchase Orders", show: true },
    { href: "/inventory", label: "Inventory", show: true },
    { href: "/stock-transfers", label: "Stock Transfers", show: owner || user.roles.includes("store") },
    { href: "/jobs", label: "Jobs / Work Orders", show: true },
    { href: "/product-templates", label: "BOM Templates", show: true },
    { href: "/delivery-challans", label: "Delivery Challans", show: true },
    { href: "/invoices", label: "GST Invoices", show: true },
    { href: "/sales-returns", label: "Sales Returns", show: owner || user.roles.includes("accounts") || user.roles.includes("sales") || user.roles.includes("auditor") },
    { href: "/supplier-bills", label: "Supplier Bills", show: true },
    { href: "/purchase-returns", label: "Purchase Returns", show: owner || user.roles.includes("accounts") || user.roles.includes("store") || user.roles.includes("auditor") },
    { href: "/payments", label: "Payments", show: true },
    {
      href: "/cash-bank",
      label: "Cash & Bank",
      show: owner || user.roles.includes("accounts") || user.roles.includes("auditor"),
    },
    { href: "/expenses", label: "Expenses", show: true },
    {
      href: "/transfers",
      label: "Fund Transfers",
      show: owner || user.roles.includes("accounts") || user.roles.includes("auditor"),
    },
    {
      href: "/journal-vouchers",
      label: "Journal Vouchers",
      show: owner || user.roles.includes("accounts") || user.roles.includes("auditor"),
    },
    { href: "/reports", label: "Owner Dashboard", show: owner || user.roles.includes("accounts") || user.roles.includes("auditor") },
    { href: "/setup/company", label: "Company", show: owner },
    { href: "/setup/warehouses", label: "Warehouses", show: owner || user.roles.includes("store") },
    { href: "/setup/bank-accounts", label: "Bank Accounts", show: owner || user.roles.includes("accounts") },
    { href: "/setup/petty-cash-funds", label: "Petty Cash Funds", show: owner || user.roles.includes("accounts") },
    { href: "/setup/expense-heads", label: "Expense Heads", show: owner },
    { href: "/setup/vehicles", label: "Vehicles / Fleet", show: owner || user.roles.includes("accounts") },
    { href: "/setup/users", label: "Users & Roles", show: owner },
    { href: "/setup/chart-of-accounts", label: "Chart of Accounts", show: owner || user.roles.includes("accounts") },
    { href: "/setup/import", label: "Import Wizard", show: owner || user.roles.includes("accounts") },
    { href: "/setup/period-lock", label: "Period Lock", show: owner },
    { href: "/setup/permissions", label: "Permission Matrix", show: owner },
    { href: "/setup/backup-restore", label: "Backup & Restore", show: owner },
  ];

  const userRoleLabel = user.roles.length ? user.roles.map((r) => ROLE_LABELS[r] ?? r).join(", ") : "No role assigned";

  return (
    <OfflineQueueProvider>
    <div className="min-h-screen bg-bg">
      <MobileNav
        navItems={navItems}
        userFullName={user.fullName}
        userRoleLabel={userRoleLabel}
        signOutAction={signOutAction}
      />
      <div className="flex">
        <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-line bg-surface min-h-screen sticky top-0">
          <div className="px-5 py-5 border-b border-line">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-ledger text-ledger-soft font-mono text-sm font-semibold">
                H
              </div>
              <span className="font-semibold text-ink text-sm">HiTech ERP</span>
            </div>
            <p className="mt-1 text-[11px] text-ink-faint font-mono uppercase tracking-wide">Phase 17 — Backup &amp; Restore</p>
          </div>

          <form action="/search" className="px-3 pt-3">
            <input
              type="text"
              name="q"
              placeholder="Search… (Query, SO, Invoice, Item…)"
              className="w-full rounded-md border border-line bg-bg px-3 py-1.5 text-xs text-ink outline-none focus:border-accent"
            />
          </form>

          <nav className="flex-1 px-3 py-4 space-y-0.5">
            {navItems
              .filter((n) => n.show)
              .map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-ink-soft hover:bg-surface-2 hover:text-ink transition"
                >
                  <span>{n.label}</span>
                  {!!n.badge && (
                    <span className="rounded-full bg-bad px-1.5 py-0.5 text-[10px] font-mono text-white leading-none">{n.badge}</span>
                  )}
                </Link>
              ))}
          </nav>

          <div className="border-t border-line px-3 py-4 space-y-2">
            <div className="px-2">
              <p className="text-sm text-ink truncate">{user.fullName}</p>
              <p className="text-[11px] text-ink-faint truncate">{userRoleLabel}</p>
            </div>
            <form action={signOutAction}>
              <button
                type="submit"
                className="w-full rounded-md border border-line px-3 py-1.5 text-xs text-ink-soft hover:bg-surface-2 transition"
              >
                Logout
              </button>
            </form>
          </div>
        </aside>

        <main className="flex-1 min-w-0">
          {noOwnerYet && (
            <div className="bg-warn-soft border-b border-warn px-4 py-2.5 text-sm text-warn">
              Is system ka koi Owner abhi tak set nahi hua.{" "}
              <Link href="/bootstrap" className="underline underline-offset-2 font-medium">
                Owner access le lein
              </Link>
              .
            </div>
          )}
          {noRoleYet && (
            <div className="bg-warn-soft border-b border-warn px-4 py-2.5 text-sm text-warn">
              Aapko abhi koi role assign nahi hua — Owner se apna role assign karwayen.
            </div>
          )}
          <div className="max-w-5xl mx-auto px-5 py-8">{children}</div>
        </main>
      </div>
    </div>
    </OfflineQueueProvider>
  );
}
