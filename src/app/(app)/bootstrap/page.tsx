import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { BootstrapOwnerForm } from "@/components/BootstrapOwnerForm";

export default async function BootstrapPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { count: ownerCount } = await supabase
    .from("user_roles")
    .select("*, roles!inner(code)", { count: "exact", head: true })
    .eq("roles.code", "owner");

  if ((ownerCount ?? 0) > 0) {
    redirect("/");
  }

  return (
    <div className="max-w-md">
      <h1 className="text-lg font-semibold text-ink">Create the System Owner</h1>
      <p className="mt-2 text-sm text-ink-soft">
        No Owner has been assigned in this system yet. The Owner has full access to every section
        (Company setup, Users &amp; Roles, Chart of Accounts, all reports) — this is typically the
        business owner or manager.
      </p>
      <BootstrapOwnerForm />
    </div>
  );
}
