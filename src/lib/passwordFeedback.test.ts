import { describe, expect, it } from "vitest";
import {
  decodeWeakPasswordReasons,
  encodeWeakPasswordReasons,
  weakPasswordErrorMessage,
  weakPasswordErrorReasons,
  weakPasswordMessage,
  weakPasswordWarning,
} from "./passwordFeedback";

describe("weakPasswordMessage", () => {
  it("names the breach explicitly, because that is the reason people act on", () => {
    expect(weakPasswordMessage(["pwned"])).toBe(
      "This password can't be used because it has appeared in a known public data breach. Please choose a different one."
    );
  });

  it("reads as one sentence when Auth gives several reasons at once", () => {
    expect(weakPasswordMessage(["length", "characters"])).toBe(
      "This password can't be used because it is too short and it doesn't mix enough different kinds of character. Please choose a different one."
    );
    expect(weakPasswordMessage(["length", "characters", "pwned"])).toContain(
      "it is too short, it doesn't mix enough different kinds of character and it has appeared"
    );
  });

  it("falls back to a usable sentence rather than an empty one", () => {
    // No reasons, or a code this app has never seen, must still produce advice.
    expect(weakPasswordMessage([])).toBe(
      "This password doesn't meet the security requirements. Please choose a different one."
    );
    expect(weakPasswordMessage(undefined)).toContain("doesn't meet the security requirements");
    expect(weakPasswordMessage(["some_future_rule"])).toContain("doesn't meet the security requirements");
  });

  it("ignores unknown codes but still uses the ones it understands", () => {
    expect(weakPasswordMessage(["some_future_rule", "pwned"])).toContain("public data breach");
  });
});

describe("weakPasswordWarning", () => {
  it("addresses someone already signed in, not someone being refused", () => {
    expect(weakPasswordWarning(["pwned"])).toBe(
      "Your password should be changed because it has appeared in a known public data breach."
    );
    expect(weakPasswordWarning([])).toBe("Your password no longer meets the security requirements.");
  });
});

describe("weakPasswordErrorReasons", () => {
  it("recognises AuthWeakPasswordError, which is what supabase-js raises", () => {
    const err = { name: "AuthWeakPasswordError", status: 422, reasons: ["pwned"] };
    expect(weakPasswordErrorReasons(err)).toEqual(["pwned"]);
  });

  it("recognises the plain error code used by newer Auth API versions", () => {
    expect(weakPasswordErrorReasons({ code: "weak_password", reasons: ["length"] })).toEqual(["length"]);
  });

  it("copes with a weak-password error that carries no reasons", () => {
    expect(weakPasswordErrorReasons({ code: "weak_password" })).toEqual([]);
    expect(weakPasswordErrorMessage({ code: "weak_password" })).toContain("doesn't meet the security requirements");
  });

  it("returns null for every other error, so those keep Supabase's own wording", () => {
    expect(weakPasswordErrorReasons({ name: "AuthApiError", message: "Invalid login credentials" })).toBeNull();
    expect(weakPasswordErrorReasons(null)).toBeNull();
    expect(weakPasswordErrorReasons(undefined)).toBeNull();
    expect(weakPasswordErrorReasons("weak_password")).toBeNull();
    expect(weakPasswordErrorMessage({ message: "Network error" })).toBeNull();
  });

  it("drops non-string entries rather than rendering undefined into the sentence", () => {
    const err = { code: "weak_password", reasons: ["pwned", 7, null] };
    expect(weakPasswordErrorReasons(err)).toEqual(["pwned"]);
  });
});

describe("weak-password cookie round trip", () => {
  it("survives being written and read back", () => {
    expect(decodeWeakPasswordReasons(encodeWeakPasswordReasons(["length", "pwned"]))).toEqual(["length", "pwned"]);
  });

  it("is empty when the cookie is absent or blank", () => {
    expect(decodeWeakPasswordReasons(undefined)).toEqual([]);
    expect(decodeWeakPasswordReasons("")).toEqual([]);
  });

  it("refuses anything that isn't a plain reason code", () => {
    // The cookie is httpOnly, but it still comes back from the browser, so it
    // is treated as input rather than as something the server wrote.
    expect(encodeWeakPasswordReasons(["pwned", "<script>", "a b"])).toBe("pwned");
    expect(decodeWeakPasswordReasons("pwned,<script>alert(1)</script>,length")).toEqual(["pwned", "length"]);
  });
});
