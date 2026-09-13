/**
 * The left half of every print page's header — identical across all 5
 * document types before this, now the one place that decides between
 * an uploaded company logo image and the original generic mark
 * (unchanged fallback, so nothing changes for a deployment that hasn't
 * uploaded one). Plain server-renderable markup — no client JS needed.
 */
export function PrintLogoBlock({
  company,
  logoUrl,
}: {
  company: { legal_name: string | null; address: string | null; ntn: string | null; strn: string | null } | null;
  logoUrl: string | null;
}) {
  return (
    <div className="logo-block">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- print pages are plain server-rendered HTML captured for PDF/print, not part of the optimized client image pipeline.
        <img src={logoUrl} alt={`${company?.legal_name ?? "Company"} logo`} style={{ width: 46, height: 46, objectFit: "contain", flexShrink: 0 }} />
      ) : (
        <svg width="46" height="46" viewBox="0 0 40 40" style={{ flexShrink: 0 }}>
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
      </div>
    </div>
  );
}
