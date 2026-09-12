// Shared Order Health / Stage Aging logic (prompt's Order Health Indicator
// and Stage-wise Aging Report asks) — used by the Sales Order, Purchase
// Order and Job list pages (small health badge per row) and by the
// /reports/order-health Stage Aging dashboard, so every screen agrees on
// what "On Track" vs "At Risk" vs "Delayed" vs "Stalled" means.
//
// "Days in current stage" is computed as days-since-updated_at — every
// status transition in this system already goes through a plain UPDATE,
// which the existing trg_updated_at trigger stamps, so this needs no new
// stage-history table. A true stage-by-stage history (recording exactly
// when each individual status was entered) would be materially bigger and
// isn't required for the health/aging signal itself — a documented scope
// choice, not an oversight.
export type HealthLabel = "OnTrack" | "AtRisk" | "Delayed" | "Stalled";

export type HealthResult = { label: HealthLabel; tone: "good" | "warn" | "bad"; reason: string };

export const HEALTH_LABEL_TEXT: Record<HealthLabel, string> = {
  OnTrack: "On Track",
  AtRisk: "At Risk",
  Delayed: "Delayed",
  Stalled: "Stalled",
};

export const HEALTH_BADGE_STYLE: Record<HealthLabel, string> = {
  OnTrack: "bg-good-soft text-good",
  AtRisk: "bg-warn-soft text-warn",
  Delayed: "bg-bad-soft text-bad",
  Stalled: "bg-warn-soft text-warn",
};

/** A promised/expected date within this many days still counts as "At Risk" rather than fine. */
const AT_RISK_WINDOW_DAYS = 3;
/** No stage movement in this many days, with no promised date to judge by, counts as "Stalled". */
const STALLED_DAYS = 10;

export function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

/** Negative = already in the past. */
export function daysUntil(dateStr: string): number {
  return Math.floor((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

/**
 * @param isOpen false for a terminal status (Delivered/Invoiced/Closed/Cancelled/Received/etc) — health doesn't apply once an order is done, so returns null.
 * @param promisedDate delivery_schedule / required_delivery_date / expected_delivery, whichever the entity has.
 * @param updatedAt the row's updated_at — stamped by trg_updated_at on every status change.
 */
export function computeHealth(input: { isOpen: boolean; promisedDate: string | null; updatedAt: string }): HealthResult | null {
  if (!input.isOpen) return null;

  if (input.promisedDate) {
    const until = daysUntil(input.promisedDate);
    if (until < 0) {
      return { label: "Delayed", tone: "bad", reason: `Promised date ${Math.abs(until)} din pehle guzar chuki hai.` };
    }
    if (until <= AT_RISK_WINDOW_DAYS) {
      return { label: "AtRisk", tone: "warn", reason: `Promised date sirf ${until} din door hai.` };
    }
  }

  const stageDays = daysSince(input.updatedAt);
  if (stageDays > STALLED_DAYS) {
    return { label: "Stalled", tone: "warn", reason: `${stageDays} din se is stage mein koi progress nahi hui.` };
  }

  return { label: "OnTrack", tone: "good", reason: "" };
}
