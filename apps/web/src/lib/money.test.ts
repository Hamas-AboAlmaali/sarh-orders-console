import { describe, expect, it } from "vitest";
import { parseMoneyInput } from "./money";

describe("parseMoneyInput", () => {
  it.each([
    ["12", 1_200],
    ["12.5", 1_250],
    ["12.50", 1_250],
    ["0.07", 7],
    [" 19.99 ", 1_999],
    // 1.15 * 100 is 114.99999999999999 in floating point.
    ["1.15", 115],
    ["1234567.89", 123_456_789],
  ])("parses %j as %i cents", (input, cents) => {
    expect(parseMoneyInput(input)).toBe(cents);
  });

  it.each(["", "abc", "-5", "1.234", "1,000", "12.", ".5", "12345678"])("rejects %j", (input) => {
    expect(parseMoneyInput(input)).toBeNull();
  });
});
