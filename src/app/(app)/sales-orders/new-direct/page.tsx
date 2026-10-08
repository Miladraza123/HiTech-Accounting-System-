import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fetchLineItems } from "@/lib/itemOptions";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { NewDirectSalesOrderForm } from "@/components/NewDirectSalesOrderForm";

export default async function NewDirectSalesOrderPage() {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "sales_order.manage"))) redirect("/sales-orders");

  const supabase = await createClient();
  const [{ data: parties }, items, { data: units }, { data: company }] = await Promise.all([
    // Only the first page — the rest are found by typing, searched in the
    // database. See SearchablePicker.
    supabase.from("parties").select("id, legal_name").eq("is_active", true).order("legal_name").limit(20),
    fetchLineItems(supabase),
    supabase.from("units").select("*").order("code"),
    supabase.from("company").select("default_sales_tax_pct").maybeSingle(),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <Link href="/sales-orders" className="text-xs text-ink-faint hover:text-ink">
          ← Sales Orders
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">New Direct Sales Order</h1>
        <p className="text-sm text-ink-soft">
          For a client PO that arrived with no prior RFQ/Quotation (e.g. by WhatsApp or phone). A Query and Quotation
          are generated automatically behind the scenes so the document trail stays complete — the normal{" "}
          <Link href="/queries" className="text-accent-ink underline underline-offset-2">
            Query → Quotation
          </Link>{" "}
          flow is unaffected.
        </p>
      </div>

      {!parties?.length ? (
        <div className="rounded-xl border border-warn bg-warn-soft p-5 text-sm text-warn max-w-xl">
          A client must exist first.{" "}
          <Link href="/clients" className="underline underline-offset-2 font-medium">
            Add Client
          </Link>
          .
        </div>
      ) : (
        <NewDirectSalesOrderForm
          parties={parties}
          items={items}
          units={units ?? []}
          defaultTaxPct={company?.default_sales_tax_pct ?? 18}
        />
      )}
    </div>
  );
}
