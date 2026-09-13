import type { createClient } from "@/lib/supabase/server";

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

// Plenty of time for a single print-page render or PDF capture; these
// URLs are never persisted or handed out beyond that one request.
const SIGNED_URL_TTL = 60 * 10;

async function signPath(supabase: ServerSupabase, path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from("attachments").createSignedUrl(path, SIGNED_URL_TTL);
  if (error) return null;
  return data.signedUrl;
}

export type CompanyBrandingPaths = {
  logo_path: string | null;
  signature_path: string | null;
  stamp_path: string | null;
} | null | undefined;

/**
 * Resolves the letterhead logo (always, when uploaded) plus the
 * signature/stamp images (only when explicitly requested — see
 * PrintPdfActions.tsx, which is the only place that ever sets
 * `?signature=1`/`?stamp=1` on a print page's URL) into short-lived
 * signed URLs a print page can drop straight into an <img src>.
 */
export async function getCompanyBrandingUrls(
  supabase: ServerSupabase,
  company: CompanyBrandingPaths,
  opts: { signature: boolean; stamp: boolean }
): Promise<{ logoUrl: string | null; signatureUrl: string | null; stampUrl: string | null }> {
  const [logoUrl, signatureUrl, stampUrl] = await Promise.all([
    signPath(supabase, company?.logo_path),
    opts.signature ? signPath(supabase, company?.signature_path) : Promise.resolve(null),
    opts.stamp ? signPath(supabase, company?.stamp_path) : Promise.resolve(null),
  ]);
  return { logoUrl, signatureUrl, stampUrl };
}
