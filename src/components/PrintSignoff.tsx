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
          // Both images are bottom-anchored so the signature/stamp ink
          // itself sits right against the sign-off line below, instead of
          // floating in the middle of a tall spacer box — the previous
          // top-anchored layout left ~30-40px of dead space above the
          // line even after the image's own height.
          <div style={{ position: "relative", height: 58 }}>
            {signatureUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- see PrintLogoBlock.tsx
              <img
                src={signatureUrl}
                alt="Authorized signature"
                style={{ height: 50, objectFit: "contain", position: "absolute", left: 0, bottom: 0 }}
              />
            )}
            {stampUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- see PrintLogoBlock.tsx
              <img
                src={stampUrl}
                alt="Company stamp"
                style={{ height: 60, objectFit: "contain", position: "absolute", left: 95, bottom: -5, opacity: 0.92 }}
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
