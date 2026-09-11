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
    .${scopeClass} { all: initial; display: block; font-family: ui-sans-serif, system-ui, sans-serif; color: #20242E; background: #fff; padding: 32px; max-width: 210mm; margin: 0 auto; }
    .${scopeClass} * { box-sizing: border-box; }
    .${scopeClass} .hdr { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #20242E; padding-bottom: 16px; margin-bottom: 20px; }
    .${scopeClass} .co-name { font-size: 20px; font-weight: 700; }
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
    .${scopeClass} .signoff .line { border-top: 1px solid #20242E; margin-top: 36px; padding-top: 4px; }
    @media print { .${scopeClass} { padding: 0; max-width: none; } }
  `;
}

/** Auto-open the browser's print dialog once the page has rendered. */
export const AUTO_PRINT_SCRIPT = `window.addEventListener('load', () => setTimeout(() => window.print(), 300));`;
