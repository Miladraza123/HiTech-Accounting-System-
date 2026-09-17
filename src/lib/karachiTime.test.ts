import { describe, expect, it } from "vitest";
import { karachiDateKey, karachiDateLabel, karachiTimeLabel } from "./karachiTime";

describe("Karachi time formatting", () => {
  it("converts UTC to Pakistan Standard Time (UTC+5)", () => {
    // 03:06:47 UTC -> 08:06:47 PKT, same calendar day.
    expect(karachiTimeLabel("2026-09-17T03:06:47.091456+00:00")).toBe("08:06:47");
    expect(karachiDateKey("2026-09-17T03:06:47.091456+00:00")).toBe("2026-09-17");
    expect(karachiDateLabel("2026-09-17T03:06:47.091456+00:00")).toBe("17 Sep 2026");
  });

  it("rolls into the next Karachi day for a late-evening UTC timestamp", () => {
    // This is the case that actually matters: PKT is 5 hours AHEAD of UTC, so
    // an action at 19:30 UTC already reads as 00:30 the next day in Pakistan.
    // Grouping this row under its UTC date would put it in the wrong day's
    // section on screen.
    expect(karachiTimeLabel("2026-09-16T19:30:00+00:00")).toBe("00:30:00");
    expect(karachiDateKey("2026-09-16T19:30:00+00:00")).toBe("2026-09-17");
    expect(karachiDateLabel("2026-09-16T19:30:00+00:00")).toBe("17 Sep 2026");
  });

  it("does not roll over for a timestamp just before the PKT day boundary", () => {
    // 18:59:59 UTC -> 23:59:59 PKT, still the same day.
    expect(karachiTimeLabel("2026-09-16T18:59:59+00:00")).toBe("23:59:59");
    expect(karachiDateKey("2026-09-16T18:59:59+00:00")).toBe("2026-09-16");
  });

  it("has no daylight-saving jump across the year", () => {
    // Asia/Karachi has not observed DST since 2009. A January timestamp
    // should convert with the exact same +5:00 offset as a July one.
    expect(karachiTimeLabel("2026-01-15T00:00:00+00:00")).toBe("05:00:00");
    expect(karachiTimeLabel("2026-07-15T00:00:00+00:00")).toBe("05:00:00");
  });
});
