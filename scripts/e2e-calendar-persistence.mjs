#!/usr/bin/env node

/**
 * E2E smoke:
 * 1) /api/schedules/assign ile manuel atama yazar
 * 2) /api/schedules/monthly ile kaydın geldiğini doğrular
 * 3) /api/schedules/assign (DELETE) ile temizler
 * 4) /api/schedules/monthly ile kaydın silindiğini doğrular
 *
 * Env:
 * - SMOKE_API_BASE (default: http://localhost:3000)
 * - SMOKE_TOKEN (opsiyonel; yoksa login yapılır)
 * - SMOKE_IDENTIFIER + SMOKE_PASSWORD (token yoksa gerekli)
 * - SMOKE_SECTION_ID (default: calisma-cizelgesi)
 * - SMOKE_SERVICE_ID (default: "")
 * - SMOKE_ROLE (default: "")
 * - SMOKE_YEAR / SMOKE_MONTH / SMOKE_DATE (YYYY-MM-DD)
 * - SMOKE_PERSON_ID / SMOKE_PERSON_NAME (opsiyonel; yoksa /api/personnel'den seçilir)
 * - SMOKE_SHIFT_ID / SMOKE_SHIFT_CODE / SMOKE_ROLE_LABEL (opsiyonel; yoksa monthly defs'ten seçilir)
 * - SMOKE_SKIP_CLEANUP=true (opsiyonel)
 */

const argv = new Set(process.argv.slice(2));
if (argv.has("--help") || argv.has("-h")) {
  console.log(`
Usage:
  npm run smoke:e2e

Examples:
  SMOKE_TOKEN="BearerToken" SMOKE_PERSON_ID="..." npm run smoke:e2e
  SMOKE_IDENTIFIER="admin@admin.com" SMOKE_PASSWORD="1234" npm run smoke:e2e

Flags:
  --dry-run   Config ve seçilen adayları gösterir, write yapmaz.
  `);
  process.exit(0);
}

const dryRun = argv.has("--dry-run");
const API_BASE = String(process.env.SMOKE_API_BASE || "http://localhost:3000").replace(/\/+$/, "");
const SECTION_ID = String(process.env.SMOKE_SECTION_ID || "calisma-cizelgesi").trim();
const SERVICE_ID = String(process.env.SMOKE_SERVICE_ID || "").trim();
const ROLE = String(process.env.SMOKE_ROLE || "").trim();
const SKIP_CLEANUP = ["1", "true", "yes"].includes(String(process.env.SMOKE_SKIP_CLEANUP || "").toLowerCase());

const now = new Date();
const year = Number(process.env.SMOKE_YEAR || now.getFullYear());
const month = Number(process.env.SMOKE_MONTH || now.getMonth() + 1);
const date = String(
  process.env.SMOKE_DATE ||
    `${year}-${String(month).padStart(2, "0")}-${String(Math.min(19, new Date(year, month, 0).getDate())).padStart(2, "0")}`
).slice(0, 10);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function normalizeToken(raw) {
  const t = String(raw || "").trim();
  if (!t) return "";
  return t.startsWith("Bearer ") ? t : `Bearer ${t}`;
}

async function req(path, { method = "GET", body, token } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: token } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const msg =
      (data && (data.message || data.error)) ||
      `HTTP ${res.status}`;
    throw new Error(`${method} ${path} failed: ${msg}`);
  }
  return data;
}

async function loginIfNeeded() {
  const fromEnv = normalizeToken(process.env.SMOKE_TOKEN);
  if (fromEnv) return fromEnv;
  const identifier = String(process.env.SMOKE_IDENTIFIER || "").trim();
  const password = String(process.env.SMOKE_PASSWORD || "").trim();
  assert(identifier && password, "SMOKE_TOKEN yoksa SMOKE_IDENTIFIER ve SMOKE_PASSWORD gerekli");
  const data = await req("/api/auth/login", {
    method: "POST",
    body: { identifier, password },
  });
  const token = normalizeToken(data?.token);
  assert(token, "Login başarılı ama token dönmedi");
  return token;
}

function extractDefs(schedule) {
  const data = schedule?.data && typeof schedule.data === "object" ? schedule.data : {};
  if (Array.isArray(data.defs)) return data.defs;
  if (Array.isArray(data.rows)) return data.rows;
  return [];
}

function extractAssignments(schedule) {
  const data = schedule?.data && typeof schedule.data === "object" ? schedule.data : {};
  return Array.isArray(data.assignments) ? data.assignments : [];
}

function sameAssignment(a, { personId, dateStr, shiftId, shiftCode }) {
  const aDate = String(a?.date || a?.day || "").slice(0, 10);
  const aPid = String(a?.personId || "").trim();
  const aShiftId = String(a?.shiftId || "").trim();
  const aShiftCode = String(a?.shiftCode || "").trim();
  const targetShiftId = String(shiftId || "").trim();
  const targetShiftCode = String(shiftCode || "").trim();
  const shiftMatch = (
    (targetShiftId && (aShiftId === targetShiftId || aShiftCode === targetShiftId)) ||
    (targetShiftCode && (aShiftId === targetShiftCode || aShiftCode === targetShiftCode))
  );
  return aDate === dateStr && aPid === String(personId).trim() && shiftMatch;
}

async function getMonthly(token) {
  const qs = new URLSearchParams({
    sectionId: SECTION_ID,
    year: String(year),
    month: String(month),
    serviceId: SERVICE_ID,
    role: ROLE,
  });
  const payload = await req(`/api/schedules/monthly?${qs.toString()}`, { token });
  return payload?.schedule || null;
}

async function pickPerson(token) {
  const envPid = String(process.env.SMOKE_PERSON_ID || "").trim();
  const envPname = String(process.env.SMOKE_PERSON_NAME || "").trim();
  if (envPid) return { personId: envPid, personName: envPname || undefined };

  const qs = new URLSearchParams({ active: "true", size: "200" });
  if (SERVICE_ID) qs.set("unitId", SERVICE_ID);
  const payload = await req(`/api/personnel?${qs.toString()}`, { token });
  const items = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload) ? payload : [];
  const p = items.find((it) => String(it?.id || "").trim());
  assert(p, "person seçilemedi; SMOKE_PERSON_ID verin");
  const personId = String(p.id).trim();
  const personName = String(p.fullName || [p.first_name, p.last_name].filter(Boolean).join(" ") || "").trim();
  return { personId, personName: personName || undefined };
}

function pickShift(defs) {
  const envShiftId = String(process.env.SMOKE_SHIFT_ID || "").trim();
  const envShiftCode = String(process.env.SMOKE_SHIFT_CODE || "").trim();
  const envRoleLabel = String(process.env.SMOKE_ROLE_LABEL || "").trim();
  if (envShiftId || envShiftCode) {
    return {
      shiftId: envShiftId || envShiftCode,
      shiftCode: envShiftCode || envShiftId,
      roleLabel: envRoleLabel || undefined,
    };
  }

  const list = Array.isArray(defs) ? defs : [];
  const candidate =
    list.find((d) => String(d?.shiftCode || "").trim().toUpperCase() === "A") ||
    list.find((d) => String(d?.id || d?.rowId || "").trim()) ||
    null;
  assert(candidate, "shift seçilemedi; SMOKE_SHIFT_ID veya SMOKE_SHIFT_CODE verin");
  const shiftId = String(candidate?.id || candidate?.rowId || candidate?.shiftCode || candidate?.code || "").trim();
  const shiftCode = String(candidate?.shiftCode || candidate?.code || shiftId).trim();
  const roleLabel = String(candidate?.label || candidate?.name || candidate?.area || envRoleLabel || "").trim();
  return { shiftId, shiftCode, roleLabel: roleLabel || undefined };
}

async function main() {
  console.log(`[smoke] api=${API_BASE} ym=${year}-${String(month).padStart(2, "0")} date=${date}`);
  const token = await loginIfNeeded();
  const person = await pickPerson(token);
  const beforeSchedule = await getMonthly(token);
  const defs = extractDefs(beforeSchedule);
  const shift = pickShift(defs);

  console.log(`[smoke] person=${person.personId} shift=${shift.shiftId}/${shift.shiftCode} section=${SECTION_ID}`);
  if (dryRun) {
    console.log("[smoke] dry-run: write adımları atlandı.");
    return;
  }

  let assigned = false;
  try {
    await req("/api/schedules/assign", {
      method: "POST",
      token,
      body: {
        sectionId: SECTION_ID,
        serviceId: SERVICE_ID,
        role: ROLE,
        date,
        shiftId: shift.shiftId,
        shiftCode: shift.shiftCode,
        personId: person.personId,
        ...(person.personName ? { personName: person.personName } : {}),
        ...(shift.roleLabel ? { roleLabel: shift.roleLabel } : {}),
      },
    });
    assigned = true;

    const afterAssign = await getMonthly(token);
    const foundAfterAssign = extractAssignments(afterAssign).some((a) =>
      sameAssignment(a, {
        personId: person.personId,
        dateStr: date,
        shiftId: shift.shiftId,
        shiftCode: shift.shiftCode,
      })
    );
    assert(foundAfterAssign, "Assign sonrası GET monthly içinde kayıt bulunamadı");
    console.log("[smoke] assign persistence: OK");
  } finally {
    if (!assigned || SKIP_CLEANUP) return;
    await req("/api/schedules/assign", {
      method: "DELETE",
      token,
      body: {
        sectionId: SECTION_ID,
        serviceId: SERVICE_ID,
        role: ROLE,
        date,
        shiftId: shift.shiftId,
        shiftCode: shift.shiftCode,
        personId: person.personId,
        ...(person.personName ? { personName: person.personName } : {}),
      },
    });
    const afterDelete = await getMonthly(token);
    const stillExists = extractAssignments(afterDelete).some((a) =>
      sameAssignment(a, {
        personId: person.personId,
        dateStr: date,
        shiftId: shift.shiftId,
        shiftCode: shift.shiftCode,
      })
    );
    assert(!stillExists, "Delete sonrası GET monthly içinde kayıt hala görünüyor");
    console.log("[smoke] cleanup persistence: OK");
  }
}

main()
  .then(() => {
    console.log("[smoke] PASS");
  })
  .catch((err) => {
    console.error("[smoke] FAIL:", err?.message || err);
    process.exitCode = 1;
  });
