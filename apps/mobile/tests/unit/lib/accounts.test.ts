import { describe, expect, test } from "bun:test";
import { accountIdFromName } from "../../../lib/accounts";

describe("accountIdFromName", () => {
  test("slugifies a simple name", () => {
    expect(accountIdFromName("Wells Fargo Brokerage")).toBe(
      "wells-fargo-brokerage",
    );
  });

  test("collapses punctuation and trims leading/trailing hyphens", () => {
    expect(accountIdFromName("  Fidelity — IRA! ")).toBe("fidelity-ira");
  });
});
