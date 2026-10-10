import { LetterheadFrame, SignatureBlock } from "@/components/print/LetterheadFrame";
import { formatAmount } from "@/lib/docRef";
import { LetterheadHeader, type LetterheadCompany } from "@/components/print/LetterheadHeader";

export type QuotationDocLine = { description: string; rate: number; qty: number; unit: string | null; tax_pct: number; amount: number };

export type QuotationDocProps = {
  companyName: string;
  refNo: string;
  date: string; // already formatted, e.g. "6-Oct-26"
  partyName: string;
  attn: string | null;
  subject: string | null;
  lines: QuotationDocLine[];
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  currency: string;
  completionTime: string | null;
  validityText: string | null;
  signatoryName: string | null;
  headerCompany: LetterheadCompany;
  logoUrl: string | null;
  footerUrl: string | null;
  signatureUrl: string | null;
  stampUrl: string | null;
};

export const QUOTATION_SCOPE = "print-quotation-lh";

/** "ADD GST 18%" when every line uses one rate, plain "ADD GST" when the rates differ. */
function taxLabel(lines: QuotationDocLine[]): string {
  const rates = [...new Set(lines.map((l) => Number(l.tax_pct)))];
  return rates.length === 1 ? `ADD GST ${rates[0]}%` : "ADD GST";
}

/**
 * Quotation in the HiTech letterhead layout: Ref # / date, M/S, Attn, subject,
 * one boxed table whose last rows carry Amount, GST and Total, the completion
 * and validity terms, then the signature and stamp.
 */
export function QuotationDoc(p: QuotationDocProps) {
  const cur = p.currency || "PKR";
  return (
    <LetterheadFrame
      scope={QUOTATION_SCOPE}
      header={<LetterheadHeader company={p.headerCompany} logoUrl={p.logoUrl} />}
      footerUrl={p.footerUrl}
    >
      <div className="meta">
        <span className="label">REF # :</span>
        <span>{p.refNo}</span>
        <span className="label">DATE:</span>
        <span style={{ paddingLeft: "10mm" }}>{p.date}</span>
        <span className="label">M/S :</span>
        <span style={{ gridColumn: "2 / -1" }}>{p.partyName.toUpperCase()}</span>
        {p.attn && (
          <>
            <span className="label">ATTN :</span>
            <span style={{ gridColumn: "2 / -1" }}>{p.attn.toUpperCase()}</span>
          </>
        )}
      </div>

      {p.subject && <div className="subject u">SUBJECT: {p.subject.toUpperCase()}</div>}

      <div className="intro">
        <div className="b">Dear Sir,</div>
        <div style={{ marginTop: "3mm" }}>With reference to the subject matter, we are pleased to submit our quotation for your further perusal.</div>
      </div>

      <table className="box">
        <thead>
          <tr>
            <th className="noborder" />
            <th style={{ width: "46%" }}>MATERIAL DESCRIPTION</th>
            <th>RATE</th>
            <th>QTY</th>
            <th>UNIT</th>
            <th>TOTAL</th>
          </tr>
        </thead>
        <tbody>
          {p.lines.map((l, i) => {
            const parts = l.description.split("\n").map((x) => x.trim()).filter(Boolean);
            return (
              <tr key={i}>
                <td className="noborder">{i + 1}</td>
                <td>
                  <div className="desc-title">{parts[0]}</div>
                  {parts.slice(1).map((x, j) => (
                    <div key={j} className="desc-sub">
                      {x}
                    </div>
                  ))}
                </td>
                <td className="mid">{formatAmount(l.rate)}</td>
                <td className="mid">{formatAmount(l.qty)}</td>
                <td className="mid">{l.unit ?? ""}</td>
                <td className="num">{formatAmount(l.amount)}</td>
              </tr>
            );
          })}
          <tr className="sum">
            <td className="noborder" />
            <td colSpan={3}>AMOUNT</td>
            <td colSpan={2}>
              {cur} {formatAmount(p.subtotal)}
            </td>
          </tr>
          <tr className="sum">
            <td className="noborder" />
            <td colSpan={3}>{taxLabel(p.lines)}</td>
            <td colSpan={2}>
              {cur}. {formatAmount(p.taxTotal)}
            </td>
          </tr>
          <tr className="sum">
            <td className="noborder" />
            <td colSpan={3}>TOTAL AMOUNT</td>
            <td colSpan={2}>
              {cur}. {formatAmount(p.grandTotal)}
            </td>
          </tr>
        </tbody>
      </table>

      <div className="terms">
        {p.completionTime && (
          <>
            <span>JOB COMPLETION TIME:</span>
            <span style={{ fontWeight: 400 }}>{p.completionTime.toUpperCase()}</span>
          </>
        )}
        {p.validityText && (
          <>
            <span>VALIDITY OF QUOTATION</span>
            <span style={{ fontWeight: 400 }}>{p.validityText}</span>
          </>
        )}
        <span className="full">THANKS &amp; BEST REGARDS</span>
        <span className="full">FOR {p.companyName.toUpperCase()}</span>
      </div>

      <SignatureBlock signatureUrl={p.signatureUrl} stampUrl={p.stampUrl} name={p.signatoryName} />
    </LetterheadFrame>
  );
}
