import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

const signOut = vi.fn(async () => ({ error: null }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "u1" } } }),
      signOut,
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { nextLevel: "aal1", currentLevel: "aal1" } }) },
    },
  }),
}));

import { proxy } from "./proxy";

const req = (path: string, cookie: string) => new NextRequest(`http://localhost${path}`, { headers: { cookie } });
const HOUR = 60 * 60 * 1000;

describe("proxy: idle sign-out", () => {
  it("signs out a not-kept session idle for more than an hour and sends it to the login page", async () => {
    signOut.mockClear();
    const res = await proxy(req("/tasks", `hitech_remember=0; hitech_last_active=${Date.now() - 2 * HOUR}`));
    expect(signOut).toHaveBeenCalledOnce();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/login?reason=idle");
    const cleared = res.cookies.getAll().map((c) => c.name);
    expect(cleared).toContain("hitech_remember");
    expect(cleared).toContain("hitech_last_active");
  });

  it("leaves a not-kept session that was active a few minutes ago alone", async () => {
    signOut.mockClear();
    const res = await proxy(req("/tasks", `hitech_remember=0; hitech_last_active=${Date.now() - 5 * 60 * 1000}`));
    expect(signOut).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it("never signs out a kept session, however long it was idle", async () => {
    signOut.mockClear();
    const res = await proxy(req("/tasks", `hitech_remember=1; hitech_last_active=${Date.now() - 48 * HOUR}`));
    expect(signOut).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it("leaves a session from before this feature (no choice cookie) alone", async () => {
    signOut.mockClear();
    const res = await proxy(req("/tasks", ""));
    expect(signOut).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it("does not guess when no activity time is recorded", async () => {
    signOut.mockClear();
    const res = await proxy(req("/tasks", "hitech_remember=0"));
    expect(signOut).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });
});
