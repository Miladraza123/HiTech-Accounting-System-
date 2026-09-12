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
          Har role ke liye har action ON/OFF karen. Owner hamesha sab kuch kar sakta hai (yahan nahi dikhta). Greyed-out checkbox ka matlab hai database
          us role ko is action ke liye allow hi nahi karta — us par grant karne se koi asar nahi hoga.
        </p>
      </div>
      <PermissionMatrixTable initialMatrix={matrix} />
    </div>
  );
}
