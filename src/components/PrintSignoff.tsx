/**
 * The "our side" / "their side" signature strip at the bottom of a
 * print page. Signature/stamp images only ever render here when the
 * caller explicitly resolved them (see PrintPdfActions.tsx +
 * getCompanyBrandingUrls) — the "their side" box is always left blank
 * for the recipient's own physical signature, never ours.
 */
export function PrintSignoff({
  ourLabel,
  theirLabel,
  signatureUrl,
  stampUrl,
}: {
  ourLabel: string;
  theirLabel: string;
  signatureUrl: string | null;
  stampUrl: string | null;
}) {
  return (
    <div className="signoff">
      <div className="box">
        {(signatureUrl || stampUrl) && (
          <div style={{ position: "relative", height: 78, marginBottom: 6 }}>
            {signatureUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- see PrintLogoBlock.tsx
              <img src={signatureUrl} alt="Authorized signature" style={{ height: 56, objectFit: "contain" }} />
            )}
            {stampUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- see PrintLogoBlock.tsx
              <img
                src={stampUrl}
                alt="Company stamp"
                style={{ height: 66, objectFit: "contain", position: "absolute", left: 118, top: -2, opacity: 0.92 }}
              />
            )}
          </div>
        )}
        <div className="line">{ourLabel}</div>
      </div>
      <div className="box">
        <div className="line">{theirLabel}</div>
      </div>
    </div>
  );
}
