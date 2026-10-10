import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner } from "@/lib/auth";
import { CompanyForm } from "@/components/CompanyForm";
import { CompanyBrandingForm } from "@/components/CompanyBrandingForm";
import { CompanyDocSettingsForm } from "@/components/CompanyDocSettingsForm";

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
          footerPath={company?.letterhead_footer_path ?? null}
        />
      </div>

      <div className="rounded-xl border border-line bg-surface p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">Quotation &amp; Service Invoice Print</h2>
          <p className="mt-1 text-xs text-ink-soft">
            The header of the Quotation and Service Invoice is built from the Company Profile above (logo, phones, emails, address, NTN, STRN). The company code builds the quotation reference (HTE/TPFL/0012). Each client&apos;s own code is set on the client&apos;s page.
          </p>
        </div>
        <CompanyDocSettingsForm
          shortCode={company?.short_code ?? null}
          signatoryName={company?.signatory_name ?? null}
          serviceInvoiceNote={company?.service_invoice_note ?? null}
          phone2={company?.phone2 ?? null}
          email2={company?.email2 ?? null}
        />
      </div>
    </div>
  );
}
