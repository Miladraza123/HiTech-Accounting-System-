import { redirect } from "next/navigation";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { ImportWizard } from "@/components/ImportWizard";

export default async function ImportPage() {
  const user = await getCurrentUser();
  const canImport = isOwner(user) || hasRole(user, "accounts");
  if (!canImport) redirect("/");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Import Wizard</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Apne purane clients, suppliers, bakaya (outstanding) balances aur warehouse stock ek CSV
          ya Excel file se load karen — har import ek batch ke tor par record hoti hai, review ke
          sath.
        </p>
        <p className="mt-1 text-xs text-ink-faint">
          Opening Stock import se pehle Item Master mein item code aur Warehouses mein warehouse
          code maujood hone chahiye — import sirf link karta hai, naye items/warehouses nahi
          banata.
        </p>
      </div>

      <ImportWizard />
    </div>
  );
}
