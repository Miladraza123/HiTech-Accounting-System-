// Stylesheet of the Delivery Challan: the HiTech pre-printed challan form.
// Plain black-and-white form (header with logo, title and contact block; M/s and
// Ref. fields; Qty / Descriptions / Remarks with ruled rows; faint logo and
// tagline watermark; Prepared / Authorized / Received By). Scoped under one
// class (`all: initial`) like printStyles().
export function dcPrintStyles(scope: string): string {
  return `
    @page { size: A4; margin: 0; }
    .${scope} { all: initial; box-sizing: border-box; position: relative; display: flex; flex-direction: column; overflow: hidden; font-family: Calibri, Carlito, "Segoe UI", ui-sans-serif, system-ui, sans-serif; font-size: 13px; line-height: 1.3; color: #000; background: #fff; max-width: 210mm; min-height: 297mm; margin: 0 auto; padding: 11mm 13mm 9mm; }
    .${scope} * { box-sizing: border-box; }
    .${scope} .wm { position: absolute; inset: 0; pointer-events: none; z-index: 0; }
    .${scope} .wm-logo { position: absolute; right: 8mm; bottom: 30mm; width: 62mm; opacity: 0.1; }
    .${scope} .wm-text { position: absolute; left: 50%; top: 52%; transform: translate(-50%, -50%) rotate(-38deg); white-space: nowrap; font-family: Georgia, "Times New Roman", serif; font-style: italic; font-size: 38px; color: rgba(0, 131, 123, 0.16); }
    .${scope} .body { position: relative; z-index: 1; display: flex; flex-direction: column; flex: 1 0 auto; }
    .${scope} .top { display: grid; grid-template-columns: 30% 1fr 36%; align-items: start; padding-bottom: 3mm; border-bottom: 1.5px solid #000; }
    .${scope} .logo img { max-width: 100%; max-height: 24mm; object-fit: contain; display: block; }
    .${scope} .logo-text { font-size: 20px; font-weight: 700; color: #00837b; }
    .${scope} .title { text-align: center; white-space: nowrap; font-size: 19px; padding: 1mm 4mm 0; font-weight: 700; text-decoration: underline; letter-spacing: 0.02em; }
    .${scope} .contact { font-size: 10.5px; line-height: 1.4; }
    .${scope} .contact .row { display: flex; gap: 5px; align-items: flex-start; }
    .${scope} .contact .ico { flex: 0 0 11px; padding-top: 1px; display: inline-flex; }
    .${scope} .contact .reg { font-weight: 700; font-style: italic; margin-top: 1px; display: flex; gap: 10px; flex-wrap: wrap; }
    .${scope} .fields { display: grid; grid-template-columns: 1fr 38%; column-gap: 8mm; margin-top: 5mm; }
    .${scope} .f { align-self: start; display: flex; align-items: baseline; gap: 6px; border-bottom: 1px solid #000; min-height: 8mm; padding: 0 2px 1px; }
    .${scope} .f .k { font-weight: 700; white-space: nowrap; }
    .${scope} .f .v { flex: 1; font-size: 14px; }
    .${scope} .left-col { display: flex; flex-direction: column; justify-content: space-between; }
    .${scope} .right-col { display: flex; flex-direction: column; gap: 2mm; }
    .${scope} .right-col .f, .${scope} .left-col .f { align-self: stretch; }
    .${scope} .grid-head { display: grid; grid-template-columns: 11% 1fr 25%; gap: 3px; margin-top: 4mm; }
    .${scope} .grid-head > div { border: 1.5px solid #000; border-radius: 9px 9px 0 0; text-align: center; font-weight: 700; font-size: 14px; padding: 3px 4px; background: #fff; }
    .${scope} .rows { border: 1px solid #000; border-top: none; margin-top: 2px; }
    .${scope} .r { display: grid; grid-template-columns: 11% 1fr 25%; border-top: 1px solid #000; min-height: 9.2mm; }
    .${scope} .r:first-child { border-top: none; }
    .${scope} .r > div { padding: 3px 8px; display: flex; align-items: center; font-size: 14px; white-space: pre-line; }
    .${scope} .r > div + div { border-left: 1px solid #000; }
    .${scope} .r .qty { justify-content: center; text-align: center; }
    .${scope} .dc-remarks { margin-top: 3mm; font-size: 12px; }
    .${scope} .signoff { margin-top: auto; padding-top: 12mm; display: grid; grid-template-columns: 1fr 1fr 1fr; column-gap: 14mm; }
    .${scope} .signoff .box { position: relative; height: 20mm; }
    .${scope} .signoff .line { border-top: 1px solid #000; padding-top: 2px; text-align: center; font-weight: 700; font-size: 12.5px; }
    @media print { .${scope} { max-width: none; } }
  `;
}
