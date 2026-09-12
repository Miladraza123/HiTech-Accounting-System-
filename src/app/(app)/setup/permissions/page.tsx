import { redirect } from "next/navigation";
import { getCurrentUser, isOwner } from "@/lib/auth";
import { loadPermissionMatrix } from "@/lib/permissions";
import { PermissionMatrixTable } from "@/components/PermissionMatrixTable";

export default async function PermissionsPage() {
  const user = await getCurrentUser();
  if (!isOwner(user)) redirect("/");

  const matrix = await loadPermissionMatrix();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Permission Matrix</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Turn each action ON/OFF for each role. The Owner can always do everything (not shown here). A greyed-out checkbox means the database
          does not allow that role for this action at all — granting it here will have no effect.
        </p>
      </div>
      <PermissionMatrixTable initialMatrix={matrix} />
    </div>
  );
}
