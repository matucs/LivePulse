import { describe, expect, it } from "vitest";
import { mapStatus } from "../../../src/providers/mappers/statusMap.js";

describe("mapStatus", () => {
  it.each([
    ["NS", "scheduled"],
    ["1H", "live"],
    ["2H", "live"],
    ["HT", "halftime"],
    ["FT", "finished"],
    ["PST", "postponed"],
    ["CANC", "cancelled"],
  ] as const)("maps %s to %s", (code, expected) => {
    expect(mapStatus(code)).toBe(expected);
  });

  it("throws on an unrecognized status code rather than silently defaulting", () => {
    expect(() => mapStatus("NOT_A_REAL_CODE")).toThrow(/Unrecognized/);
  });
});
