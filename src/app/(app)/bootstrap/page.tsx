import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { BootstrapOwnerForm } from "@/components/BootstrapOwnerForm";

export default async function BootstrapPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  // Both RPCs are SECURITY DEFINER and check system-wide state, bypassing
  // user_roles' own RLS (which would otherwise hide every other user's
  // row from anyone who isn't themselves an Owner or the backup role —
  // see fn_owner_exists' own migration comment) and system_bootstrap's
  // total lock-down (no select policy for `authenticated` at all — the
  // only other access is through fn_bootstrap_owner()'s own body).
  const [{ data: ownerExists }, { data: bootstrapAlreadyUsed }] = await Promise.all([
    supabase.rpc("fn_owner_exists"),
    supabase.rpc("fn_owner_bootstrap_already_used"),
  ]);

  if (ownerExists) {
    redirect("/");
  }

  // A real, valid state distinct from "never bootstrapped": this
  // deployment's one-time bootstrap slot was already consumed (by
  // whoever became the first Owner), but that Owner role has since been
  // reassigned/removed and nobody currently holds it. Calling
  // fn_bootstrap_owner() here is guaranteed to fail every time — so
  // don't invite a doomed click at all; explain the real situation
  // instead, matching the RPC's own message for consistency.
  if (bootstrapAlreadyUsed) {
    return (
      <div className="max-w-md">
        <h1 className="text-lg font-semibold text-ink">Create the System Owner</h1>
        <p className="mt-2 text-sm text-ink-soft">
          No Owner has been assigned in this system yet. The Owner has full access to every section
          (Company setup, Users &amp; Roles, Chart of Accounts, all reports) — this is typically the
          business owner or manager.
        </p>
        <div className="mt-4 rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">
          This system&apos;s one-time Owner bootstrap has already been used. If you are locked out, an
          existing Owner must reassign the Owner role from Setup &gt; Users &amp; Roles.
        </div>
      </div>
    );
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
