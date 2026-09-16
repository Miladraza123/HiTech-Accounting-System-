import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { computeHealth, daysSince, daysUntil } from "./orderHealth";

// Every fixture below is built relative to "now", and the assertions then
// read the clock again. Without freezing it, a future fixture is n days
// ahead of the moment it was BUILT but slightly less than n days ahead of
// the moment it is CHECKED — so `daysUntil` floors to n-1 whenever the
// millisecond ticks between the two statements. Measured at ~0.115% of
// runs (roughly 1 in 870), which is exactly the intermittent failure this
// file used to produce. Freezing the clock removes the ambiguity without
// weakening a single assertion; `daysSince` was never affected, since
// elapsed time only ever adds to a past interval.
beforeAll(() => {
  vi.useFakeTimers({ now: new Date("2026-06-15T12:00:00.000Z") });
});
afterAll(() => {
  vi.useRealTimers();
});

function daysAgoIso(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function daysFromNowIso(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString();
}

describe("daysSince / daysUntil", () => {
  it("daysSince is ~0 for right now and positive for the past", () => {
    expect(daysSince(daysAgoIso(0))).toBe(0);
    expect(daysSince(daysAgoIso(5))).toBe(5);
  });

  it("daysUntil is negative for a date already in the past", () => {
    expect(daysUntil(daysAgoIso(5))).toBe(-5);
  });

  it("daysUntil is positive for a future date", () => {
    expect(daysUntil(daysFromNowIso(5))).toBe(5);
  });
});

describe("computeHealth", () => {
  it("returns null once the order is no longer open (terminal status)", () => {
    expect(computeHealth({ isOpen: false, promisedDate: daysAgoIso(30), updatedAt: daysAgoIso(30) })).toBeNull();
  });

  it("flags Delayed when the promised date has already passed", () => {
    const res = computeHealth({ isOpen: true, promisedDate: daysAgoIso(2), updatedAt: daysAgoIso(1) });
    expect(res?.label).toBe("Delayed");
    expect(res?.tone).toBe("bad");
  });

  it("flags AtRisk when the promised date is within the risk window", () => {
    const res = computeHealth({ isOpen: true, promisedDate: daysFromNowIso(2), updatedAt: daysAgoIso(1) });
    expect(res?.label).toBe("AtRisk");
    expect(res?.tone).toBe("warn");
  });

  it("is OnTrack when the promised date is comfortably in the future and the stage is recent", () => {
    const res = computeHealth({ isOpen: true, promisedDate: daysFromNowIso(20), updatedAt: daysAgoIso(1) });
    expect(res?.label).toBe("OnTrack");
    expect(res?.tone).toBe("good");
  });

  it("flags Stalled when there's no promised date and the stage hasn't moved in a long time", () => {
    const res = computeHealth({ isOpen: true, promisedDate: null, updatedAt: daysAgoIso(15) });
    expect(res?.label).toBe("Stalled");
    expect(res?.tone).toBe("warn");
  });

  it("is OnTrack when there's no promised date but the stage is recent", () => {
    const res = computeHealth({ isOpen: true, promisedDate: null, updatedAt: daysAgoIso(2) });
    expect(res?.label).toBe("OnTrack");
  });

  it("a comfortable promised date does not mask a stalled stage — date takes priority only when it applies", () => {
    // Promised date is far out (not yet at-risk), but the stage itself has been stuck a long time.
    const res = computeHealth({ isOpen: true, promisedDate: daysFromNowIso(30), updatedAt: daysAgoIso(15) });
    expect(res?.label).toBe("Stalled");
  });
});
