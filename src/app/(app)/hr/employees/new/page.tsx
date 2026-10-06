import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { canManageHr, loadPolicyGroupOptions } from "@/lib/hrAccess";
import { EmployeeForm } from "@/components/EmployeeForm";

export default async function NewEmployeePage() {
  const user = await getCurrentUser();
  if (!canManageHr(user)) redirect("/hr/employees");
  const supabase = await createClient();
  const groups = await loadPolicyGroupOptions(supabase);

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <Link href="/hr/employees" className="text-xs text-accent-ink underline underline-offset-2">
          ← Employees
        </Link>
        <h1 className="mt-2 text-lg font-semibold text-ink">New Employee</h1>
      </div>
      <EmployeeForm mode="create" groups={groups} />
    </div>
  );
}
