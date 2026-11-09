import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NavGroups, type NavCategory } from "./SidebarNav";

const cats: NavCategory[] = [
  { label: "", items: [{ href: "/", label: "Dashboard", show: true }] },
  { label: "Accounts", items: [{ href: "/payments", label: "Payments", show: true }, { href: "/expenses", label: "Expenses", show: true }] },
  { label: "HR", items: [{ href: "/hr/attendance", label: "Attendance", show: true, badge: 3 }, { href: "/hr/salary", label: "Salary", show: true, badge: 2 }] },
  { label: "Hidden", items: [{ href: "/x", label: "Secret", show: false }] },
];

describe("NavGroups", () => {
  it("opens only the group holding the current page; others stay closed", () => {
    const html = renderToStaticMarkup(<NavGroups categories={cats} pathname="/payments" />);
    expect(html).toContain("Payments");
    expect(html).toContain("Expenses");
    expect(html).not.toContain("Attendance");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-expanded="false"');
  });
  it("always shows ungrouped items and hides groups with nothing visible", () => {
    const html = renderToStaticMarkup(<NavGroups categories={cats} pathname="/payments" />);
    expect(html).toContain("Dashboard");
    expect(html).not.toContain("Hidden");
    expect(html).not.toContain("Secret");
  });
  it("shows the summed badge on a closed group so no alert is hidden", () => {
    const html = renderToStaticMarkup(<NavGroups categories={cats} pathname="/payments" />);
    expect(html).toContain(">5<");
  });
  it("opens a group when a nested page is current", () => {
    const html = renderToStaticMarkup(<NavGroups categories={cats} pathname="/hr/salary/abc" />);
    expect(html).toContain("Attendance");
    expect(html).not.toContain(">5<");
  });
});

describe("NavGroups: the longest matching link is the active one", () => {
  const cats: NavCategory[] = [
    { label: "", items: [{ href: "/tasks", label: "Tasks & Follow-ups", show: true }, { href: "/tasks/recurring", label: "Recurring Tasks", show: true }] },
  ];
  const activeCount = (html: string) => (html.match(/bg-accent-soft/g) ?? []).length;
  it("lights only Recurring Tasks on /tasks/recurring, not Tasks & Follow-ups too", () => {
    const html = renderToStaticMarkup(<NavGroups categories={cats} pathname="/tasks/recurring" />);
    expect(activeCount(html)).toBe(1);
    expect(html.indexOf("bg-accent-soft")).toBeGreaterThan(html.indexOf("Tasks &amp; Follow-ups"));
  });
  it("lights Tasks & Follow-ups on /tasks and on a task page", () => {
    expect(activeCount(renderToStaticMarkup(<NavGroups categories={cats} pathname="/tasks" />))).toBe(1);
    expect(activeCount(renderToStaticMarkup(<NavGroups categories={cats} pathname="/tasks/abc" />))).toBe(1);
  });
});
