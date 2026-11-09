import { describe, it, expect } from "vitest";
import { IDLE_GRACE_MS, IDLE_LIMIT_MS, isIdleExpired, isSessionOnly, serializeCookie, withoutLifetime } from "./sessionPolicy";

describe("isSessionOnly", () => {
  it("only an explicit '0' means not kept; no cookie (older sessions) behaves as before", () => {
    expect(isSessionOnly("0")).toBe(true);
    expect(isSessionOnly("1")).toBe(false);
    expect(isSessionOnly(undefined)).toBe(false);
    expect(isSessionOnly(null)).toBe(false);
    expect(isSessionOnly("")).toBe(false);
  });
});

describe("isIdleExpired", () => {
  const now = 1_800_000_000_000;
  it("is expired only for a session-only user idle beyond the limit plus slack", () => {
    expect(isIdleExpired("0", String(now - IDLE_LIMIT_MS - IDLE_GRACE_MS - 1000), now)).toBe(true);
    expect(isIdleExpired("0", String(now - IDLE_LIMIT_MS), now)).toBe(false); // inside the slack
    expect(isIdleExpired("0", String(now - 10 * 60 * 1000), now)).toBe(false);
  });
  it("never expires a kept or older session", () => {
    const old = String(now - 10 * IDLE_LIMIT_MS);
    expect(isIdleExpired("1", old, now)).toBe(false);
    expect(isIdleExpired(undefined, old, now)).toBe(false);
  });
  it("does not guess when no activity is recorded or the value is junk", () => {
    expect(isIdleExpired("0", undefined, now)).toBe(false);
    expect(isIdleExpired("0", "abc", now)).toBe(false);
    expect(isIdleExpired("0", "0", now)).toBe(false);
  });
});

describe("withoutLifetime", () => {
  it("drops max-age and expires so the cookie ends with the browser", () => {
    expect(withoutLifetime({ path: "/", maxAge: 100, expires: new Date(0), sameSite: "lax" })).toEqual({ path: "/", sameSite: "lax" });
  });
  it("keeps a deletion (max-age 0) as it is", () => {
    expect(withoutLifetime({ path: "/", maxAge: 0 })).toEqual({ path: "/", maxAge: 0 });
  });
  it("passes undefined through", () => {
    expect(withoutLifetime(undefined)).toBeUndefined();
  });
});

describe("serializeCookie", () => {
  it("builds a session cookie without Max-Age", () => {
    expect(serializeCookie("a", "b c", { sameSite: "lax" })).toBe("a=b%20c; Path=/; SameSite=Lax");
  });
  it("adds Max-Age, Domain and Secure when given", () => {
    const s = serializeCookie("a", "1", { maxAge: 60, domain: "x.com", secure: true, sameSite: "strict", path: "/app" });
    expect(s).toBe("a=1; Path=/app; Domain=x.com; Max-Age=60; SameSite=Strict; Secure");
  });
});
