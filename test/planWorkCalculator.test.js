import test from "node:test";
import assert from "node:assert/strict";

const {
  createPlanWorkHourResolver,
  sumWorkedHoursForPersonMonth,
} = await import("../src/utils/planWorkCalculator.js");

test("resolves shift hours from alternative workingHours field names", () => {
  const resolveHours = createPlanWorkHourResolver([
    {
      vardiyaKodu: "V1",
      from: "08:00",
      to: "00:00",
      title: "Yeşil Alan",
    },
  ]);

  assert.equal(resolveHours("V1", "Yeşil"), 16);
});

test("keeps V1 fallback at 16 hours when no explicit definition exists", () => {
  const resolveHours = createPlanWorkHourResolver([]);
  assert.equal(resolveHours("V1", "TRİAJ"), 16);
});

test("can ignore stale explicit assignment hours and recompute from shift definition", () => {
  const assignments = [
    {
      date: "2026-05-21",
      personId: "p1",
      personName: "Test Person",
      shiftCode: "M",
      roleLabel: "SERVİS SORUMLUSU",
      hours: 4,
    },
  ];
  const resolveHours = createPlanWorkHourResolver([
    { code: "M", start: "08:00", end: "16:00" },
  ]);

  const worked = sumWorkedHoursForPersonMonth(assignments, "p1", {
    personName: "Test Person",
    resolveHours,
    preferExplicitHours: false,
  });

  assert.equal(worked, 8);
});
