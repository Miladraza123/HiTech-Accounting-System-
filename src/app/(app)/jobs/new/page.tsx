import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { NewJobForm } from "@/components/NewJobForm";

export default async function NewJobPage() {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "job.manage"))) redirect("/jobs");

  const supabase = await createClient();
  const [{ data: soLines }, { data: warehouses }, { data: templates }, { data: items }, { data: units }, { data: altUnits }, { data: profiles }] = await Promise.all([
    supabase
      .from("sales_order_lines")
      .select("*, sales_orders!inner(so_no, client_po_number, business_line, status, parties(legal_name))")
      .eq("sales_orders.business_line", "fabrication")
      .not("sales_orders.status", "in", "(Cancelled,Closed)")
      .order("sales_order_id"),
    supabase.from("warehouses").select("*").eq("is_active", true).order("name"),
    supabase.from("product_templates").select("*").eq("is_active", true).order("name"),
    supabase.from("items").select("*").eq("is_active", true).order("item_code"),
    supabase.from("units").select("*").order("code"),
    supabase.from("item_alt_units").select("*").eq("is_active", true),
    supabase.from("profiles").select("*").eq("is_active", true).order("full_name"),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <Link href="/jobs" className="text-xs text-ink-faint hover:text-ink">
          ← Jobs
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">New Job</h1>
      </div>

      {!soLines?.length ? (
        <div className="rounded-xl border border-warn bg-warn-soft p-5 text-sm text-warn max-w-xl">
          No open Fabrication Sales Order line found. A Job can only be created against a Sales Order in the Fabrication business line.{" "}
          <Link href="/sales-orders" className="underline underline-offset-2 font-medium">
            View Sales Orders
          </Link>
          .
        </div>
      ) : !warehouses?.length ? (
        <div className="rounded-xl border border-warn bg-warn-soft p-5 text-sm text-warn max-w-xl">
          At least one warehouse must exist first.{" "}
          <Link href="/setup/warehouses" className="underline underline-offset-2 font-medium">
            Add a Warehouse
          </Link>
          .
        </div>
      ) : (
        <NewJobForm
          soLines={(soLines ?? []).map((l) => ({
            id: l.id,
            description: l.description,
            ordered_qty: l.ordered_qty,
            unit: l.unit,
            sales_orders: l.sales_orders as unknown as {
              so_no: string;
              client_po_number: string;
              parties: { legal_name: string } | null;
            },
          }))}
          warehouses={warehouses}
          templates={templates ?? []}
          items={items ?? []}
          units={units ?? []}
          altUnits={altUnits ?? []}
          profiles={profiles ?? []}
        />
      )}
    </div>
  );
}
