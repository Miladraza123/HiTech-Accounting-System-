import { dcPrintStyles } from "@/lib/dcPrintStyles";
import { formatAmount } from "@/lib/docRef";
import { registrationItems, type LetterheadCompany } from "@/components/print/LetterheadHeader";

export type DcDocLine = { qty: number; unit: string | null; description: string; remarks: string | null };

export type DcDocProps = {
  dcNo: string;
  date: string; // formatted, e.g. "10-October-2026"
  partyName: string;
  refNo: string | null;
  lines: DcDocLine[];
  remarks: string | null;
  company: LetterheadCompany;
  logoUrl: string | null;
  tagline: string | null;
  signatureUrl: string | null;
  stampUrl: string | null;
};

export const DC_SCOPE = "print-dc-form";
/** Ruled rows on the form; a challan with more lines just gets more rows. */
export const DC_MIN_ROWS = 15;

const ICON = { width: 11, height: 11, viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": true } as const;
const PHONE = "M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z";
const HOME = "M12 3 2 12h3v8h5v-5h4v5h5v-8h3z";

/** Delivery Challan in the HiTech pre-printed form layout (no prices anywhere). */
export function DcDoc(p: DcDocProps) {
  const phones = [p.company.phone, p.company.phone2].filter((x): x is string => !!x);
  const emails = [p.company.email, p.company.email2].filter((x): x is string => !!x);
  const reg = registrationItems(p.company);
  const blanks = Math.max(DC_MIN_ROWS - p.lines.length, 0);

  return (
    <div className={DC_SCOPE}>
      <style dangerouslySetInnerHTML={{ __html: dcPrintStyles(DC_SCOPE) }} />

      <div className="wm">
        {p.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- print page: plain server-rendered HTML captured for PDF/print, see PrintLogoBlock.tsx
          <img className="wm-logo" src={p.logoUrl} alt="" />
        )}
        {p.tagline && <div className="wm-text">{p.tagline}</div>}
      </div>

      <div className="body">
        <div className="top">
          <div className="logo">
            {p.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- see above
              <img src={p.logoUrl} alt={`${p.company.name} logo`} />
            ) : (
              <span className="logo-text">{p.company.name}</span>
            )}
          </div>
          <div className="title">DELIVERY CHALLAN</div>
          <div className="contact">
            {phones.map((t) => (
              <div key={t} className="row">
                <span className="ico">
                  <svg {...ICON}>
                    <path d={PHONE} />
                  </svg>
                </span>
                <span>{t}</span>
              </div>
            ))}
            {emails.map((t) => (
              <div key={t} className="row">
                <span className="ico">
                  <svg {...ICON} fill="none" stroke="currentColor" strokeWidth={2}>
                    <rect x="3" y="5" width="18" height="14" rx="1.5" />
                    <path d="M3.5 6.5 12 13l8.5-6.5" />
                  </svg>
                </span>
                <span>{t}</span>
              </div>
            ))}
            {p.company.address && (
              <div className="row">
                <span className="ico">
                  <svg {...ICON}>
                    <path d={HOME} />
                  </svg>
                </span>
                <span>{p.company.address}</span>
              </div>
            )}
            {reg.length > 0 && (
              <div className="reg">
                {reg.map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="fields">
          <div className="f">
            <span className="k">M/s:</span>
            <span className="v">{p.partyName}</span>
          </div>
          <div className="right-col">
            <div className="f">
              <span className="k">D.C. No.</span>
              <span className="v">{p.dcNo}</span>
            </div>
            <div className="f">
              <span className="k">Date:</span>
              <span className="v">{p.date}</span>
            </div>
            <div className="f">
              <span className="k">Ref/PO Number:</span>
              <span className="v">{p.refNo ?? ""}</span>
            </div>
          </div>
        </div>

        <div className="grid-head">
          <div>Qty.</div>
          <div>Descriptions</div>
          <div>Remarks</div>
        </div>
        <div className="rows">
          {p.lines.map((l, i) => (
            <div key={i} className="r">
              <div className="qty">
                {formatAmount(l.qty)}
                {l.unit ? ` ${l.unit}` : ""}
              </div>
              <div>{l.description}</div>
              <div>{l.remarks ?? ""}</div>
            </div>
          ))}
          {Array.from({ length: blanks }, (_, i) => (
            <div key={`b${i}`} className="r">
              <div className="qty" />
              <div />
              <div />
            </div>
          ))}
        </div>

        {p.remarks && <div className="dc-remarks">Remarks: {p.remarks}</div>}

        <div className="signoff">
          <div>
            <div className="box" />
            <div className="line">Prepared By</div>
          </div>
          <div>
            <div className="box">
              {p.signatureUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- see above
                <img src={p.signatureUrl} alt="Authorized signature" style={{ position: "absolute", left: "8mm", bottom: 0, height: "17mm", objectFit: "contain" }} />
              )}
              {p.stampUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- see above
                <img src={p.stampUrl} alt="Company stamp" style={{ position: "absolute", left: "26mm", bottom: "-2mm", height: "21mm", objectFit: "contain", opacity: 0.92 }} />
              )}
            </div>
            <div className="line">Authorized By</div>
          </div>
          <div>
            <div className="box" />
            <div className="line">Received By</div>
          </div>
        </div>
      </div>
    </div>
  );
}
