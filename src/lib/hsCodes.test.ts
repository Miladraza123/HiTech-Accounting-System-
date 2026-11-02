import { describe, it, expect } from "vitest";
import { parseHsCodes } from "./hsCodes";

describe("parseHsCodes", () => {
  it("splits on new lines, commas, semicolons and spaces, keeping order", () => {
    expect(parseHsCodes("3907.9100\n7019.1500")).toEqual(["3907.9100", "7019.1500"]);
    expect(parseHsCodes("3907.9100, 7019.1500; 8481.8090  7326.9090")).toEqual(["3907.9100", "7019.1500", "8481.8090", "7326.9090"]);
  });
  it("drops blanks and repeats", () => {
    expect(parseHsCodes(" ,3907.9100,,3907.9100 \n")).toEqual(["3907.9100"]);
  });
  it("is empty for nothing", () => {
    expect(parseHsCodes(null)).toEqual([]);
    expect(parseHsCodes(undefined)).toEqual([]);
    expect(parseHsCodes("   ")).toEqual([]);
  });
});
