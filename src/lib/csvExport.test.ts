import { describe, expect, it } from "vitest";
import { escapeCsvField, toCsv } from "./csvExport";

describe("escapeCsvField", () => {
  it("neutralises values a spreadsheet would run as a formula", () => {
    expect(escapeCsvField("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(escapeCsvField("+cmd")).toBe("'+cmd");
    expect(escapeCsvField("-2+3")).toBe("'-2+3");
    expect(escapeCsvField("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(escapeCsvField("\tTAB")).toBe("'\tTAB");
    expect(escapeCsvField("\rx")).toBe("\"'\rx\"");
  });

  it("leaves plain and negative numbers numeric", () => {
    expect(escapeCsvField(-1500)).toBe("-1500");
    expect(escapeCsvField("-1500.50")).toBe("-1500.50");
    expect(escapeCsvField("Al-Karam")).toBe("Al-Karam");
  });

  it("quotes commas, quotes, newlines and carriage returns", () => {
    expect(escapeCsvField("a,b")).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvField("line1\rline2")).toBe('"line1\rline2"');
    expect(escapeCsvField(null)).toBe("");
  });
});

describe("toCsv", () => {
  it("applies the escaping to headers and rows", () => {
    expect(toCsv(["Name"], [["=1+1"]])).toBe("﻿Name\r\n'=1+1");
  });
});
