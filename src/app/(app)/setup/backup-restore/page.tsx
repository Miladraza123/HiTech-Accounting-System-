import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, isOwner } from "@/lib/auth";
import { RestoreBackupPanel } from "@/components/RestoreBackupPanel";

export default async function BackupRestorePage() {
  const user = await getCurrentUser();
  if (!isOwner(user)) redirect("/");

  return (
    <div className="space-y-6">
      <div>
        <Link href="/setup/company" className="text-xs text-ink-faint hover:text-ink">
          ← Setup
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">Backup &amp; Restore</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Har raat &quot;Backup Bot&quot; account se khud-b-khud ek Excel (padhne ke liye) aur ek JSON (restore ke liye) file
          email ho jati hai. Yahan se woh JSON file upload karke, plan review karke, aur typed confirmation ke sath,
          database restore kiya ja sakta hai — Owner-only.
        </p>
      </div>

      <RestoreBackupPanel />
    </div>
  );
}
