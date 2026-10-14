import { describe, expect, it } from "vitest";
import { distinctProjects } from "./dcProjects";

describe("distinctProjects", () => {
  it("lists each name once, newest first, ignoring case and spaces", () => {
    const rows = [
      { project: "Berth 5 Crane Repair", created_at: "2026-10-10T08:00:00Z" },
      { project: "  berth 5 crane repair ", created_at: "2026-10-12T08:00:00Z" },
      { project: "Chiller Overhaul", created_at: "2026-10-11T08:00:00Z" },
      { project: null, created_at: "2026-10-13T08:00:00Z" },
      { project: "   ", created_at: "2026-10-13T09:00:00Z" },
    ];
    expect(distinctProjects(rows)).toEqual(["berth 5 crane repair", "Chiller Overhaul"]);
  });
  it("returns nothing when no challan has a project", () => {
    expect(distinctProjects([{ project: null }])).toEqual([]);
  });
});
