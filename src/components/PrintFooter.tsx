/**
 * The document footer printed at the foot of every print page and every
 * downloaded PDF.
 *
 * Deliberately a normal block in the document flow rather than a
 * `position: fixed` running footer. DownloadPdfButton rasterizes the whole
 * page with html2canvas and then slices that single image into A4 pages, so
 * a fixed element would be painted once, at whatever position it held in
 * the full-height render, and land in the wrong place in the PDF. A block
 * at the end of the document comes out in the same place on both paths —
 * browser Print and Download PDF alike.
 *
 * Note for whoever wonders why the page URL still appears underneath this
 * on a browser printout: that line is Chrome's own print footer, not ours.
 * It is governed by the print dialog's "Headers and footers" checkbox and
 * no page can switch it off. The downloaded PDF never carries it.
 */
export function PrintFooter() {
  return (
    <div className="print-foot">
      <span>Powered by OHT Solutions</span>
    </div>
  );
}
