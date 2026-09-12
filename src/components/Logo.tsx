/**
 * The HiTech ERP mark — a warehouse roof + body on a ledger-navy badge,
 * replacing the old plain "H" monogram square. Colors are fixed brand
 * colors (not theme tokens) so the mark reads the same in light and dark.
 */
export function Logo({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" className={`shrink-0 ${className}`}>
      <rect width="40" height="40" rx="9" fill="#2b3a55" />
      <polyline points="9,20 20,11 31,20" fill="none" stroke="#e08a4f" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="12" y="20" width="16" height="10" rx="1.4" fill="none" stroke="#e08a4f" strokeWidth="2.2" />
      <rect x="18.3" y="24.5" width="3.4" height="5.5" fill="#e08a4f" />
      <rect x="12" y="33.4" width="16" height="1.6" rx="0.8" fill="#9db3d6" opacity="0.75" />
    </svg>
  );
}
