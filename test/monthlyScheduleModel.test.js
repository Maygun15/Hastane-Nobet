import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

class LocalStorageMock {
  constructor() {
    this.store = new Map();
  }

  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }

  setItem(key, value) {
    this.store.set(String(key), String(value));
  }

  removeItem(key) {
    this.store.delete(String(key));
  }

  clear() {
    this.store.clear();
  }
}

globalThis.localStorage = new LocalStorageMock();

const {
  getScheduleModelSync,
  getPersonDayShift,
  getPersonMonthShifts,
} = await import("../src/store/monthlyScheduleModel.js");

const PEOPLE = [{ id: "p1", fullName: "Gamze Ozturk" }];
const YM = "2026-03";

beforeEach(() => {
  globalThis.localStorage.clear();
});

test("falls back to local scheduleRowsV2 when backend cache is absent", () => {
  const rows = [
    {
      label: "SERVIS SORUMLUSU",
      vardiya: "N",
      "19 (Per)": "Gamze Ozturk",
    },
  ];
  globalThis.localStorage.setItem("scheduleRowsV2", JSON.stringify(rows));

  const model = getScheduleModelSync({ year: 2026, month: 3, people: PEOPLE });
  const shift = getPersonDayShift({
    model,
    personId: "p1",
    personName: "Gamze Ozturk",
    day: 19,
  });

  assert.equal(shift?.shiftCode, "N");
  assert.equal(shift?.source, "scheduleRowsV2");
});

test("uses backend explicit assignments as single source when backend cache exists", () => {
  const rows = [
    {
      label: "SERVIS SORUMLUSU",
      vardiya: "N",
      "19 (Per)": "Gamze Ozturk",
    },
  ];
  globalThis.localStorage.setItem("scheduleRowsV2", JSON.stringify(rows));
  globalThis.localStorage.setItem(
    `schedule::${YM}`,
    JSON.stringify({
      data: {
        assignments: [
          {
            date: "2026-03-19",
            personId: "p1",
            personName: "Gamze Ozturk",
            shiftCode: "A",
            roleLabel: "SERVIS SORUMLUSU",
            hours: 4,
          },
        ],
      },
      sectionId: "calisma-cizelgesi",
      updatedAt: "2026-03-10T00:00:00.000Z",
    })
  );

  const model = getScheduleModelSync({ year: 2026, month: 3, people: PEOPLE });
  const shift = getPersonDayShift({
    model,
    personId: "p1",
    personName: "Gamze Ozturk",
    day: 19,
  });
  const monthMap = getPersonMonthShifts({
    model,
    personId: "p1",
    personName: "Gamze Ozturk",
  });

  assert.equal(shift?.shiftCode, "A");
  assert.equal(shift?.source, "backend");
  assert.equal(monthMap?.[19]?.shiftCode, "A");
  assert.equal(Object.keys(monthMap || {}).length, 1);
});

test("parses backend namedAssignments and defs when explicit assignments are missing", () => {
  globalThis.localStorage.setItem(
    `schedule::${YM}`,
    JSON.stringify({
      data: {
        roster: {
          namedAssignments: {
            19: { "row-1": ["Gamze Ozturk"] },
          },
        },
        defs: [
          { id: "row-1", shiftCode: "A", label: "SERVIS SORUMLUSU" },
        ],
      },
      sectionId: "calisma-cizelgesi",
    })
  );

  const model = getScheduleModelSync({ year: 2026, month: 3, people: PEOPLE });
  const shift = getPersonDayShift({
    model,
    personId: "p1",
    personName: "Gamze Ozturk",
    day: 19,
  });

  assert.equal(shift?.shiftCode, "A");
  assert.equal(shift?.rowLabel, "SERVIS SORUMLUSU");
  assert.equal(shift?.source, "backend");
});
