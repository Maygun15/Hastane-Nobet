import test from "node:test";
import assert from "node:assert/strict";

const {
  getRowServiceAliasSet,
  matchesAnyServiceSelection,
  matchesServiceSelection,
  normalizeServiceToken,
} = await import("../src/utils/serviceMatching.js");

test("matches personnel rows by service name when selected service is stored as id", () => {
  const servicesById = new Map([
    ["svc-acil", { id: "svc-acil", name: "Acil Servis", code: "ACIL" }],
  ]);

  const row = {
    id: "p1",
    service: "Acil Servis",
    meta: { department: "Acil Servis" },
  };

  assert.equal(
    matchesServiceSelection({ row, serviceId: "svc-acil", servicesById }),
    true
  );
});

test("matches personnel rows by service code aliases", () => {
  const servicesById = new Map([
    ["svc-acil", { id: "svc-acil", name: "Acil Servis", code: "ACIL" }],
    ["svc-yb", { id: "svc-yb", name: "Yogun Bakim", code: "YB" }],
  ]);

  const row = {
    id: "p2",
    serviceId: "acil",
    meta: { code: "ACIL" },
  };

  assert.equal(
    matchesAnyServiceSelection({
      row,
      serviceIds: ["svc-yb", "svc-acil"],
      servicesById,
    }),
    true
  );
});

test("collects service aliases from both row and nested raw/meta objects", () => {
  const aliases = getRowServiceAliasSet({
    serviceId: "",
    raw: {
      service: "Acil Servis",
      meta: { serviceCode: "ACIL" },
    },
  });

  assert.equal(aliases.has(normalizeServiceToken("Acil Servis")), true);
  assert.equal(aliases.has(normalizeServiceToken("ACIL")), true);
});
