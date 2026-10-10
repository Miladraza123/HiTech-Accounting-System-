import { LetterheadFrame, SignatureBlock } from "@/components/print/LetterheadFrame";
import { formatAmount } from "@/lib/docRef";
import { LetterheadHeader, type LetterheadCompany } from "@/components/print/LetterheadHeader";

export type ServiceInvoiceDocLine = { description: string; qty: number; rate: number; tax_pct: number; amount: number };

export type ServiceInvoiceDocProps = {
  invoiceNo: string;
  date: string; // formatted, e.g. "6/10/2026"
  seller: { name: string; address: string | null; phone: string | null; ntn: string | null; sntn: string | null };
  buyer: { name: string; address: string | null; phone: string | null; ntn: string | null; sntn: string | null };
  clientPoNo: string | null;
  lines: ServiceInvoiceDocLine[];
  note: string | null;
  signatoryName: string | null;
  headerCompany: LetterheadCompany;
  logoUrl: string | null;
  footerUrl: string | null;
  signatureUrl: string | null;
  stampUrl: string | null;
};

export const SERVICE_INVOICE_SCOPE = "print-service-invoice-lh";

function PartyBlock({ label, p }: { label: string; p: ServiceInvoiceDocProps["seller"] }) {
  return (
    <div className="col">
      <div>
        {label} : {p.name}
      </div>
      {p.address && <div>Address : {p.address}</div>}
      {p.phone && <div>Telephone No : {p.phone}</div>}
      {p.ntn && <div>NTN : {p.ntn}</div>}
      {p.sntn && <div>SNTN : {p.sntn}</div>}
    </div>
  );
}

/** Service Invoice ("SST INVOICE") in the HiTech letterhead layout. */
export function ServiceInvoiceDoc(p: ServiceInvoiceDocProps) {
  const lines = p.lines.map((l) => {
    const excl = Number(l.amount);
    const tax = Math.round(excl * Number(l.tax_pct)) / 100;
    return { ...l, excl, tax, incl: excl + tax };
  });
  const total = lines.reduce((a, l) => ({ excl: a.excl + l.excl, tax: a.tax + l.tax, incl: a.incl + l.incl }), { excl: 0, tax: 0, incl: 0 });

  return (
    <LetterheadFrame
      scope={SERVICE_INVOICE_SCOPE}
      header={<LetterheadHeader company={p.headerCompany} logoUrl={p.logoUrl} />}
      footerUrl={p.footerUrl}
    >
      <div className="center b" style={{ marginTop: "3mm", fontSize: 15 }}>
        SST INVOICE
      </div>
      <div className="center b">INVOICE # {p.invoiceNo}</div>
      <div className="center b">{p.date}</div>

      <div className="parties">
        <PartyBlock label="Seller's Name" p={p.seller} />
        <div>
          <PartyBlock label="Buyers name" p={p.buyer} />
          {p.clientPoNo && <div className="b" style={{ marginTop: 1 }}>{p.clientPoNo}</div>}
        </div>
      </div>

      <table className="box" style={{ marginTop: "3mm" }}>
        <thead>
          <tr>
            <th style={{ width: 28 }}>S#</th>
            <th>DESCRIPTION</th>
            <th style={{ width: 38 }}>JOB</th>
            <th style={{ width: 62 }}>Unit Price</th>
            <th style={{ width: 70 }}>Value Excluding Sales Tax</th>
            <th style={{ width: 44 }}>% of Sales Tax</th>
            <th style={{ width: 66 }}>Amount of Sales Tax</th>
            <th style={{ width: 76 }}>Value including Sales Tax</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={8} style={{ border: "none", padding: "6px 0 2px", fontWeight: 700, textDecoration: "underline" }}>
              SERVICE REQUIRED
            </td>
          </tr>
          {lines.map((l, i) => {
            const parts = l.description.split("\n").map((x) => x.trim()).filter(Boolean);
            return (
              <tr key={i}>
                <td className="mid">{i + 1}</td>
                <td>
                  {parts.map((x, j) => (
                    <div key={j}>{x}</div>
                  ))}
                </td>
                <td className="mid">{formatAmount(l.qty)}</td>
                <td className="num">{formatAmount(l.rate)}</td>
                <td className="num">{formatAmount(l.excl)}</td>
                <td className="mid">{Number(l.tax_pct)}%</td>
                <td className="num">{formatAmount(l.tax)}</td>
                <td className="num">{formatAmount(l.incl)}</td>
              </tr>
            );
          })}
          <tr>
            <td colSpan={4} className="mid b" style={{ border: "none" }}>
              TOTAL AMOUNT
            </td>
            <td className="num b u" style={{ border: "none" }}>
              {formatAmount(total.excl)}
            </td>
            <td style={{ border: "none" }} />
            <td className="num b u" style={{ border: "none" }}>
              {formatAmount(total.tax)}
            </td>
            <td className="num b u" style={{ border: "none" }}>
              {formatAmount(total.incl)}
            </td>
          </tr>
        </tbody>
      </table>

      {p.note && <div className="note">{p.note}</div>}

      <div className="b" style={{ marginTop: "6mm" }}>
        FOR {p.seller.name.toUpperCase()}
      </div>
      <SignatureBlock signatureUrl={p.signatureUrl} stampUrl={p.stampUrl} name={p.signatoryName} />
    </LetterheadFrame>
  );
}
