import type { ReactNode } from "react";
import { letterheadPrintStyles } from "@/lib/letterheadPrintStyles";

/**
 * The shared sheet of the letterhead-style documents: header banner on top,
 * footer banner at the bottom of the page, the document body between them.
 * Plain markup (no client JS) so it works for browser print and for the PDF
 * download, which both load the print route.
 */
export function LetterheadFrame({
  scope,
  headerUrl,
  footerUrl,
  fallbackHeader,
  children,
}: {
  scope: string;
  headerUrl: string | null;
  footerUrl: string | null;
  /** Shown instead of the banner image when none is available. */
  fallbackHeader: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={scope}>
      <style dangerouslySetInnerHTML={{ __html: letterheadPrintStyles(scope) }} />
      {headerUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- print page: plain server-rendered HTML captured for PDF/print, see PrintLogoBlock.tsx
        <img className="lh-header" src={headerUrl} alt="" />
      ) : (
        <div className="lh-header-text">{fallbackHeader}</div>
      )}
      <div className="lh-body">{children}</div>
      {footerUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- see above
        <img className="lh-footer" src={footerUrl} alt="" />
      )}
    </div>
  );
}

/** Signature and stamp images stacked above the signatory's name. */
export function SignatureBlock({
  signatureUrl,
  stampUrl,
  name,
}: {
  signatureUrl: string | null;
  stampUrl: string | null;
  name: string | null;
}) {
  return (
    <div className="sign">
      <div className="imgs">
        {signatureUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- see LetterheadFrame
          <img src={signatureUrl} alt="Authorized signature" style={{ position: "absolute", left: 0, bottom: 0, height: "17mm", objectFit: "contain" }} />
        )}
        {stampUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- see LetterheadFrame
          <img src={stampUrl} alt="Company stamp" style={{ position: "absolute", left: "22mm", bottom: "-2mm", height: "21mm", objectFit: "contain", opacity: 0.92 }} />
        )}
      </div>
      <div className="line">{name ?? ""}</div>
    </div>
  );
}
