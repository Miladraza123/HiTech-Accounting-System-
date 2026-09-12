import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner } from "@/lib/auth";
import { CompanyForm } from "@/components/CompanyForm";

export default async function CompanySetupPage() {
  const user = await getCurrentUser();
  if (!isOwner(user)) redirect("/");

  const supabase = await createClient();
  const [{ data: company }, { data: provinces }] = await Promise.all([
    supabase.from("company").select("*").maybeSingle(),
    supabase.from("provinces").select("*").order("name"),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Company Profile</h1>
        <p className="mt-1 text-sm text-ink-soft">
          This information will be printed on invoices, quotations, and GST-related documents.
        </p>
      </div>
      <CompanyForm company={company} provinces={provinces ?? []} />
    </div>
  );
}
