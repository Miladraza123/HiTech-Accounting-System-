import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner } from "@/lib/auth";
import { CompanyForm } from "@/components/CompanyForm";
import { CompanyBrandingForm } from "@/components/CompanyBrandingForm";

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

      <div className="rounded-xl border border-line bg-surface p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">Letterhead Branding</h2>
          <p className="mt-1 text-xs text-ink-soft">
            Logo appears on every printed document automatically. Signature and Stamp are optional — asked for,
            separately, each time you Print or Download a PDF.
          </p>
        </div>
        <CompanyBrandingForm
          logoPath={company?.logo_path ?? null}
          signaturePath={company?.signature_path ?? null}
          stampPath={company?.stamp_path ?? null}
        />
      </div>
    </div>
  );
}
