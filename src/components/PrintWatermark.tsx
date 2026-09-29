/**
 * The faint mark in the bottom-right corner of every print/PDF document
 * (see `.watermark` in printStyles.ts — absolutely positioned, 12%
 * opacity, behind everything else, entirely inside the page and clear
 * of the sign-off line and the footer above/below it). Previously
 * bled off the page edge (negative right/bottom offsets) and sat right
 * behind the footer text, an odd half-clipped look — user-requested fix,
 * previewed as two placement options (page-center vs. this contained
 * corner) before picking this one. Uses the company's own uploaded logo
 * when one exists, falling back to a generic mark only when it doesn't
 * (so a deployment that has never uploaded a logo sees no change).
 *
 * Deliberately a fixed pixel `width` with `height: auto` rather than a
 * fixed box — the uploaded logo's own aspect ratio can be anything, and
 * distorting it here (unlike PrintLogoBlock's letterhead logo, which
 * fits inside a box via object-fit: contain) would be a real visual
 * defect at low opacity just as much as at full opacity.
 */
export function PrintWatermark({ logoUrl }: { logoUrl: string | null }) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- print pages are plain server-rendered HTML captured for PDF/print, not part of the optimized client image pipeline.
      <img className="watermark" src={logoUrl} alt="" width={120} style={{ height: "auto" }} />
    );
  }
  return (
    <svg className="watermark" width="120" height="120" viewBox="0 0 40 40">
      <polyline points="9,20 20,11 31,20" fill="none" stroke="#2b3a55" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="12" y="20" width="16" height="10" rx="1.4" fill="none" stroke="#2b3a55" strokeWidth="2.2" />
    </svg>
  );
}
