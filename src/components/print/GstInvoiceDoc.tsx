import { LetterheadFrame, SignatureBlock } from "@/components/print/LetterheadFrame";
import { LetterheadHeader, type LetterheadCompany } from "@/components/print/LetterheadHeader";
import { gstInvoicePrintStyles } from "@/lib/gstInvoicePrintStyles";
import { formatAmount } from "@/lib/docRef";
import { parseHsCodes } from "@/lib/hsCodes";

export type GstInvoiceDocLine = {
  description: string;
  hsCode: string | null; // may hold several codes
  unit: string | null;
  qty: number;
  rate: number;
  amount: number; // qty x rate, before tax
  taxPct: number;
};

export type GstInvoiceDocProps = {
  invoiceNo: string;
  date: string; // formatted, e.g. "5 October 2026"
  seller: { name: string; ntn: string | null; strn: string | null; address: string | null; phones: string[]; email: string | null };
  buyer: {
    name: string;
    ntn: string | null;
    strn: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    contactPerson: string | null;
  };
  poNo: string | null;
  dcRefs: string | null;
  paymentTerms: string | null;
  dueDate: string | null; // formatted
  sectionLabel: string; // "MATERIAL"
  lines: GstInvoiceDocLine[];
  totalWeight: string | null;
  note: string | null;
  signatoryName: string | null;
  headerCompany: LetterheadCompany;
  logoUrl: string | null;
  footerUrl: string | null;
  signatureUrl: string | null;
  stampUrl: string | null;
};

export const GST_INVOICE_SCOPE = "print-gst-invoice-lh";

/** Per-line tax is rounded to the paisa exactly as the ledger does (fn_create_invoice), so the printed totals match the books. */
export function gstInvoiceLineAmounts(l: Pick<GstInvoiceDocLine, "amount" | "taxPct">) {
  const excl = Number(l.amount);
  const tax = Math.round(excl * Number(l.taxPct)) / 100;
  return { excl, tax, incl: excl + tax };
}

function Row({ label, value, center }: { label: string; value: string | null; center?: boolean }) {
  return (
    <tr>
      <td className="l">{label}</td>
      <td className={`v${center ? " c" : ""}`}>{value ?? ""}</td>
    </tr>
  );
}

/** GST Sales Tax Invoice in the layout of HiTech's own example (Seller / invoice / Buyer boxes, green ruled table). */
export function GstInvoiceDoc(p: GstInvoiceDocProps) {
  const lines = p.lines.map((l) => ({ ...l, ...gstInvoiceLineAmounts(l) }));
  const total = lines.reduce((a, l) => ({ excl: a.excl + l.excl, tax: a.tax + l.tax, incl: a.incl + l.incl }), { excl: 0, tax: 0, incl: 0 });
  const note = p.note?.trim() ? p.note.trim() : null;

  return (
    <LetterheadFrame
      scope={GST_INVOICE_SCOPE}
      header={<LetterheadHeader company={p.headerCompany} logoUrl={p.logoUrl} />}
      footerUrl={p.footerUrl}
    >
      <style dangerouslySetInnerHTML={{ __html: gstInvoicePrintStyles(GST_INVOICE_SCOPE) }} />

      <div className="gst-title">Sales Tax Invoice / Sales Invoice</div>

      <div className="gst-top">
        <div>
          <div className="gst-cap">Seller&apos;s Detail</div>
          <table className="gbox">
            <tbody>
              <Row label="From," value={p.seller.name} />
              <Row label="NTN No." value={p.seller.ntn} />
              <Row label="GST No." value={p.seller.strn} />
              <tr>
                <td className="l tall">Address:</td>
                <td className="v">{p.seller.address}</td>
              </tr>
              <tr>
                <td className="l">Phone No.</td>
                <td className="v c">
                  {p.seller.phones.map((ph, i) => (
                    <div key={i}>{ph}</div>
                  ))}
                </td>
              </tr>
            </tbody>
          </table>
          <div className="gst-email">Email: {p.seller.email ?? ""}</div>
        </div>

        <div style={{ paddingTop: "4.4mm" }}>
          <table className="gbox mid">
            <tbody>
              <tr>
                <td className="l">Invoice No.</td>
                <td className="g">{p.invoiceNo}</td>
              </tr>
              <tr>
                <td className="l">Invoice Date:</td>
                <td className="g">{p.date}</td>
              </tr>
            </tbody>
          </table>
          <table className="gbox mid">
            <tbody>
              <tr>
                <td className="l c" style={{ textAlign: "center" }}>P.O #</td>
                <td className="g">{p.poNo ?? ""}</td>
              </tr>
              <tr>
                <td className="l c" style={{ textAlign: "center" }}>D.C #</td>
                <td className="g">{p.dcRefs ?? ""}</td>
              </tr>
            </tbody>
          </table>
          <table className="gbox pay">
            <tbody>
              <tr>
                <td style={{ fontWeight: 700 }}>Payment Terms:</td>
                <td className="v">{p.paymentTerms ?? ""}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700 }}>Due Date:</td>
                <td className="v">{p.dueDate ?? ""}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div>
          <div className="gst-cap">Buyer&apos;s Detail</div>
          <table className="gbox">
            <tbody>
              <Row label="To," value={p.buyer.name} />
              <Row label="NTN No." value={p.buyer.ntn} />
              <Row label="GST No." value={p.buyer.strn} />
              <tr>
                <td className="l tall">Address:</td>
                <td className="v">{p.buyer.address}</td>
              </tr>
              <tr>
                <td className="l">Phone No.</td>
                <td className="v">{p.buyer.phone}</td>
              </tr>
            </tbody>
          </table>
          <div className="gst-email">Email: {p.buyer.email ?? ""}</div>
          {p.buyer.contactPerson && <div className="gst-contact">Contact Person: {p.buyer.contactPerson}</div>}
        </div>
      </div>

      <div className="gst-section">{p.sectionLabel}</div>
      <table className="gtab">
        <colgroup>
          <col style={{ width: "5%" }} />
          <col style={{ width: "20%" }} />
          <col style={{ width: "9.5%" }} />
          <col style={{ width: "5%" }} />
          <col style={{ width: "5.5%" }} />
          <col style={{ width: "9.5%" }} />
          <col style={{ width: "12.5%" }} />
          <col style={{ width: "5.5%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "15.5%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>S. No.</th>
            <th>Description</th>
            <th>HS Code</th>
            <th>UOM</th>
            <th>JOB</th>
            <th>Rate</th>
            <th>Amount Ex. GST</th>
            <th>GST Rate</th>
            <th>GST Amount</th>
            <th>Amount Inc. GST</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const parts = l.description.split("\n").map((x) => x.trim()).filter(Boolean);
            const codes = parseHsCodes(l.hsCode);
            return (
              <tr key={i} className="row">
                <td className="mid" style={{ fontSize: 12 }}>{i + 1}</td>
                <td className="desc">
                  {parts[0] && <div className="dt">{parts[0]}</div>}
                  {parts.slice(1).map((x, j) => (
                    <div key={j} className="ds">
                      {x}
                    </div>
                  ))}
                </td>
                <td className="hs">
                  {codes.map((c) => (
                    <div key={c}>{c}</div>
                  ))}
                </td>
                <td className="mid">{l.unit ?? ""}</td>
                <td className="num" style={{ textAlign: "center" }}>{formatAmount(l.qty)}</td>
                <td className="num">{formatAmount(l.rate)}</td>
                <td className="num">{formatAmount(l.excl)}</td>
                <td className="mid" style={{ fontSize: 12 }}>{Number(l.taxPct)}%</td>
                <td className="num">{formatAmount(l.tax)}</td>
                <td className="num">{formatAmount(l.incl)}</td>
              </tr>
            );
          })}
          <tr className="tot">
            <td colSpan={6} style={{ textAlign: "center" }}>
              Total
            </td>
            <td className="num">{formatAmount(total.excl)}</td>
            <td className="mid">-</td>
            <td className="num">{formatAmount(total.tax)}</td>
            <td className="num">{formatAmount(total.incl)}</td>
          </tr>
        </tbody>
      </table>

      {p.totalWeight && <div className="gst-weight">Total Weight: {p.totalWeight}</div>}
      {note && <div className="gst-note">{note}</div>}

      <div className="gst-for">FOR {p.seller.name.toUpperCase()}</div>
      <SignatureBlock signatureUrl={p.signatureUrl} stampUrl={p.stampUrl} name={p.signatoryName} />
    </LetterheadFrame>
  );
}
