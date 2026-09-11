import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { NewSupplierBillForm } from "@/components/NewSupplierBillForm";

export default async function NewSupplierBillPage() {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "accounts"))) redirect("/supplier-bills");

  const supabase = await createClient();
  const [{ data: grns }, { data: existingBills }] = await Promise.all([
    supabase
      .from("grns")
      .select("*, parties(legal_name), purchase_orders!inner(purchase_type)")
      .eq("purchase_orders.purchase_type", "stock")
      .order("created_at", { ascending: false }),
    supabase.from("supplier_bills").select("grn_id").neq("status", "Cancelled"),
  ]);

  const billedGrnIds = new Set((existingBills ?? []).map((b) => b.grn_id));
  const eligible = (grns ?? []).filter((g) => !billedGrnIds.has(g.id));

  return (
    <div className="space-y-4">
      <div>
        <Link href="/supplier-bills" className="text-xs text-ink-faint hover:text-ink">
          ← Supplier Bills
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">Nayi Supplier Bill</h1>
      </div>

      {!eligible.length ? (
        <div className="rounded-xl border border-warn bg-warn-soft p-5 text-sm text-warn max-w-xl">
          Koi &quot;stock&quot; type GRN nahi mili jiski Supplier Bill abhi book na hui ho. (&quot;direct&quot;/&quot;general&quot; GRN ki Trade Payables
          receiving ke waqt hi book ho chuki hoti hai — unke liye alag Bill zaroori nahi.){" "}
          <Link href="/purchase-orders" className="underline underline-offset-2 font-medium">
            Purchase Orders dekhen
          </Link>
          .
        </div>
      ) : (
        <NewSupplierBillForm
          grns={eligible.map((g) => ({
            id: g.id,
            grn_no: g.grn_no,
            received_date: g.received_date,
            parties: g.parties as unknown as { legal_name: string } | null,
          }))}
        />
      )}
    </div>
  );
}
