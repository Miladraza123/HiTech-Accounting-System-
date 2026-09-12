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
          Load your existing clients, suppliers, outstanding balances, and warehouse stock from a
          CSV or Excel file — each import is recorded as a batch, with a review
          step.
        </p>
        <p className="mt-1 text-xs text-ink-faint">
          Before importing Opening Stock, the item code must already exist in Item Master and the
          warehouse code in Warehouses — the import only links records, it does not
          create new items/warehouses.
        </p>
      </div>

      <ImportWizard />
    </div>
  );
}
