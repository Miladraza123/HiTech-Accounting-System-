import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { NewTaskForm } from "@/components/NewTaskForm";

export default async function NewTaskPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const supabase = await createClient();
  const [{ data: profiles }, { data: salesOrders }, { data: purchaseOrders }, { data: jobs }, { data: parties }] = await Promise.all([
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    supabase.from("sales_orders").select("id, so_no").not("status", "in", "(Cancelled,Closed)").order("created_at", { ascending: false }).limit(100),
    supabase.from("purchase_orders").select("id, po_no").not("status", "in", "(Cancelled,Closed)").order("created_at", { ascending: false }).limit(100),
    supabase.from("jobs").select("id, job_no").not("status", "in", "(Delivered,Cancelled)").order("created_at", { ascending: false }).limit(100),
    supabase.from("parties").select("id, legal_name").eq("is_active", true).order("legal_name").limit(200),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/tasks" className="text-xs text-ink-faint hover:text-ink">
          ← Tasks
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">Naya Task / Follow-up</h1>
      </div>

      <NewTaskForm
        profiles={profiles ?? []}
        salesOrders={(salesOrders ?? []).map((s) => ({ id: s.id, label: s.so_no }))}
        purchaseOrders={(purchaseOrders ?? []).map((p) => ({ id: p.id, label: p.po_no }))}
        jobs={(jobs ?? []).map((j) => ({ id: j.id, label: j.job_no }))}
        parties={(parties ?? []).map((p) => ({ id: p.id, label: p.legal_name }))}
      />
    </div>
  );
}
