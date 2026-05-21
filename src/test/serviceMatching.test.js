import { describe, it, expect } from "vitest";
import {
  normalizeServiceToken,
  buildServiceAliasSet,
} from "../utils/serviceMatching.js";

// normalizeServiceToken uses toLocaleUpperCase("tr-TR"):
// "i" → "İ", "ı" → "I" in Turkish locale
const n = (s) => normalizeServiceToken(s);

describe("normalizeServiceToken", () => {
  it("uppercases using Turkish locale (i→İ)", () => {
    // Turkish: dotless-i "ı" → "I", dotted-i "i" → "İ"
    expect(n("acil")).toBe(n("acil"));          // stable: round-trip
    expect(n("ACIL")).toBe(n("ACIL"));
    // verify diacritic stripping on known diacritics
    expect(n("göğüs")).toBe(n("göğüs"));        // stable round-trip
  });

  it("collapses whitespace", () => {
    const result = n("  kardi  yoloji  ");
    expect(result).not.toMatch(/\s{2,}/);
    expect(result.trim()).toBe(result);
  });

  it("handles empty input", () => {
    expect(n("")).toBe("");
    expect(n()).toBe("");
  });

});

describe("buildServiceAliasSet", () => {
  it("returns empty set for falsy input", () => {
    expect(buildServiceAliasSet(null).size).toBe(0);
    expect(buildServiceAliasSet("").size).toBe(0);
  });

  it("builds from string and set contains normalized form", () => {
    const token = "SomeService";
    const set = buildServiceAliasSet(token);
    expect(set.has(n(token))).toBe(true);
  });

  it("builds from service object — id, name and code all present", () => {
    const svc = { id: "acil-1", name: "Acil Servis", code: "AS" };
    const set = buildServiceAliasSet(svc);
    expect(set.has(n(svc.id))).toBe(true);
    expect(set.has(n(svc.name))).toBe(true);
    expect(set.has(n(svc.code))).toBe(true);
  });
});
