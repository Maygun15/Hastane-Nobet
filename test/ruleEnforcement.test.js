import test from "node:test";
import assert from "node:assert/strict";
import { ENFORCEMENT, ENFORCEMENT_LABEL, getRuleEnforcement } from "../src/rules/ruleEnforcement.js";

test("motorun uyguladığı kurallar 'engine' döner", () => {
  // WEEKLY_MIN_1_OFF: kayan 7 günde 1 boş gün ≡ en fazla 6 gün art arda (MAX_CONSECUTIVE_DAYS ≤ 6).
  for (const id of ["ONE_SHIFT_PER_DAY", "NIGHT_NEXT_DAY_OFF", "MIN_REST_11H", "MAX_CONSECUTIVE_6D", "LEAVE_BLOCK_GENERIC", "WEEKLY_MIN_1_OFF"]) {
    assert.equal(getRuleEnforcement(id), ENFORCEMENT.ENGINE, id);
  }
});

test("görev satırı / alan ile sağlananlar 'template' döner", () => {
  assert.equal(getRuleEnforcement("RESUS_MIN_TWO"), ENFORCEMENT.TEMPLATE);
  assert.equal(getRuleEnforcement("QUAL_ONLY_IN_SPECIALTY"), ENFORCEMENT.TEMPLATE);
});

test("motorun kontrol etmediği kurallar ve bilinmeyenler 'info' döner", () => {
  for (const id of ["PREGNANT_NO_NIGHTS", "HOLIDAY_EQUAL", "TRY_RESPECT_OFF_REQUESTS", "BILINMEYEN_KURAL", "", undefined]) {
    assert.equal(getRuleEnforcement(id), ENFORCEMENT.INFO, String(id));
  }
});

test("her durum için ekran etiketi var", () => {
  for (const v of Object.values(ENFORCEMENT)) {
    assert.ok(ENFORCEMENT_LABEL[v]?.text, v);
  }
});
