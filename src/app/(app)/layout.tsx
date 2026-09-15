import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, isOwner, ROLE_LABELS } from "@/lib/auth";
import { signOutAction } from "@/app/actions/auth";
import { createClient } from "@/lib/supabase/server";
import { MobileNav } from "@/components/MobileNav";
import { SidebarNav, type NavCategory } from "@/components/SidebarNav";
import { OfflineQueueProvider } from "@/components/OfflineQueueProvider";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { InstallAppButton } from "@/components/InstallAppButton";
import { NotificationBell } from "@/components/NotificationBell";
import { getNotifications } from "@/lib/notifications";
// Single source of truth for the version shown to users — the splash screen
// reads the same field, so the footer and the splash can never drift apart.
import packageJson from "../../../package.json";
import {
  LayoutDashboard,
  ListChecks,
  Users,
  HelpCircle,
  FileText,
  ShoppingCart,
  Send,
  Receipt,
  Undo2,
  Truck,
  Package,
  Boxes,
  ArrowLeftRight,
  Wrench,
  LayoutGrid,
  CreditCard,
  Landmark,
  Wallet,
  BookOpen,
  Building2,
  Warehouse,
  Coins,
  Tags,
  Car,
  UserCog,
  ListTree,
  Upload,
  Lock,
  ShieldCheck,
  DatabaseBackup,
  History,
} from "lucide-react";

const ICON_SIZE = 15;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const owner = isOwner(user);

  const supabase = await createClient();
  const [{ data: ownerExists }, { count: dueTaskCount }, notifications] = await Promise.all([
    // A plain count query here (`.from("user_roles")...`) is subject to
    // user_roles' own RLS select policy — `user_id = auth.uid() OR
    // is_owner() OR has_role('backup')` — which hides every OTHER user's
    // row from anyone who isn't themselves an Owner or the backup role.
    // For ordinary staff (Sales/Store/Dispatch/etc.) that silently came
    // back as 0 regardless of whether a real Owner existed. This RPC is
    // SECURITY DEFINER and checks system-wide, bypassing RLS entirely.
    supabase.rpc("fn_owner_exists"),
    supabase
      .from("tasks")
      .select("*", { count: "exact", head: true })
      .eq("assigned_to", user.id)
      .eq("status", "Open")
      .lte("due_date", new Date().toISOString().slice(0, 10)),
    getNotifications(supabase, user),
  ]);

  const noOwnerYet = !ownerExists;
  const noRoleYet = user.roles.length === 0 && !noOwnerYet;

  // Grouped by how the business actually thinks about its own workflow —
  // not the order features were built in. Each item keeps its original
  // `show` visibility rule unchanged; grouping is purely organizational.
  const navCategories: NavCategory[] = [
    {
      label: "",
      items: [
        {
          href: "/reports",
          label: "Owner Dashboard",
          // Owner-exclusive by explicit request — Accounts/Auditor keep
          // access to every individual report under /reports/* (each has
          // its own, unchanged access list below), just not this specific
          // overview page.
          show: owner,
          icon: <LayoutDashboard size={ICON_SIZE} />,
        },
        { href: "/tasks", label: "Tasks & Follow-ups", show: true, badge: dueTaskCount || undefined, icon: <ListChecks size={ICON_SIZE} /> },
      ],
    },
    {
      label: "Contacts",
      items: [{ href: "/clients", label: "Clients & Suppliers", show: true, icon: <Users size={ICON_SIZE} /> }],
    },
    {
      label: "Sales & Billing",
      items: [
        { href: "/queries", label: "Queries", show: true, icon: <HelpCircle size={ICON_SIZE} /> },
        { href: "/quotations", label: "Quotations", show: true, icon: <FileText size={ICON_SIZE} /> },
        { href: "/sales-orders", label: "Sales Orders", show: true, icon: <ShoppingCart size={ICON_SIZE} /> },
        { href: "/delivery-challans", label: "Delivery Challans", show: true, icon: <Send size={ICON_SIZE} /> },
        { href: "/invoices", label: "GST Invoices", show: true, icon: <Receipt size={ICON_SIZE} /> },
        {
          href: "/sales-returns",
          label: "Sales Returns",
          show: owner || user.roles.includes("accounts") || user.roles.includes("sales") || user.roles.includes("auditor"),
          icon: <Undo2 size={ICON_SIZE} />,
        },
      ],
    },
    {
      label: "Purchases",
      items: [
        { href: "/purchase-orders", label: "Purchase Orders", show: true, icon: <Truck size={ICON_SIZE} /> },
        { href: "/supplier-bills", label: "Supplier Bills", show: true, icon: <FileText size={ICON_SIZE} /> },
        {
          href: "/purchase-returns",
          label: "Purchase Returns",
          show: owner || user.roles.includes("accounts") || user.roles.includes("store") || user.roles.includes("auditor"),
          icon: <Undo2 size={ICON_SIZE} />,
        },
      ],
    },
    {
      label: "Inventory / Stock",
      items: [
        { href: "/items", label: "Item Master", show: true, icon: <Package size={ICON_SIZE} /> },
        { href: "/inventory", label: "Inventory", show: true, icon: <Boxes size={ICON_SIZE} /> },
        { href: "/stock-transfers", label: "Stock Transfers", show: owner || user.roles.includes("store"), icon: <ArrowLeftRight size={ICON_SIZE} /> },
      ],
    },
    {
      label: "Fabrication / Jobs",
      items: [
        { href: "/jobs", label: "Jobs / Work Orders", show: true, icon: <Wrench size={ICON_SIZE} /> },
        { href: "/product-templates", label: "BOM Templates", show: true, icon: <LayoutGrid size={ICON_SIZE} /> },
      ],
    },
    {
      label: "Accounts & Finance",
      items: [
        { href: "/payments", label: "Payments", show: true, icon: <CreditCard size={ICON_SIZE} /> },
        {
          href: "/cash-bank",
          label: "Cash & Bank",
          show: owner || user.roles.includes("accounts") || user.roles.includes("auditor"),
          icon: <Landmark size={ICON_SIZE} />,
        },
        { href: "/expenses", label: "Expenses", show: true, icon: <Wallet size={ICON_SIZE} /> },
        {
          href: "/transfers",
          label: "Fund Transfers",
          show: owner || user.roles.includes("accounts") || user.roles.includes("auditor"),
          icon: <ArrowLeftRight size={ICON_SIZE} />,
        },
        {
          href: "/journal-vouchers",
          label: "Journal Vouchers",
          show: owner || user.roles.includes("accounts") || user.roles.includes("auditor"),
          icon: <BookOpen size={ICON_SIZE} />,
        },
      ],
    },
    {
      label: "Settings / Administration",
      items: [
        { href: "/setup/company", label: "Company", show: owner, icon: <Building2 size={ICON_SIZE} /> },
        { href: "/setup/warehouses", label: "Warehouses", show: owner || user.roles.includes("store"), icon: <Warehouse size={ICON_SIZE} /> },
        {
          href: "/setup/bank-accounts",
          label: "Bank Accounts",
          show: owner || user.roles.includes("accounts"),
          icon: <Landmark size={ICON_SIZE} />,
        },
        {
          href: "/setup/petty-cash-funds",
          label: "Petty Cash Funds",
          show: owner || user.roles.includes("accounts"),
          icon: <Coins size={ICON_SIZE} />,
        },
        { href: "/setup/expense-heads", label: "Expense Heads", show: owner, icon: <Tags size={ICON_SIZE} /> },
        {
          href: "/setup/vehicles",
          label: "Vehicles / Fleet",
          show: owner || user.roles.includes("accounts"),
          icon: <Car size={ICON_SIZE} />,
        },
        { href: "/setup/users", label: "Users & Roles", show: owner, icon: <UserCog size={ICON_SIZE} /> },
        {
          href: "/setup/login-history",
          label: "Login History",
          show: owner || user.roles.includes("auditor"),
          icon: <History size={ICON_SIZE} />,
        },
        {
          href: "/setup/chart-of-accounts",
          label: "Chart of Accounts",
          show: owner || user.roles.includes("accounts"),
          icon: <ListTree size={ICON_SIZE} />,
        },
        {
          href: "/setup/import",
          label: "Import Wizard",
          show: owner || user.roles.includes("accounts"),
          icon: <Upload size={ICON_SIZE} />,
        },
        { href: "/setup/period-lock", label: "Period Lock", show: owner, icon: <Lock size={ICON_SIZE} /> },
        { href: "/setup/permissions", label: "Permission Matrix", show: owner, icon: <ShieldCheck size={ICON_SIZE} /> },
        { href: "/setup/backup-restore", label: "Backup & Restore", show: owner, icon: <DatabaseBackup size={ICON_SIZE} /> },
      ],
    },
  ];

  const userRoleLabel = user.roles.length ? user.roles.map((r) => ROLE_LABELS[r] ?? r).join(", ") : "No role assigned";

  return (
    <OfflineQueueProvider
      buildVersion={process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7)}
    >
      <div className="min-h-screen bg-bg">
        <MobileNav
          categories={navCategories}
          userFullName={user.fullName}
          userRoleLabel={userRoleLabel}
          signOutAction={signOutAction}
          notifications={notifications}
        />
        <div className="flex">
          <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-line bg-surface min-h-screen sticky top-0">
            <div className="px-5 py-5 border-b border-line">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Logo size={32} />
                  <span className="font-semibold text-ink text-sm">HiTech ERP</span>
                </div>
                <NotificationBell notifications={notifications} align="left" />
              </div>
            </div>

            <form action="/search" className="px-3 pt-3">
              <input
                type="text"
                name="q"
                placeholder="Search… (Query, SO, Invoice, Item…)"
                className="w-full rounded-md border border-line bg-bg px-3 py-1.5 text-xs text-ink outline-none focus:border-accent"
              />
            </form>

            <SidebarNav categories={navCategories} />

            <div className="border-t border-line px-3 py-4 space-y-3">
              <ThemeToggle />
              <InstallAppButton />
              <div className="px-2">
                <p className="text-sm text-ink truncate">{user.fullName}</p>
                <p className="text-[11px] text-ink-faint truncate">{userRoleLabel}</p>
                <Link href="/account" className="text-[11px] text-accent-ink underline underline-offset-2">
                  Change Password
                </Link>
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
                This system doesn&apos;t have an Owner set up yet.{" "}
                <Link href="/bootstrap" className="underline underline-offset-2 font-medium">
                  Claim Owner access
                </Link>
                .
              </div>
            )}
            {noRoleYet && (
              <div className="bg-warn-soft border-b border-warn px-4 py-2.5 text-sm text-warn">
                You don&apos;t have a role assigned yet — ask the Owner to assign you one.
              </div>
            )}
            <div className="max-w-5xl mx-auto px-5 py-8">{children}</div>
          </main>
        </div>

        <footer className="border-t border-line bg-surface px-5 py-3 flex items-center justify-between">
          <span className="text-[11px] text-ink-faint">Powered by &quot;OHT Solutions&quot;</span>
          <span className="font-mono text-[11px] text-ink-faint">v{packageJson.version}</span>
        </footer>
      </div>
    </OfflineQueueProvider>
  );
}
