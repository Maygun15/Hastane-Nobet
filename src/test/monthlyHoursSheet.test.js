import { describe, expect, it } from "vitest";
import {
  resolveCellHours,
  shouldUseOfficialRows,
  sumRowsWorkedHours,
  sumTruthEntryHours,
} from "../components/MonthlyHoursSheet.jsx";

const juneDays = Array.from({ length: 30 }, (_, i) => {
  const day = i + 1;
  return {
    d: day,
    ymd: `2026-06-${String(day).padStart(2, "0")}`,
  };
});

describe("MonthlyHoursSheet schedule truth totals", () => {
  it("counts V1 as a 16 hour working shift", () => {
    expect(resolveCellHours("V1", {}, "")).toBe(16);
  });

  it("includes V1 contributions in truth total hours", () => {
    const truthEntries = [
      {
        personId: "p1",
        personName: "V1 Person",
        byDay: { 1: 16, 2: 16 },
      },
      {
        personId: "p2",
        personName: "Night Person",
        byDay: { 1: 24 },
      },
    ];

    expect(sumTruthEntryHours(truthEntries)).toBe(56);
  });

  it("detects manual rows missing V1 hours compared with schedule truth", () => {
    const manualRows = [
      { adsoyad: "Supervisor 1", days: { "2026-06-01": 8 } },
      { adsoyad: "Supervisor 2", days: { "2026-06-01": 8 } },
      ...Array.from({ length: 9 }, (_, i) => ({
        adsoyad: `Night ${i + 1}`,
        days: { "2026-06-01": 24 },
      })),
    ];
    const truthEntries = [
      { personId: "m1", byDay: { 1: 8 } },
      { personId: "m2", byDay: { 1: 8 } },
      ...Array.from({ length: 9 }, (_, i) => ({ personId: `n${i}`, byDay: { 1: 24 } })),
      ...Array.from({ length: 4 }, (_, i) => ({ personId: `v${i}`, byDay: { 1: 16 } })),
    ];

    const renderedTotal = sumRowsWorkedHours(manualRows, juneDays, {});
    const truthTotal = sumTruthEntryHours(truthEntries);

    expect(renderedTotal).toBe(232);
    expect(truthTotal).toBe(296);
    expect(truthTotal - renderedTotal).toBe(64);
  });

  it("matches the June truth total when V1 and M contributions are included", () => {
    const excelTotal = 7336;
    const missingV1 = 128 * 16;
    const missingM = 8 * 8;

    expect(excelTotal + missingV1 + missingM).toBe(9448);
    expect(sumTruthEntryHours([
      { personId: "excel-total", byDay: { 1: excelTotal } },
      { personId: "v1-total", byDay: { 1: missingV1 } },
      { personId: "m-total", byDay: { 1: missingM } },
    ])).toBe(9448);
  });

  it("uses official truth by default even when local/manual rows exist", () => {
    expect(shouldUseOfficialRows({
      hasOfficialTruth: true,
      manualMode: false,
      manualModeExplicit: false,
    })).toBe(true);

    expect(shouldUseOfficialRows({
      hasOfficialTruth: true,
      manualMode: true,
      manualModeExplicit: false,
    })).toBe(true);
  });

  it("uses manual rows only after explicit manual activation", () => {
    expect(shouldUseOfficialRows({
      hasOfficialTruth: true,
      manualMode: true,
      manualModeExplicit: true,
    })).toBe(false);
  });

  it("does not use official rows when no official truth exists", () => {
    expect(shouldUseOfficialRows({
      hasOfficialTruth: false,
      manualMode: false,
      manualModeExplicit: false,
    })).toBe(false);
  });
});
