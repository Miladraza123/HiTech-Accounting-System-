// Pakistan Standard Time formatting (UTC+5, no DST — Asia/Karachi never
// observes daylight saving). The app already computes Karachi time on the fly
// in a couple of places via Intl (e.g. the dashboard's time-of-day greeting
// in reports/page.tsx) rather than storing it — these three helpers are that
// same approach, pulled into one place for the Activity Log, which is the
// first screen in this app where every single row's time matters (not just
// a date, and not just "now").
//
// backup.js has its own, separate karachiParts()/takenAtText() — deliberately
// not shared with this file, since that script lives outside the Next.js app
// bundle by design (see its own header comment) and cannot import from src/.

const KARACHI_TZ = "Asia/Karachi";

/** "2026-09-17" in Karachi's calendar day — the grouping key for same-day rows. */
export function karachiDateKey(iso: string): string {
  // en-CA is the standard Intl trick for a YYYY-MM-DD string.
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: KARACHI_TZ });
}

const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * "17 Sep 2026" — a day section's heading. Built from numeric parts rather
 * than asking Intl for a `month: "short"` string directly: that abbreviation
 * is locale-dependent in a way that isn't obvious from the locale tag alone
 * (en-GB renders September as "Sept", not "Sep", in this Node/ICU build) —
 * spelling this out explicitly keeps the heading's format predictable.
 */
export function karachiDateLabel(iso: string): string {
  const parts = new Date(iso).toLocaleDateString("en-CA", { timeZone: KARACHI_TZ }).split("-");
  const [year, month, day] = parts;
  return `${day} ${SHORT_MONTHS[Number(month) - 1]} ${year}`;
}

/** "08:01:25" — 24-hour, down to the second, matching what was asked for. */
export function karachiTimeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: KARACHI_TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
