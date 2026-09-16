/* eslint-disable @next/next/no-img-element -- served by our own /api/company-logo route as plain bytes, not through the optimizer. */
import { Logo } from "@/components/Logo";

/**
 * The company's own uploaded logo, used for the app's branding (sidebar,
 * mobile nav, login). Falls back to the built-in mark when no logo has been
 * uploaded, so a fresh deployment looks exactly as it did before.
 *
 * `.company-logo` gives it a light backdrop in dark mode only. That is not
 * decoration: this logo was measured at 63% dark pixels, and its "Engineering"
 * wordmark and tagline are near-black, so on the dark theme's surface they
 * disappear almost entirely — the same problem the splash screen hit, solved
 * the same way. An uploaded logo can be any colours at all, so the backdrop
 * is applied unconditionally rather than guessed at per-image.
 */
/**
 * Sized by WIDTH, not height. A letterhead logo is a wide lockup — this
 * one is 1.42:1 — so pinning a small height shrinks the wordmark and
 * tagline past the point of being readable. Width is what the brand row
 * actually has to spend.
 */
export function CompanyLogo({
  hasLogo,
  width,
  fallbackSize = 32,
  className = "",
  alt = "",
}: {
  hasLogo: boolean;
  width: number;
  fallbackSize?: number;
  className?: string;
  alt?: string;
}) {
  if (!hasLogo) return <Logo size={fallbackSize} className={className} />;
  return (
    <span className={`company-logo ${className}`}>
      <img src="/api/company-logo" alt={alt} style={{ width, height: "auto" }} />
    </span>
  );
}
