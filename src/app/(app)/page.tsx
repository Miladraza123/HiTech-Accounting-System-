import { redirect } from "next/navigation";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";

// The generic "Home" landing page was removed — it duplicated the
// purpose-built Owner Dashboard (/reports) with a plainer, less useful
// version of the same KPIs. "/" now just routes each signed-in user
// straight to the page most relevant to them instead of showing an
// extra stop along the way.
export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (isOwner(user) || hasRole(user, "accounts") || hasRole(user, "auditor")) {
    redirect("/reports");
  }

  // Every other role (sales, store, production, dispatch) doesn't have
  // access to the Owner Dashboard — Tasks & Follow-ups is the one page
  // every role can always see, so it's the safe universal fallback.
  redirect("/tasks");
}
