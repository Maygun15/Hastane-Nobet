import { describe, expect, it } from "vitest";
import { fromLegacyMonth } from "../hooks/useActiveYM.js";

describe("fromLegacyMonth", () => {
  it("does not treat missing values as January", () => {
    expect(fromLegacyMonth(null)).toBeNull();
    expect(fromLegacyMonth(undefined)).toBeNull();
    expect(fromLegacyMonth("")).toBeNull();
    expect(fromLegacyMonth("   ")).toBeNull();
  });

  it("keeps legacy zero-based month values working", () => {
    expect(fromLegacyMonth("0")).toBe(1);
    expect(fromLegacyMonth("11")).toBe(12);
  });

  it("keeps the existing parser behavior for numeric one-based strings", () => {
    expect(fromLegacyMonth("12")).toBe(12);
  });
});
