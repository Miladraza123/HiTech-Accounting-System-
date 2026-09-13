"use client";

import { useState } from "react";

/**
 * A real one-click PDF download, next to the existing "Print / PDF"
 * link (which only opens the print-styled page for the browser's own
 * print dialog — someone still has to pick "Save as PDF" there
 * themselves). This loads that exact same print page in a hidden
 * iframe (`?autoprint=0` so it doesn't also pop open a real print
 * dialog — see printStyles.ts), rasterizes it with html2canvas, and
 * saves it as an actual .pdf file via jsPDF. Both libraries are
 * dynamically imported so they never load for anyone who doesn't click
 * this button.
 *
 * Deliberately reuses the print page's own DOM/CSS rather than a
 * separate PDF-specific template — there is exactly one place that
 * defines what these documents look like (the print pages from the
 * earlier "Print letterhead redesign" phase), so the PDF can never
 * visually drift out of sync with what Print produces.
 */
export function DownloadPdfButton({ printPath, filename }: { printPath: string; filename: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setError(null);
    setBusy(true);

    const iframe = document.createElement("iframe");
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);

      iframe.style.position = "fixed";
      iframe.style.left = "-10000px";
      iframe.style.top = "0";
      iframe.style.width = "794px"; // ~210mm (A4 width) at 96dpi
      iframe.style.height = "1123px"; // ~297mm (A4 height) at 96dpi
      iframe.setAttribute("aria-hidden", "true");
      document.body.appendChild(iframe);

      const separator = printPath.includes("?") ? "&" : "?";
      await new Promise<void>((resolve, reject) => {
        iframe.onload = () => resolve();
        iframe.onerror = () => reject(new Error("Couldn't load the document."));
        iframe.src = `${printPath}${separator}autoprint=0`;
      });

      // Same short settle time the print page itself waits before
      // calling window.print() — lets fonts/layout finish first.
      await new Promise((resolve) => setTimeout(resolve, 400));

      const body = iframe.contentDocument?.body;
      if (!body) throw new Error("Couldn't read the document content.");

      const canvas = await html2canvas(body, { scale: 2, useCORS: true, windowWidth: body.scrollWidth, windowHeight: body.scrollHeight });

      const pdf = new jsPDF({ unit: "pt", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const pxToPt = imgWidth / canvas.width;
      const pageHeightPx = pageHeight / pxToPt;

      let sy = 0;
      let pageIndex = 0;
      while (sy < canvas.height) {
        const sliceHeightPx = Math.min(pageHeightPx, canvas.height - sy);
        const pageCanvas = document.createElement("canvas");
        pageCanvas.width = canvas.width;
        pageCanvas.height = sliceHeightPx;
        const ctx = pageCanvas.getContext("2d");
        ctx?.drawImage(canvas, 0, sy, canvas.width, sliceHeightPx, 0, 0, canvas.width, sliceHeightPx);

        if (pageIndex > 0) pdf.addPage();
        pdf.addImage(pageCanvas.toDataURL("image/png"), "PNG", 0, 0, imgWidth, sliceHeightPx * pxToPt);

        sy += sliceHeightPx;
        pageIndex++;
      }

      pdf.save(filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate the PDF.");
    } finally {
      document.body.removeChild(iframe);
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-end">
      <button
        type="button"
        onClick={download}
        disabled={busy}
        className="rounded-md border border-line-strong bg-bg px-3 py-2 text-xs text-ink hover:bg-surface-2 transition whitespace-nowrap disabled:opacity-60"
      >
        {busy ? "Preparing…" : "Download PDF"}
      </button>
      {error && <p className="mt-1 text-xs text-bad">{error}</p>}
    </div>
  );
}
