import { describe, it, expect, beforeEach } from "vitest";
import { pad2, ymKey, readActiveYM, writeActiveYM, LS } from "../utils/storage.js";

beforeEach(() => localStorage.clear());

describe("pad2", () => {
  it("pads single-digit numbers", () => expect(pad2(5)).toBe("05"));
  it("leaves two-digit numbers unchanged", () => expect(pad2(12)).toBe("12"));
});

describe("ymKey", () => {
  it("formats year-month key", () => expect(ymKey(2026, 5)).toBe("2026-05"));
  it("pads single-digit month", () => expect(ymKey(2025, 1)).toBe("2025-01"));
});

describe("readActiveYM / writeActiveYM", () => {
  it("returns null when nothing stored", () => expect(readActiveYM()).toBeNull());

  it("round-trips year/month", () => {
    writeActiveYM(2026, 7);
    expect(readActiveYM()).toEqual({ year: 2026, month: 7 });
  });

  it("clamps month to 1-12", () => {
    writeActiveYM(2026, 0);
    expect(readActiveYM()?.month).toBe(1);
    writeActiveYM(2026, 15);
    expect(readActiveYM()?.month).toBe(12);
  });
});

describe("LS wrapper", () => {
  it("returns default when key missing", () => {
    expect(LS.get("missing", "default")).toBe("default");
  });

  it("round-trips JSON values", () => {
    LS.set("obj", { a: 1 });
    expect(LS.get("obj")).toEqual({ a: 1 });
  });

  it("removes key", () => {
    LS.set("temp", 42);
    LS.remove("temp");
    expect(LS.get("temp")).toBeNull();
  });

  it("blocks values over 2 MB", () => {
    const huge = "x".repeat(2.1 * 1024 * 1024);
    const result = LS.set("huge", huge);
    expect(result).toBe(false);
  });
});
