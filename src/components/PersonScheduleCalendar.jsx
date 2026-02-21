// src/components/PersonScheduleCalendar.jsx
import React, { useEffect, useMemo, useState } from "react";
import { buildMonthDays } from "../utils/date.js";

const pad2 = (n) => String(n).padStart(2, "0");
const stripDiacritics = (str = "") =>
  str
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
const canonName = (s = "") => stripDiacritics(s).replace(/\s+/g, " ").toLocaleUpperCase("tr-TR");

const dayNameTR = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

const emptyAssignments = { map: new Map(), mismatch: null };

const AREA_STORAGE_KEYS = ["workAreasV2", "workAreas"];

function buildServiceLabelMap() {
  const map = new Map();
  const feed = (entry) => {
    if (!entry) return;
    if (Array.isArray(entry)) {
      entry.forEach(feed);
      return;
    }
    if (typeof entry === "string") {
      const str = entry.trim();
      if (str) map.set(str, str);
      return;
    }
    if (typeof entry === "object") {
      const idRaw =
        entry.id ??
        entry.code ??
        entry.serviceId ??
        entry.serviceCode ??
        entry.label ??
        null;
      const nameRaw =
        entry.name ??
        entry.title ??
        entry.label ??
        entry.displayName ??
        entry.code ??
        entry.serviceName ??
        null;
      if (idRaw != null) {
        const key = String(idRaw).trim();
        if (key) {
          const val = nameRaw != null ? String(nameRaw).trim() : key;
          if (val) map.set(key, val);
        }
      }
      if (nameRaw != null) {
        const val = String(nameRaw).trim();
        if (val) map.set(val, val);
      }
      for (const value of Object.values(entry)) {
        if (Array.isArray(value)) feed(value);
      }
    }
  };

  for (const key of AREA_STORAGE_KEYS) {
    let raw;
    try {
      raw = localStorage.getItem(key);
    } catch {
      raw = null;
    }
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      feed(parsed);
    } catch {
      /* ignore broken JSON */
    }
  }

  return map;
}

function normalizePerson(person) {
  if (!person) return null;
  const idCandidates = [
    person.id,
    person.personId,
    person.pid,
    person.tc,
    person.tcNo,
    person.TCKN,
    person.kod,
    person.code,
  ]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter(Boolean);
  const id = idCandidates[0] || "";
  const nameCandidates = [
    person.fullName,
    person.name,
    person.displayName,
    person.personName,
    [person.firstName, person.lastName].filter(Boolean).join(" "),
    person["Ad Soyad"],
    person["AD SOYAD"],
    person["ad soyad"],
  ]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter(Boolean);
  const name = nameCandidates[0] || "";
  if (!name && !id) return null;
  return {
    id,
    name: name || id,
    canon: canonName(name || id),
    raw: person,
    service: person.service || person.serviceId || person.department || "",
  };
}

function resolveUserPerson(user, options) {
  if (!user || !options.length) return "";
  const userIdCandidates = [
    user.personId,
    user.person_id,
    user.staffId,
    user.id,
    user.tc,
    user.tcNo,
    user.tcno,
    user.TCKN,
    user.employeeId,
    user.code,
  ]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter(Boolean);
  for (const candidate of userIdCandidates) {
    const match = options.find((opt) => opt.id && opt.id === candidate);
    if (match) return match.id;
  }
  const userNameCandidates = [
    user.fullName,
    user.name,
    user.displayName,
    [user.firstName, user.lastName].filter(Boolean).join(" "),
  ]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter(Boolean);
  if (!userNameCandidates.length) return "";
  const userCanon = canonName(userNameCandidates[0]);
  if (!userCanon) return "";
  const match = options.find((opt) => opt.canon === userCanon);
  return match?.id || "";
}

function assignmentCanon(assg) {
  const candidates = [
    assg?.personName,
    assg?.name,
    assg?.displayName,
    assg?.fullName,
  ]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter(Boolean);
  return candidates.length ? canonName(candidates[0]) : "";
}

function collectAssignmentsForMonth({ year, month0, personId, personCanon }) {
  const ctx = (() => {
    try {
      return JSON.parse(localStorage.getItem("dpResultLast") || "null");
    } catch {
      return null;
    }
  })();
  if (!ctx || !ctx.result?.assignments) return emptyAssignments;
  if (Number(ctx.year) !== Number(year) || Number(ctx.month) !== Number(month0)) {
    return { map: new Map(), mismatch: ctx };
  }
  const target = `${year}-${pad2(month0 + 1)}`;
  const map = new Map();
  const targetPid = personId ? String(personId) : "";
  const targetCanon = personCanon ? canonName(personCanon) : "";

  for (const assg of ctx.result.assignments || []) {
    if (!assg) continue;
    const pidMatch =
      targetPid &&
      String(assg.personId ?? assg.personID ?? assg.staffId ?? assg.pid ?? "") === targetPid;
    const canonMatch =
      !pidMatch && targetCanon && assignmentCanon(assg) === targetCanon;
    if (!pidMatch && !canonMatch) continue;
    if (!assg.day || !assg.day.startsWith(target)) continue;
    const dayNum = parseInt(assg.day.slice(8, 10), 10);
    if (!Number.isFinite(dayNum)) continue;
    if (!map.has(dayNum)) map.set(dayNum, []);
    map.get(dayNum).push(assg);
  }
  return { map, mismatch: null };
}

function collectAssignmentsFromBuffer({ year, month0, personId, personCanon }) {
  const map = new Map();
  try {
    const raw = localStorage.getItem("assignmentsBuffer");
    if (!raw) return map;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return map;
    const targetPid = personId ? String(personId) : "";
    const targetCanon = personCanon ? canonName(personCanon) : "";
    for (const item of arr) {
      if (!item) continue;

      const pidRaw = item.personId ?? item.personID ?? item.staffId ?? item.pid ?? "";
      const pid = pidRaw == null ? "" : String(pidRaw).trim();
      const fullName = item.fullName ?? item.personName ?? item.name ?? "";
      const canon = fullName ? canonName(String(fullName)) : "";

      const pidMatch = targetPid && pid && pid === targetPid;
      const canonMatch = !pidMatch && targetCanon && canon && canon === targetCanon;
      if (!pidMatch && !canonMatch) continue;

      let dateStr = item.date ?? item.Date ?? "";
      if (!dateStr && Number.isFinite(Number(item.day ?? item.Day))) {
        const dd = Number(item.day ?? item.Day);
        if (dd >= 1 && dd <= 31) {
          dateStr = `${year}-${pad2(month0 + 1)}-${pad2(dd)}`;
        }
      }
      dateStr = String(dateStr || "").trim();
      if (!dateStr) continue;
      const date = new Date(dateStr);
      if (Number.isNaN(date.getTime())) continue;
      if (date.getFullYear() !== year || date.getMonth() !== month0) continue;
      const dayNum = date.getDate();
      if (!Number.isFinite(dayNum)) continue;

      const shift =
        item.shiftCode ??
        item.Shift ??
        item.code ??
        item["Vardiya"] ??
        item["VARDIYA"] ??
        "";
      const service =
        item.service ??
        item.Service ??
        item.role ??
        item["Görev"] ??
        item["GÖREV"] ??
        "";

      if (!map.has(dayNum)) map.set(dayNum, []);
      map.get(dayNum).push({
        day: `${year}-${pad2(month0 + 1)}-${pad2(dayNum)}`,
        roleLabel: service,
        shiftCode: shift,
        personId: pid || targetPid || undefined,
        personName: fullName || undefined,
        source: "buffer",
      });
    }
  } catch {
    /* noop */
  }
  return map;
}

function collectAssignmentsFromAiPlan({ year, month0, personId, personCanon }) {
  const map = new Map();
  let payload = null;
  try {
    payload = JSON.parse(localStorage.getItem("scheduleRowsV2") || "null");
  } catch {
    payload = null;
  }
  if (!payload || !Array.isArray(payload.rows)) return map;
  if (Number(payload.year) !== Number(year) || Number(payload.month) !== Number(month0 + 1)) {
    return map;
  }

  const serviceLabels = buildServiceLabelMap();
  const targetPid = personId ? String(personId) : "";
  const targetCanon = personCanon ? canonName(personCanon) : "";

  for (const row of payload.rows) {
    if (!row) continue;

    const pidRaw = row.personId ?? row.personID ?? row.staffId ?? row.pid ?? null;
    const pid = pidRaw == null ? "" : String(pidRaw).trim();
    const nameRaw = row.personName ?? row.fullName ?? row.name ?? "";
    const rowCanon = nameRaw ? canonName(nameRaw) : "";

    const pidMatch = targetPid && pid && pid === targetPid;
    const canonMatch = !pidMatch && targetCanon && rowCanon && rowCanon === targetCanon;
    if (!pidMatch && !canonMatch) continue;

    const dateStr = String(row.date ?? row.day ?? "").slice(0, 10);
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(dateStr)) continue;
    const dt = new Date(dateStr);
    if (Number.isNaN(dt.getTime())) continue;
    if (dt.getFullYear() !== Number(year) || dt.getMonth() !== Number(month0)) continue;
    const dayNum = dt.getDate();
    if (!Number.isFinite(dayNum)) continue;

    const shiftCode = row.shiftCode ?? row.shift ?? row.code ?? "";
    const serviceId = row.serviceId ?? row.service ?? row.role ?? "";
    const serviceKey = String(serviceId || "").trim();
    const roleLabel = serviceLabels.get(serviceKey) || serviceKey;

    const assignment = {
      day: dateStr,
      shiftCode: shiftCode ? String(shiftCode).trim() : undefined,
      roleLabel: roleLabel || undefined,
      personId: pid || (targetPid || undefined),
      personName: nameRaw || undefined,
      note: row.note || undefined,
      source: "aiPlan",
      serviceId: serviceId != null ? serviceId : undefined,
    };

    if (!map.has(dayNum)) map.set(dayNum, []);
    map.get(dayNum).push(assignment);
  }

  return map;
}

function collectAssignmentsFromRosterPreview({ year, month0, personId, personCanon }) {
  const map = new Map();
  let payload = null;
  try {
    payload = JSON.parse(localStorage.getItem("generatedRosterFlat") || "null");
  } catch {
    payload = null;
  }
  if (!payload || typeof payload !== "object") return map;

  const targetPid = personId ? String(personId) : "";
  const targetCanon = personCanon ? canonName(personCanon) : "";
  const ymKey = `${year}-${pad2(month0 + 1)}`;

  const buckets = Object.values(payload).filter((chunk) => chunk && typeof chunk === "object");
  for (const bucket of buckets) {
    const items = bucket?.[ymKey];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!item) continue;
      const pidRaw = item.personId ?? null;
      const pid = pidRaw == null ? "" : String(pidRaw).trim();
      const nameRaw = item.personName ?? "";
      const rowCanon = nameRaw ? canonName(nameRaw) : "";
      const pidMatch = targetPid && pid && pid === targetPid;
      const canonMatch = !pidMatch && targetCanon && rowCanon && rowCanon === targetCanon;
      if (!pidMatch && !canonMatch) continue;

      const dateStr = String(item.date || "").slice(0, 10);
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(dateStr)) continue;
      const dt = new Date(dateStr);
      if (Number.isNaN(dt.getTime())) continue;
      if (dt.getFullYear() !== Number(year) || dt.getMonth() !== Number(month0)) continue;
      const dayNum = dt.getDate();
      if (!Number.isFinite(dayNum)) continue;

      const assignment = {
        day: dateStr,
        shiftCode: item.shiftCode ? String(item.shiftCode).trim() : undefined,
        roleLabel: item.roleLabel ? String(item.roleLabel).trim() : undefined,
        personId: pid || (targetPid || undefined),
        personName: nameRaw || undefined,
        note: item.note || undefined,
        source: "rosterPreview",
      };

      if (!map.has(dayNum)) map.set(dayNum, []);
      map.get(dayNum).push(assignment);
    }
  }

  return map;
}

function formatLeaveValue(val) {
  if (!val) return "";
  if (typeof val === "string") return val.toUpperCase();
  if (Array.isArray(val)) {
    return val
      .map((item) => formatLeaveValue(item))
      .filter(Boolean)
      .join(", ");
  }
  if (typeof val === "object") {
    const code = val.code || val.type || val.kind || "";
    const note = val.note || val.description || "";
    return [code, note].filter(Boolean).join(" ");
  }
  return String(val);
}

function collapseLeaves(allLeaves, personId, canon, ymKey) {
  const base = (allLeaves?.[personId] || {})[ymKey] || {};
  if (!canon) return base;
  const byName = (allLeaves?.[`__name__:${canon}`] || {})[ymKey] || {};
  return { ...byName, ...base };
}

export default function PersonScheduleCalendar({
  year,
  month, // 1..12
  people = [],
  allLeaves = {},
  user,
  role = { isAdmin: false, isAuthorized: false, isStandard: false },
}) {
  const month0 = Math.max(0, Math.min(11, Number(month) - 1 || 0));
  const ymKey = `${year}-${pad2(month0 + 1)}`;

  const options = useMemo(() => {
    const rows = [];
    const seen = new Set();
    (people || []).forEach((person) => {
      const norm = normalizePerson(person);
      if (!norm || !norm.id || seen.has(norm.id)) return;
      seen.add(norm.id);
      rows.push(norm);
    });
    rows.sort((a, b) => a.name.localeCompare(b.name, "tr", { sensitivity: "base" }));
    return rows;
  }, [people]);

  const initialPersonId = useMemo(() => {
    if (role.isStandard) {
      const match = resolveUserPerson(user, options);
      if (match) return match;
    }
    return options[0]?.id || "";
  }, [role.isStandard, user, options]);

  const [selectedId, setSelectedId] = useState(initialPersonId);
  const [dpRevision, setDpRevision] = useState(0);

  useEffect(() => {
    setSelectedId(initialPersonId);
  }, [initialPersonId]);

  useEffect(() => {
    const onPlannerChange = () => setDpRevision((v) => v + 1);
    window.addEventListener("planner:dpResult", onPlannerChange);
    window.addEventListener("planner:assignments", onPlannerChange);
    window.addEventListener("planner:aiPlan", onPlannerChange);
    window.addEventListener("storage", onPlannerChange);
    return () => {
      window.removeEventListener("planner:dpResult", onPlannerChange);
      window.removeEventListener("planner:assignments", onPlannerChange);
      window.removeEventListener("planner:aiPlan", onPlannerChange);
      window.removeEventListener("storage", onPlannerChange);
    };
  }, []);

  const selectedPerson = useMemo(
    () => options.find((opt) => String(opt.id) === String(selectedId)) || null,
    [options, selectedId]
  );

  const leavesForPerson = useMemo(() => {
    if (!selectedPerson) return {};
    return collapseLeaves(allLeaves, selectedPerson.id, selectedPerson.canon, ymKey);
  }, [allLeaves, selectedPerson, ymKey]);

  const assignmentInfo = useMemo(() => {
    if (!selectedPerson) return emptyAssignments;
    return collectAssignmentsForMonth({
      year,
      month0,
      personId: selectedPerson.id,
      personCanon: selectedPerson.canon,
      revision: dpRevision,
    });
  }, [selectedPerson, year, month0, dpRevision]);

  const bufferAssignments = useMemo(() => {
    if (!selectedPerson) return new Map();
    return collectAssignmentsFromBuffer({
      year,
      month0,
      personId: selectedPerson.id,
      personCanon: selectedPerson.canon,
    });
  }, [selectedPerson, year, month0, dpRevision]);

  const aiPlanAssignments = useMemo(() => {
    if (!selectedPerson) return new Map();
    return collectAssignmentsFromAiPlan({
      year,
      month0,
      personId: selectedPerson.id,
      personCanon: selectedPerson.canon,
    });
  }, [selectedPerson, year, month0, dpRevision]);

  const rosterPreviewAssignments = useMemo(() => {
    if (!selectedPerson) return new Map();
    return collectAssignmentsFromRosterPreview({
      year,
      month0,
      personId: selectedPerson.id,
      personCanon: selectedPerson.canon,
    });
  }, [selectedPerson, year, month0, dpRevision]);

  const assignmentsByDay = useMemo(() => {
    const combined = new Map();
    const merge = (srcMap) => {
      if (!(srcMap instanceof Map)) return;
      for (const [day, list] of srcMap.entries()) {
        if (!combined.has(day)) combined.set(day, []);
        combined.get(day).push(...list);
      }
      if (srcMap) {
        srcMap.clear?.();
      }
    };
    if (assignmentInfo?.map instanceof Map) merge(assignmentInfo.map);
    merge(bufferAssignments);
    merge(aiPlanAssignments);
    merge(rosterPreviewAssignments);
    return combined;
  }, [assignmentInfo?.map, bufferAssignments, aiPlanAssignments, rosterPreviewAssignments]);

  const { cells } = useMemo(() => buildMonthDays(year, month0), [year, month0]);

  const renderAssignments = (list = []) =>
    list.map((assg, idx) => (
      <div key={idx} className="rounded bg-blue-50 border border-blue-200 px-1 py-0.5 text-[11px] text-blue-700 mt-1">
        <span className="font-semibold">{assg.shiftCode || assg.code || "-"}</span>
        {assg.roleLabel ? <span className="ml-1">{assg.roleLabel}</span> : null}
      </div>
    ));

  const renderLeave = (code) =>
    code ? (
      <div className="rounded bg-rose-50 border border-rose-200 px-1 py-0.5 text-[11px] text-rose-700 mt-1">
        {code}
      </div>
    ) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Yıl</span>
          <span className="text-sm font-semibold text-slate-800">{year}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Ay</span>
          <span className="text-sm font-semibold text-slate-800">
            {Intl.DateTimeFormat("tr-TR", { month: "long" }).format(new Date(year, month0))}
          </span>
        </div>
        <div className="flex-1" />
        {(role.isAdmin || role.isAuthorized) && (
          <label className="flex flex-col text-xs text-slate-500 gap-1 w-64">
            Personel
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="h-9 rounded border px-2 text-sm text-slate-700"
            >
              {options.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {role.isStandard && selectedPerson && (
          <div className="text-sm text-slate-600">
            Personel: <span className="font-medium text-slate-800">{selectedPerson.name}</span>
          </div>
        )}
      </div>

      {!selectedPerson && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-4 py-3 text-sm">
          Bu kullanıcıyla eşleşen bir personel kaydı bulunamadı. Personel listesinde kimlik bilgilerinizi
          güncelleyip tekrar deneyin.
        </div>
      )}

      {selectedPerson && role.isStandard && !resolveUserPerson(user, options) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-4 py-3 text-sm">
          Hesabınızla eşleşen personel kaydı bulunamadı. Şu an listeden ilk kayıt gösteriliyor.
        </div>
      )}

      {assignmentInfo.mismatch && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-4 py-3 text-sm">
          Son oluşturulan plan {assignmentInfo.mismatch?.year}-{pad2(Number(assignmentInfo.mismatch?.month) + 1)}{" "}
          dönemine ait. {year}-{pad2(month0 + 1)} için nöbet verisi bulunamadı.
        </div>
      )}

      <div className="grid grid-cols-7 gap-1 text-xs font-semibold text-slate-500">
        {dayNameTR.map((name) => (
          <div key={name} className="text-center py-1">
            {name}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((dt, idx) => {
        if (!dt) {
            return <div key={`empty-${idx}`} className="h-24 rounded-lg bg-transparent" />;
          }
          const dayNum = dt.getDate();
          const leaveCodeRaw =
            leavesForPerson[String(dayNum)] || leavesForPerson[`${year}-${pad2(month0 + 1)}-${pad2(dayNum)}`];
          const leaveCode = formatLeaveValue(leaveCodeRaw);
          const assignments = assignmentsByDay.get(dayNum) || [];
          const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
          return (
            <div
              key={`day-${dayNum}`}
              className={`h-24 rounded-lg border p-2 flex flex-col text-xs ${
                isWeekend ? "bg-slate-50 border-slate-200" : "bg-white border-slate-100"
              }`}
            >
              <div className="flex items-center justify-between text-slate-600">
                <span className="font-semibold text-sm text-slate-800">{dayNum}</span>
                <span className="text-[11px] uppercase text-slate-400">
                  {dayNameTR[(dt.getDay() + 6) % 7]}
                </span>
              </div>
              <div className="flex-1 overflow-hidden">
                {leaveCode ? renderLeave(leaveCode) : null}
                {assignments.length ? renderAssignments(assignments) : null}
                {!leaveCode && !assignments.length && (
                  <div className="text-[11px] text-slate-300 mt-2 text-center">—</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="text-xs text-slate-500">
        <div>
          <span className="inline-block h-3 w-3 bg-rose-100 border border-rose-200 mr-2 align-middle rounded" />
          İzin kayıtları (Toplu İzin Listesi)
        </div>
        <div>
          <span className="inline-block h-3 w-3 bg-blue-100 border border-blue-200 mr-2 align-middle rounded" />
          Nöbet atamaları (son plan / içe aktarılan görevler)
        </div>
        <div className="text-[10px] text-slate-400 mt-1">
          Not: Excel’den içe aktarılan görevler, serbest metin tarih ve vardiya alanlarını düzgün biçimde
          parse edebildiğimiz sürece burada gösterilir.
        </div>
      </div>
    </div>
  );
}
