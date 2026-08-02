import { describe, expect, test } from "bun:test";
import { instrumentIdFromSymbol } from "../../../lib/instruments";

describe("instrumentIdFromSymbol", () => {
  test("lowercases the symbol", () => {
    expect(instrumentIdFromSymbol("GOOG")).toBe("goog");
  });

  test("trims surrounding whitespace before lowercasing", () => {
    expect(instrumentIdFromSymbol("  BTC  ")).toBe("btc");
  });
});
