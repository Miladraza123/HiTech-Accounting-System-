import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Serves the company's own uploaded logo as plain image bytes.
 *
 * The app shell shows this logo on every page, and the login page shows it
 * to someone who is not signed in yet. Neither can use the short-lived
 * signed URLs the print pages rely on (`getCompanyBrandingUrls`): those
 * expire after ten minutes, which is fine for a page that is rendered and
 * printed immediately but not for a sidebar that stays open for hours, and
 * a signed-out visitor has no permission to mint one at all.
 *
 * So this route reads the file server-side and streams it back. Two things
 * keep that narrow:
 *  - it takes NO input of any kind, so there is no path to traverse: the
 *    only file it can ever serve is whatever `company.logo_path` currently
 *    points at;
 *  - the `attachments` bucket stays private. Nothing else in it becomes
 *    reachable.
 *
 * The company logo is already public-facing branding — it is printed on
 * every quotation and invoice that leaves the building — so serving it to
 * a signed-out visitor discloses nothing new.
 */
export async function GET() {
  let supabase;
  try {
    supabase = createAdminClient();
  } catch {
    // Service role key not configured — fall back to the built-in mark.
    return new Response(null, { status: 404 });
  }

  const { data: company } = await supabase.from("company").select("logo_path").maybeSingle();
  const path = company?.logo_path;
  if (!path) return new Response(null, { status: 404 });

  const { data: file, error } = await supabase.storage.from("attachments").download(path);
  if (error || !file) return new Response(null, { status: 404 });

  return new Response(await file.arrayBuffer(), {
    headers: {
      "Content-Type": file.type || "image/png",
      // Re-checked every 5 minutes, and the storage path doubles as the
      // ETag so replacing the logo in Setup > Company invalidates it at
      // once rather than waiting the cache out.
      "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
      ETag: `"${path}"`,
    },
  });
}
