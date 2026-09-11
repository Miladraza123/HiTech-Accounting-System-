import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, isOwner, ROLE_LABELS } from "@/lib/auth";
import { signOutAction } from "@/app/actions/auth";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const owner = isOwner(user);

  const supabase = await createClient();
  const { count: ownerCount } = await supabase
    .from("user_roles")
    .select("*, roles!inner(code)", { count: "exact", head: true })
    .eq("roles.code", "owner");

  const noOwnerYet = (ownerCount ?? 0) === 0;
  const noRoleYet = user.roles.length === 0 && !noOwnerYet;

  const navItems = [
    { href: "/", label: "Home", show: true },
    { href: "/clients", label: "Clients & Suppliers", show: true },
    { href: "/queries", label: "Queries", show: true },
    { href: "/quotations", label: "Quotations", show: true },
    { href: "/sales-orders", label: "Sales Orders", show: true },
    { href: "/items", label: "Item Master", show: true },
    { href: "/purchase-orders", label: "Purchase Orders", show: true },
    { href: "/inventory", label: "Inventory", show: true },
    { href: "/jobs", label: "Jobs / Work Orders", show: true },
    { href: "/product-templates", label: "BOM Templates", show: true },
    { href: "/delivery-challans", label: "Delivery Challans", show: true },
    { href: "/invoices", label: "GST Invoices", show: true },
    { href: "/supplier-bills", label: "Supplier Bills", show: true },
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
    { href: "/reports", label: "Reports", show: owner || user.roles.includes("accounts") || user.roles.includes("auditor") },
    { href: "/setup/company", label: "Company", show: owner },
    { href: "/setup/warehouses", label: "Warehouses", show: owner || user.roles.includes("store") },
    { href: "/setup/bank-accounts", label: "Bank Accounts", show: owner || user.roles.includes("accounts") },
    { href: "/setup/petty-cash-funds", label: "Petty Cash Funds", show: owner || user.roles.includes("accounts") },
    { href: "/setup/expense-heads", label: "Expense Heads", show: owner },
    { href: "/setup/vehicles", label: "Vehicles / Fleet", show: owner || user.roles.includes("accounts") },
    { href: "/setup/users", label: "Users & Roles", show: owner },
    { href: "/setup/chart-of-accounts", label: "Chart of Accounts", show: owner || user.roles.includes("accounts") },
    { href: "/setup/import", label: "Import Wizard", show: owner || user.roles.includes("accounts") },
  ];

  return (
    <div className="min-h-screen bg-bg">
      <div className="flex">
        <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-line bg-surface min-h-screen sticky top-0">
          <div className="px-5 py-5 border-b border-line">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-ledger text-ledger-soft font-mono text-sm font-semibold">
                H
              </div>
              <span className="font-semibold text-ink text-sm">HiTech ERP</span>
            </div>
            <p className="mt-1 text-[11px] text-ink-faint font-mono uppercase tracking-wide">Phase 10 — Vehicle/Fleet &amp; Rider Expenses</p>
          </div>

          <nav className="flex-1 px-3 py-4 space-y-0.5">
            {navItems
              .filter((n) => n.show)
              .map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="block rounded-md px-3 py-2 text-sm text-ink-soft hover:bg-surface-2 hover:text-ink transition"
                >
                  {n.label}
                </Link>
              ))}
          </nav>

          <div className="border-t border-line px-3 py-4 space-y-2">
            <div className="px-2">
              <p className="text-sm text-ink truncate">{user.fullName}</p>
              <p className="text-[11px] text-ink-faint truncate">
                {user.roles.length ? user.roles.map((r) => ROLE_LABELS[r] ?? r).join(", ") : "No role assigned"}
              </p>
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
  );
}
