/**
 * The left half of every print page's header — identical across all 5
 * document types before this, now the one place that decides between
 * an uploaded company logo image and the original generic mark
 * (unchanged fallback, so nothing changes for a deployment that hasn't
 * uploaded one). Plain server-renderable markup — no client JS needed.
 *
 * Logo sizing (max-height:18mm; max-width:29mm; object-fit:contain) and
 * the @page A4 setup were confirmed directly from a reference system's
 * own print stylesheet — both act as pure ceilings (no forced width or
 * height), so the image renders at its own natural size unless that
 * exceeds the box, matching that reference exactly. This alone only
 * fixes the *box*; a source file with a lot of blank/transparent margin
 * baked in still looks small inside it regardless of the box size — see
 * src/lib/logoAutoCrop.ts (used at upload time) for the other half of
 * this, which trims that margin from the file itself.
 *
 * Phone/Email are opt-in per print/download, same as Signature/Stamp —
 * see PrintPdfActions.tsx.
 */
export function PrintLogoBlock({
  company,
  logoUrl,
  showPhone,
  showEmail,
}: {
  company: {
    legal_name: string | null;
    address: string | null;
    ntn: string | null;
    strn: string | null;
    phone: string | null;
    email: string | null;
  } | null;
  logoUrl: string | null;
  showPhone: boolean;
  showEmail: boolean;
}) {
  return (
    <div className="logo-block">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- print pages are plain server-rendered HTML captured for PDF/print, not part of the optimized client image pipeline.
        <img
          src={logoUrl}
          alt={`${company?.legal_name ?? "Company"} logo`}
          style={{ maxHeight: "18mm", maxWidth: "29mm", objectFit: "contain", flexShrink: 0 }}
        />
      ) : (
        <svg width="18mm" height="18mm" viewBox="0 0 40 40" style={{ flexShrink: 0 }}>
          <rect width="40" height="40" rx="9" fill="#2b3a55" />
          <polyline points="9,20 20,11 31,20" fill="none" stroke="#e08a4f" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="12" y="20" width="16" height="10" rx="1.4" fill="none" stroke="#e08a4f" strokeWidth="2.2" />
          <rect x="18.3" y="24.5" width="3.4" height="5.5" fill="#e08a4f" />
        </svg>
      )}
      <div>
        <div className="co-name">{company?.legal_name ?? "Company"}</div>
        {company?.address && <div className="muted">{company.address}</div>}
        <div className="muted">
          {company?.ntn && <>NTN: {company.ntn} </>}
          {company?.strn && <>STRN: {company.strn}</>}
        </div>
        {showPhone && company?.phone && <div className="muted">{company.phone}</div>}
        {showEmail && company?.email && <div className="muted">{company.email}</div>}
      </div>
    </div>
  );
}
