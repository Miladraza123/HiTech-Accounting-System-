// Shared A4 print stylesheet for every standalone print/PDF document
// route (Quotation, GST Invoice, Delivery Challan, Purchase Order,
// Supplier Bill). Each print page renders completely outside the app
// shell — no sidebar, no header — so this resets everything under one
// scoping class (`all: initial`) rather than relying on the app's own
// Tailwind tokens, and pins the physical page size to A4 via `@page`
// so "Print" from the browser (or a save-as-PDF) comes out consistent
// regardless of the visiting browser's own default paper size.
export function printStyles(scopeClass: string): string {
  return `
    @page { size: A4; margin: 15mm; }
    /* box-sizing and min-height together make the sheet exactly one A4 page
       tall even when the content is short, so the footer below can sit at
       the true bottom of the page instead of just under the last line.
       padding-bottom reserves its strip so content can never run into it. */
    .${scopeClass} { all: initial; box-sizing: border-box; position: relative; display: block; font-family: ui-sans-serif, system-ui, sans-serif; color: #20242E; background: #fff; padding: 32px 32px 64px; max-width: 210mm; min-height: 297mm; margin: 0 auto; overflow: hidden; }
    .${scopeClass} * { box-sizing: border-box; }
    .${scopeClass} .watermark { position: absolute; right: -40px; bottom: -40px; opacity: 0.04; pointer-events: none; z-index: 0; }
    .${scopeClass} .hdr { position: relative; z-index: 1; display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #A85A28; padding-bottom: 16px; margin-bottom: 20px; }
    .${scopeClass} .logo-block { display: flex; align-items: center; gap: 12px; }
    .${scopeClass} .co-name { font-size: 20px; font-weight: 700; }
    .${scopeClass} .co-tagline { font-size: 11px; color: #8B8F99; margin-top: 2px; }
    .${scopeClass} .muted { color: #565B68; font-size: 12px; }
    .${scopeClass} h1 { font-size: 16px; margin: 0 0 2px; }
    .${scopeClass} table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 13px; }
    .${scopeClass} th, .${scopeClass} td { border: 1px solid #DDD6C7; padding: 6px 10px; text-align: left; }
    .${scopeClass} th { background: #EFEAE0; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
    .${scopeClass} td.num, .${scopeClass} th.num { text-align: right; font-variant-numeric: tabular-nums; }
    .${scopeClass} .totals { display: flex; justify-content: flex-end; gap: 24px; margin-top: 8px; font-size: 13px; }
    .${scopeClass} .totals .grand { font-weight: 700; }
    .${scopeClass} .terms { margin-top: 24px; font-size: 12px; }
    .${scopeClass} .terms dt { color: #565B68; margin-top: 8px; }
    .${scopeClass} .terms dd { margin: 2px 0 0; }
    .${scopeClass} .signoff { display: flex; justify-content: space-between; margin-top: 56px; font-size: 12px; }
    .${scopeClass} .signoff .box { width: 45%; }
    .${scopeClass} .signoff .line { border-top: 1px solid #20242E; margin-top: 14px; padding-top: 4px; }
    .${scopeClass} .print-foot { position: absolute; left: 32px; right: 32px; bottom: 20px; padding-top: 8px; border-top: 1px solid #DDD6C7; text-align: left; font-size: 10px; letter-spacing: .04em; color: #8B8F99; }
    @media print {
      .${scopeClass} { padding: 0 0 56px; max-width: none; min-height: 267mm; }
      .${scopeClass} .print-foot { left: 0; right: 0; bottom: 0; break-inside: avoid; page-break-inside: avoid; }
    }
  `;
}

/**
 * Auto-open the browser's print dialog once the page has rendered.
 * Skipped when this page is loaded with `?autoprint=0` — used by
 * DownloadPdfButton, which loads this same print page in a hidden
 * iframe to render an actual downloadable PDF and must not have a real
 * print dialog pop up while doing that; opening this URL directly
 * (the existing "Print / PDF" link) is completely unaffected.
 */
export const AUTO_PRINT_SCRIPT = `window.addEventListener('load', () => {
  if (new URLSearchParams(location.search).get('autoprint') === '0') return;
  setTimeout(() => window.print(), 300);
});`;
