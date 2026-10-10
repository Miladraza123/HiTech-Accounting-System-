// Stylesheet for the letterhead-style documents (Quotation, Service Invoice):
// a full-width header banner at the top, a full-width footer banner at the
// bottom of the page, and plain black-on-white text between them, like the
// documents HiTech sends to clients. Scoped under one class (`all: initial`)
// exactly like printStyles(), so nothing from the app shell leaks in.
export function letterheadPrintStyles(scope: string): string {
  return `
    @page { size: A4; margin: 0; }
    .${scope} { all: initial; box-sizing: border-box; display: flex; flex-direction: column; font-family: Calibri, Carlito, "Segoe UI", ui-sans-serif, system-ui, sans-serif; font-size: 13px; line-height: 1.35; color: #000; background: #fff; max-width: 210mm; min-height: 297mm; margin: 0 auto; }
    .${scope} * { box-sizing: border-box; }
    .${scope} .lh-footer { display: block; width: 100%; height: auto; }
    .${scope} .lh-hdr { display: block; width: 100%; }
    .${scope} .lh-band { position: relative; width: 100%; aspect-ratio: 1081 / 195; }
    .${scope} .lh-band-art { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
    .${scope} .lh-logo { position: absolute; left: 3%; top: 6%; width: 32%; height: 88%; display: flex; align-items: center; }
    .${scope} .lh-logo img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
    .${scope} .lh-logo-text { font-size: 22px; font-weight: 700; color: #00837b; }
    .${scope} .lh-contact { position: absolute; left: 51.5%; right: 2.5%; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center; gap: 4px; color: #000; font-size: 13px; font-weight: 700; line-height: 1.3; }
    .${scope} .lh-row { display: flex; align-items: flex-start; gap: 8px; }
    .${scope} .lh-ico { flex: 0 0 14px; padding-top: 2px; display: inline-flex; }
    .${scope} .lh-reg { text-align: right; font-size: 12px; font-weight: 700; font-style: italic; padding: 5px 5% 0 0; display: flex; justify-content: flex-end; gap: 16px; }
    .${scope} .lh-body { flex: 1 0 auto; padding: 6mm 16mm 6mm; }
    .${scope} .lh-footer { margin-top: auto; }
    .${scope} .b { font-weight: 700; }
    .${scope} .u { text-decoration: underline; }
    .${scope} .center { text-align: center; }
    .${scope} .right { text-align: right; }
    .${scope} .meta { display: grid; grid-template-columns: 62px 1fr auto auto; column-gap: 6px; row-gap: 2px; margin-top: 4mm; }
    .${scope} .meta .label { font-weight: 400; }
    .${scope} .subject { margin-top: 7mm; font-weight: 700; }
    .${scope} .intro { margin-top: 5mm; }
    .${scope} table.box { width: 100%; border-collapse: collapse; margin-top: 4mm; font-size: 12px; }
    .${scope} table.box th, .${scope} table.box td { border: 1px solid #000; padding: 4px 6px; vertical-align: middle; }
    .${scope} table.box th { font-weight: 700; text-align: center; }
    .${scope} table.box td.num { text-align: right; }
    .${scope} table.box td.mid { text-align: center; }
    .${scope} table.box td.noborder, .${scope} table.box th.noborder { border: none; padding: 0 4px 0 0; text-align: right; font-size: 12px; width: 16px; vertical-align: middle; }
    .${scope} .desc-title { font-weight: 700; font-size: 15px; text-align: center; }
    .${scope} .desc-sub { font-size: 10.5px; text-align: center; }
    .${scope} .sum td { font-weight: 700; text-align: center; }
    .${scope} .terms { display: grid; grid-template-columns: auto 1fr; column-gap: 8mm; row-gap: 1px; margin-top: 7mm; font-weight: 700; font-size: 12.5px; }
    .${scope} .terms .full { grid-column: 1 / -1; }
    .${scope} .sign { margin-top: 3mm; width: 62mm; }
    .${scope} .sign .imgs { position: relative; height: 22mm; }
    .${scope} .sign .line { border-top: 1px solid #000; padding-top: 2px; font-weight: 700; }
    .${scope} .parties { display: grid; grid-template-columns: 1fr 1fr; column-gap: 10mm; margin-top: 4mm; font-size: 12.5px; }
    .${scope} .parties .col > div { margin-top: 1px; }
    .${scope} .note { margin-top: 5mm; font-size: 12px; font-weight: 700; }
    @media print { .${scope} { max-width: none; min-height: 297mm; } }
  `;
}
