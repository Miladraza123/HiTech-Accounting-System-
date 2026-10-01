import { redirect } from "next/navigation";
import { getCurrentUser, isOwner } from "@/lib/auth";
import { RestoreBackupPanel } from "@/components/RestoreBackupPanel";

export default async function BackupRestorePage() {
  const user = await getCurrentUser();
  if (!isOwner(user)) redirect("/");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Backup &amp; Restore</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Every night, an Excel file (for reading) and a JSON file (for restoring) are automatically emailed from the
          &quot;Backup Bot&quot; account. From here, that JSON file can be uploaded, the plan reviewed, and the database
          restored with a typed confirmation — Owner-only.
        </p>
      </div>

      <RestoreBackupPanel />
    </div>
  );
}
