export type LetterheadCompany = {
  name: string;
  phone: string | null;
  phone2: string | null;
  email: string | null;
  email2: string | null;
  address: string | null;
  ntn: string | null;
  strn: string | null;
};

const ICON = { width: 13, height: 13, viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": true } as const;

function PhoneIcon() {
  return (
    <svg {...ICON}>
      <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z" />
    </svg>
  );
}
function MailIcon() {
  return (
    <svg {...ICON} fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <path d="M3.5 6.5 12 13l8.5-6.5" />
    </svg>
  );
}
function HomeIcon() {
  return (
    <svg {...ICON}>
      <path d="M12 3 2 12h3v8h5v-5h4v5h5v-8h3z" />
    </svg>
  );
}

/** NTN and STRN are shown separately, whichever of the two exist. */
export function registrationItems(c: Pick<LetterheadCompany, "ntn" | "strn">): string[] {
  return [c.ntn ? `NTN: ${c.ntn}` : null, c.strn ? `STRN: ${c.strn}` : null].filter((x): x is string => !!x);
}

/**
 * The letterhead header, drawn in code (teal band with the two diagonal stripes)
 * so every detail in it comes from the Company Profile: logo, phones, emails,
 * address, NTN and STRN. Change them there and the next printout follows.
 */
export function LetterheadHeader({ company, logoUrl }: { company: LetterheadCompany; logoUrl: string | null }) {
  const rows: { icon: React.ReactNode; text: string }[] = [
    ...[company.phone, company.phone2].filter((x): x is string => !!x).map((text) => ({ icon: <PhoneIcon />, text })),
    ...[company.email, company.email2].filter((x): x is string => !!x).map((text) => ({ icon: <MailIcon />, text })),
    ...(company.address ? [{ icon: <HomeIcon />, text: company.address }] : []),
  ];
  const reg = registrationItems(company);

  return (
    <div className="lh-hdr">
      <div className="lh-band">
        <svg className="lh-band-art" viewBox="0 0 1081 195" preserveAspectRatio="none" aria-hidden>
          <polygon points="399.6,0 441.6,0 371.4,195 329.4,195" fill="#cfcfcf" />
          <polygon points="441.6,0 489.6,0 419.4,195 371.4,195" fill="#b4d8d4" />
          <polygon points="489.6,0 1081,0 1081,195 419.4,195" fill="#00837b" />
        </svg>
        <div className="lh-logo">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- print page: plain server-rendered HTML captured for PDF/print, see PrintLogoBlock.tsx
            <img src={logoUrl} alt={`${company.name} logo`} />
          ) : (
            <span className="lh-logo-text">{company.name}</span>
          )}
        </div>
        <div className="lh-contact">
          {rows.map((r, i) => (
            <div key={i} className="lh-row">
              <span className="lh-ico">{r.icon}</span>
              <span>{r.text}</span>
            </div>
          ))}
        </div>
      </div>
      {reg.length > 0 && (
        <div className="lh-reg">
          {reg.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}
