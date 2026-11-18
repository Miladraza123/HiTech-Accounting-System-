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
  /** The quotation's Terms & Conditions as typed (line breaks kept); the block is left out when empty. */
  terms?: string | null;
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

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * GST split by rate, lowest rate first: the amount each rate applies to and the GST on it. A line's GST is
 * rounded the same way the quotation total is (per line), so the parts add up to the total GST.
 * Rate 0 has no GST to show and is left out.
 */
export function gstByRate(lines: QuotationDocLine[]): { rate: number; base: number; tax: number }[] {
  const byRate = new Map<number, { base: number; tax: number }>();
  for (const l of lines) {
    const rate = Number(l.tax_pct) || 0;
    if (rate === 0) continue;
    const cur = byRate.get(rate) ?? { base: 0, tax: 0 };
    cur.base += l.amount;
    cur.tax += round2((l.amount * rate) / 100);
    byRate.set(rate, cur);
  }
  return [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([rate, v]) => ({ rate, base: round2(v.base), tax: round2(v.tax) }));
}

/**
 * Quotation in the HiTech letterhead layout: Ref # / date, M/S, Attn, subject,
 * one boxed table whose last rows carry Amount, GST and Total, the completion
 * and validity terms, then the signature and stamp.
 */
export function QuotationDoc(p: QuotationDocProps) {
  const cur = p.currency || "PKR";
  // Lines with different GST rates: a GST column per line, and the GST split by rate under the Amount.
  const mixed = new Set(p.lines.map((l) => Number(l.tax_pct) || 0)).size > 1;
  const splits = mixed ? gstByRate(p.lines) : [];
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
            <th style={{ width: mixed ? "40%" : "46%" }}>MATERIAL DESCRIPTION</th>
            <th>RATE</th>
            <th>QTY</th>
            <th>UNIT</th>
            {mixed && <th>GST</th>}
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
                {mixed && <td className="mid">{Number(l.tax_pct) || 0}%</td>}
                <td className="num">{formatAmount(l.amount)}</td>
              </tr>
            );
          })}
          <tr className="sum">
            <td className="noborder" />
            <td colSpan={mixed ? 4 : 3}>AMOUNT</td>
            <td colSpan={2}>
              {cur} {formatAmount(p.subtotal)}
            </td>
          </tr>
          {mixed && splits.length > 0 ? (
            <>
              {splits.map((g) => (
                <tr className="sum" key={g.rate}>
                  <td className="noborder" />
                  <td colSpan={4}>
                    ADD GST {g.rate}% (on {formatAmount(g.base)})
                  </td>
                  <td colSpan={2}>
                    {cur}. {formatAmount(g.tax)}
                  </td>
                </tr>
              ))}
              {splits.length > 1 && (
                <tr className="sum">
                  <td className="noborder" />
                  <td colSpan={4}>TOTAL GST</td>
                  <td colSpan={2}>
                    {cur}. {formatAmount(p.taxTotal)}
                  </td>
                </tr>
              )}
            </>
          ) : (
            <tr className="sum">
              <td className="noborder" />
              <td colSpan={mixed ? 4 : 3}>{taxLabel(p.lines)}</td>
              <td colSpan={2}>
                {cur}. {formatAmount(p.taxTotal)}
              </td>
            </tr>
          )}
          <tr className="sum">
            <td className="noborder" />
            <td colSpan={mixed ? 4 : 3}>TOTAL AMOUNT</td>
            <td colSpan={2}>
              {cur}. {formatAmount(p.grandTotal)}
            </td>
          </tr>
        </tbody>
      </table>

      {p.terms && p.terms.trim() && (
        <div className="tc">
          <div className="tc-title">TERMS &amp; CONDITIONS:</div>
          <div className="tc-body">{p.terms.trim()}</div>
        </div>
      )}

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
