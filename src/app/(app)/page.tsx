import { redirect } from "next/navigation";
import { getCurrentUser, isOwner } from "@/lib/auth";

// The generic "Home" landing page was removed — it duplicated the
// purpose-built Owner Dashboard (/reports) with a plainer, less useful
// version of the same KPIs. "/" now just routes each signed-in user
// straight to the page most relevant to them instead of showing an
// extra stop along the way.
export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (isOwner(user)) {
    redirect("/reports");
  }

  // Owner Dashboard is Owner-exclusive by explicit request — every other
  // role (accounts, auditor, sales, store, production, dispatch) doesn't
  // land there anymore, even though accounts/auditor still reach the
  // individual reports under /reports/* directly. Tasks & Follow-ups is
  // the one page every role can always see, so it's the safe universal
  // fallback.
  redirect("/tasks");
}
