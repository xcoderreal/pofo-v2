import { describe, expect, test } from "bun:test";
import {
  formatPercent,
  formatShares,
  formatSigned,
  formatUsd,
} from "@/lib/format";

describe("formatUsd", () => {
  test("keeps cents below five figures", () => {
    expect(formatUsd(1234.5)).toBe("$1,234.50");
  });

  test("drops cents once they stop carrying information", () => {
    expect(formatUsd(123456.78)).toBe("$123,457");
  });

  test("negatives use a real minus sign, not a hyphen", () => {
    expect(formatUsd(-12.5)).toBe("−$12.50");
  });
});

describe("formatSigned", () => {
  test("always carries an explicit sign", () => {
    expect(formatSigned(120)).toBe("+$120.00");
    expect(formatSigned(-3.4)).toBe("−$3.40");
  });

  test("zero reads as a gain of nothing, not a loss", () => {
    expect(formatSigned(0)).toBe("+$0.00");
  });
});

describe("formatPercent", () => {
  test("two decimals with an explicit sign", () => {
    expect(formatPercent(12.345)).toBe("+12.35%");
    expect(formatPercent(-0.5)).toBe("−0.50%");
  });

  test("null renders as a dash — never a fabricated zero", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(null)).not.toBe("+0.00%");
  });
});

describe("formatShares", () => {
  test("whole counts carry no trailing zeros", () => {
    expect(formatShares(120)).toBe("120");
  });

  test("fractional counts keep enough precision for crypto", () => {
    expect(formatShares(0.85)).toBe("0.85");
  });
});
