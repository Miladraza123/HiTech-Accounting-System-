import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { ChangePasswordForm } from "@/components/ChangePasswordForm";

// Every signed-in user's own account settings — currently just the
// password. Not role-gated: anyone who can log in can change their own
// password, Owner included.
export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="space-y-6 max-w-md">
      <div>
        <h1 className="text-lg font-semibold text-ink">My Account</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Signed in as <span className="font-medium text-ink">{user.fullName}</span> ({user.email})
        </p>
      </div>

      <div className="rounded-xl border border-line bg-surface p-5 space-y-4">
        <h2 className="text-sm font-semibold text-ink">Change Password</h2>
        <ChangePasswordForm />
      </div>
    </div>
  );
}
