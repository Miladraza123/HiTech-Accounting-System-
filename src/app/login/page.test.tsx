import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/actions/auth", () => ({ signInAction: async () => ({ error: null }) }));

import LoginPage from "./page";

describe("LoginPage", () => {
  it("has a 'Keep me signed in' tick box, not ticked by default", () => {
    const html = renderToStaticMarkup(<LoginPage />);
    expect(html).toContain("Keep me signed in");
    expect(html).toContain('name="remember"');
    expect(html).not.toMatch(/name="remember"[^>]*checked/);
  });
});
