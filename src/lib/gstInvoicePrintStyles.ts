// Extra rules for the GST Sales Tax Invoice, laid over letterheadPrintStyles(): the bordered
// Seller / invoice / Buyer boxes with green label cells, and the green ruled item table.
// Same scoping as the other print stylesheets so nothing from the app shell leaks in.
const GREEN = "#92d050";

export function gstInvoicePrintStyles(scope: string): string {
  return `
    .${scope} .lh-body { padding: 3mm 9mm 4mm; }
    .${scope} .gst-title { text-align: center; font-size: 22px; font-weight: 700; margin: 5mm 0 4mm; }
    .${scope} .gst-cap { font-weight: 700; font-size: 12px; margin-bottom: 1mm; }
    .${scope} .gst-top { display: grid; grid-template-columns: 1.05fr 0.95fr 1.05fr; column-gap: 5mm; align-items: start; }
    .${scope} .gbox { border: 1px solid #000; border-collapse: collapse; width: 100%; font-size: 10.5px; table-layout: fixed; }
    .${scope} .gbox td { border: 1px solid #000; padding: 2px 5px; vertical-align: middle; word-wrap: break-word; }
    .${scope} .gbox td.l { background: ${GREEN}; font-weight: 700; width: 29%; }
    .${scope} .gbox.mid td.l { width: 38%; }
    .${scope} .gbox.pay td { width: 50%; }
    .${scope} .gbox td.v { font-weight: 700; }
    .${scope} .gbox td.g { background: ${GREEN}; font-weight: 700; text-align: center; font-size: 12px; }
    .${scope} .gbox td.c { text-align: center; }
    .${scope} .gbox td.tall { height: 15mm; }
    .${scope} .gbox + .gbox { margin-top: 4mm; }
    .${scope} .gst-email { font-size: 10.5px; margin-top: 1.5mm; min-height: 4mm; }
    .${scope} .gst-contact { background: ${GREEN}; font-weight: 700; font-size: 10px; padding: 3px 5px; margin-top: 1.5mm; }
    .${scope} .gst-section { font-weight: 700; font-size: 12px; margin: 2mm 0 1mm; }
    .${scope} table.gtab { width: 100%; border-collapse: collapse; font-size: 11px; table-layout: fixed; }
    .${scope} table.gtab th { background: ${GREEN}; border: 1px solid #000; padding: 3px 2px; font-weight: 700; font-size: 10.5px; text-align: center; }
    .${scope} table.gtab td { border: 1px solid #000; padding: 4px 4px; vertical-align: middle; }
    .${scope} table.gtab td.mid { text-align: center; }
    .${scope} table.gtab td.num { text-align: right; padding-right: 4px; font-size: 11px; white-space: nowrap; }
    .${scope} table.gtab td.desc { text-align: center; }
    .${scope} table.gtab .dt { font-weight: 700; font-size: 12px; }
    .${scope} table.gtab .ds { font-size: 9.5px; }
    .${scope} table.gtab td.hs { text-align: center; font-weight: 700; color: #1f3864; font-size: 10px; }
    .${scope} table.gtab tr.row td { height: 17mm; }
    .${scope} table.gtab tr.tot td { background: ${GREEN}; font-weight: 700; font-size: 12px; border: 1px solid #000; }
    .${scope} .gst-weight { font-weight: 700; font-size: 11px; margin-top: 1.5mm; }
    .${scope} .gst-note { font-weight: 700; font-size: 11px; margin-top: 6mm; white-space: pre-line; }
    .${scope} .gst-for { font-weight: 700; font-size: 13px; margin-top: 6mm; }
    .${scope} .sign { width: 66mm; }
  `;
}
