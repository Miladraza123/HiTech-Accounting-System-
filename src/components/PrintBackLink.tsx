/**
 * A small "‹ Back" button shown on every standalone print/PDF page,
 * outside the printable sheet itself. These pages render with no app
 * shell at all (no sidebar/header) — on a phone with no visible browser
 * chrome (e.g. installed as a PWA, or a browser that hides its own back
 * control once here), there was previously no way to get off this page
 * back to the document it came from.
 *
 * Deliberately a plain navigating `<a>` rather than `history.back()`:
 * this page may have been opened as the very first entry in its tab
 * (nothing to go back to), so navigating straight to the document it
 * belongs to is more reliable than browser history.
 *
 * Hidden two different ways so it never contaminates actual output:
 * - `print:hidden` removes it during a REAL browser print / "Save as
 *   PDF" (window.print(), triggered by AUTO_PRINT_SCRIPT) — @media
 *   print genuinely applies there.
 * - The caller simply doesn't render this component at all when
 *   `autoprint=0` is set — that's DownloadPdfButton's own hidden-iframe
 *   + html2canvas capture path, which rasterizes the page as normally
 *   displayed on screen and never triggers @media print, so print:hidden
 *   alone wouldn't hide it from a downloaded PDF.
 *
 * A normal in-flow sticky bar rendered BEFORE the printable sheet
 * (rather than a floating/fixed overlay) — the sheet's own letterhead
 * starts right at its own top-left corner, so an overlay there risks
 * covering the logo/company name on a narrow screen. This instead
 * pushes the sheet down by its own height and stays pinned while
 * scrolling a multi-page document.
 */
export function PrintBackLink({ href }: { href: string }) {
  return (
    <div className="print:hidden sticky top-0 z-50 border-b border-line bg-bg px-3 py-2">
      <a
        href={href}
        className="inline-flex items-center gap-1 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink shadow-sm hover:bg-surface-2 transition"
      >
        ← Back
      </a>
    </div>
  );
}
