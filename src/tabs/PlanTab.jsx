// src/tabs/PlanTab.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { LS } from "../utils/storage.js";
import { useAuth } from "../auth/AuthContext.jsx";
import useServiceScope from "../hooks/useServiceScope.js";
import useActiveYM from "../hooks/useActiveYM.js";
import { getAllLeaves } from "../lib/leaves.js";
import ScheduleToolbar from "../components/ScheduleToolbar.jsx";
import PersonScheduleCalendar from "../components/PersonScheduleCalendar.jsx";
import { API } from "../lib/api.js";
import { runPlannerOnce } from "../lib/runPlannerOnce.js";

const MONTH_LABEL = (year, month) =>
  `${Intl.DateTimeFormat("tr-TR", { month: "long" }).format(new Date(year, month - 1, 1))} ${year}`;

function stripDiacritics(str = "") {
  return str.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}
function canonName(str = "") {
  return stripDiacritics(str).toLocaleUpperCase("tr-TR").replace(/\s+/g, " ").trim();
}

function normalizePersonRecord(p, index) {
  if (!p) return null;
  const idCandidates = [
    p.id,
    p.personId,
    p.pid,
    p.tc,
    p.tcNo,
    p.tcno,
    p.TCKN,
    p.kod,
    p.code,
  ]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter(Boolean);
  const id = idCandidates[0] || String(index + 1);
  const nameCandidates = [
    p.fullName,
    p.name,
    p.displayName,
    p.personName,
    [p.firstName, p.lastName].filter(Boolean).join(" "),
    p["Ad Soyad"],
    p["AD SOYAD"],
    p["ad soyad"],
  ]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter(Boolean);
  const name = nameCandidates[0] || id;
  const service = String(
    p.service ??
      p.serviceId ??
      p.department ??
      p.departmentId ??
      p.sectionId ??
      p.servis ??
      p.Servis ??
      ""
  ).trim();
  return {
    id,
    name,
    canon: canonName(name),
    raw: p,
    service,
  };
}

function splitByRole(items) {
  const nurses = [];
  const doctors = [];
  (items || []).forEach((p, idx) => {
    if (!p) return;
    const meta = p?.meta || {};
    const roleHint = String(meta.role || p.title || p.role || "").toLowerCase();
    const isDoctor = /doktor|doctor|hekim|tabip/.test(roleHint);
    const mapped = {
      id: p.id || p._id || p.personId || String(idx + 1),
      name: p.fullName || p.name || p.displayName || "",
      fullName: p.fullName || p.name || p.displayName || "",
      service: p.serviceId || p.service || meta.service || "",
      meta,
    };
    if (isDoctor) doctors.push(mapped);
    else nurses.push(mapped);
  });
  return { nurses, doctors };
}

function buildCountsFromPattern(def, year, month0) {
  const pattern = Array.isArray(def?.pattern) ? def.pattern : null;
  if (!pattern || pattern.length !== 7) return undefined;
  const counts = {};
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month0, d).getDay(); // 0=Sun
    const monIdx = (dow + 6) % 7; // 0=Mon
    const v = Number(pattern[monIdx]);
    if (Number.isFinite(v)) counts[d] = v;
  }
  return counts;
}

function readPeopleAll() {
  const sources = [
    "peopleAll",
    "people",
    "personList",
    "personnel",
    "nurses",
    "staff",
    "doctors",
  ];
  const aggregated = [];
  const seenId = new Set();
  sources.forEach((key) => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const arr = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.items)
        ? parsed.items
        : Array.isArray(parsed?.data)
        ? parsed.data
        : [];
      arr.forEach((row, idx) => {
        const norm = normalizePersonRecord(row, idx);
        if (!norm || seenId.has(norm.id)) return;
        seenId.add(norm.id);
        aggregated.push(norm);
      });
    } catch {
      /* noop */
    }
  });
  aggregated.sort((a, b) => a.name.localeCompare(b.name, "tr", { sensitivity: "base" }));
  return aggregated;
}

function matchPersonToUser(user, options) {
  if (!user || !options.length) return null;
  const idCandidates = [
    user.personId,
    user.person_id,
    user.staffId,
    user.id,
    user.tc,
    user.tcNo,
    user.tcno,
    user.TCKN,
    user.kod,
    user.code,
  ]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter(Boolean);
  for (const id of idCandidates) {
    const hit = options.find((opt) => opt.id && String(opt.id) === String(id));
    if (hit) return hit;
  }
  const nameCandidates = [
    user.fullName,
    user.name,
    user.displayName,
    [user.firstName, user.lastName].filter(Boolean).join(" "),
  ]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter(Boolean);
  const canonSet = new Set(nameCandidates.map((n) => canonName(n)));
  for (const opt of options) {
    if (canonSet.has(opt.canon)) return opt;
  }
  return null;
}

export default function PlanTab() {
  const { user } = useAuth();
  const scope = useServiceScope();
  const { ym, setYear, setMonth } = useActiveYM();
  const { year, month } = ym;
  const [activeRole, setActiveRole] = useState("Nurse");
  const [plannerStatus, setPlannerStatus] = useState("idle"); // idle | loading | error | done
  const [plannerError, setPlannerError] = useState("");

  const [peopleAll, setPeopleAll] = useState(() => readPeopleAll());
  useEffect(() => {
    const refresh = () => setPeopleAll(readPeopleAll());
    window.addEventListener("people:changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("people:changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const [allLeaves, setAllLeaves] = useState(() => getAllLeaves());
  useEffect(() => {
    const refreshLeaves = () => setAllLeaves(getAllLeaves());
    window.addEventListener("leaves:changed", refreshLeaves);
    window.addEventListener("storage", refreshLeaves);
    window.addEventListener("planner:dpResult", refreshLeaves);
    return () => {
      window.removeEventListener("leaves:changed", refreshLeaves);
      window.removeEventListener("storage", refreshLeaves);
      window.removeEventListener("planner:dpResult", refreshLeaves);
    };
  }, []);

  const roleKey = String(user?.role || user?.roleKey || user?.type || "").toUpperCase();
  const isAdminUser = roleKey === "ADMIN";
  const isAuthorizedUser =
    !isAdminUser &&
    (roleKey === "AUTHORIZED" ||
      roleKey === "MANAGER" ||
      roleKey === "STAFF" ||
      (Array.isArray(user?.serviceIds) && user.serviceIds.length > 0));
  const isStandardUser = !!user && !isAdminUser && !isAuthorizedUser;

  const [selectedService, setSelectedService] = useState(scope.defaultServiceId || "");
  useEffect(() => {
    setSelectedService(scope.defaultServiceId || "");
  }, [scope.defaultServiceId]);

  const scopedPeople = useMemo(() => scope.filterByScope(peopleAll), [peopleAll, scope]);

  const peopleForService = useMemo(() => {
    if (!selectedService) return scopedPeople;
    return scopedPeople.filter(
      (p) => scope.getServiceId(p.raw) === String(selectedService) || p.service === String(selectedService)
    );
  }, [scopedPeople, selectedService, scope]);

  const matchedPerson = useMemo(
    () => matchPersonToUser(user, scopedPeople),
    [user, scopedPeople]
  );

  const calendarPeople = useMemo(() => {
    if (isAdminUser || isAuthorizedUser) return peopleForService;
    return matchedPerson ? [matchedPerson] : [];
  }, [isAdminUser, isAuthorizedUser, peopleForService, matchedPerson]);

  const serviceOptions = useMemo(() => {
    const items = [];
    if (isAdminUser) {
      items.push({ id: "", name: "Tümü" });
    }
    for (const id of scope.allowedIds || []) {
      const svc = scope.servicesById.get(String(id));
      const name = svc?.name || svc?.code || id;
      items.push({ id: String(id), name });
    }
    return items;
  }, [scope.allowedIds, scope.servicesById, isAdminUser]);

  const showServiceSelect = isAdminUser || isAuthorizedUser;

  const roleInfo = {
    isAdmin: isAdminUser,
    isAuthorized: isAuthorizedUser,
    isStandard: isStandardUser,
  };

  const handleRunPlanner = useCallback(async () => {
    try {
      setPlannerStatus("loading");
      setPlannerError("");

      const roleKey = activeRole === "Doctor" ? "DOCTOR" : "NURSE";
      const serviceId = selectedService || "";
      const month0 = Math.min(11, Math.max(0, Number(month) - 1));

      const [personnelRes, hoursRes, scheduleRes] = await Promise.all([
        API.http.get(`/api/personnel?page=1&size=2000`),
        API.http.get(`/api/settings/workingHours?serviceId=`),
        API.http.get(
          `/api/schedules/monthly?sectionId=calisma-cizelgesi&serviceId=${encodeURIComponent(
            serviceId
          )}&role=${encodeURIComponent(roleKey)}&year=${year}&month=${month}`
        ),
      ]);

      const items = Array.isArray(personnelRes?.items) ? personnelRes.items : [];
      const { nurses, doctors } = splitByRole(items);
      const workingHours = Array.isArray(hoursRes?.value) ? hoursRes.value : [];

      const defs = scheduleRes?.schedule?.data?.defs || [];
      const taskLines = (Array.isArray(defs) ? defs : [])
        .map((d) => {
          const label = (d?.label || "").toString().trim();
          const shiftCode = (d?.shiftCode || "").toString().trim();
          if (!label || !shiftCode) return null;
          const counts = buildCountsFromPattern(d, year, month0);
          return {
            label,
            shiftCode,
            defaultCount: Number(d?.defaultCount ?? 0) || 0,
            counts,
          };
        })
        .filter(Boolean);

      const result = await runPlannerOnce({
        year,
        month: month0,
        activeServiceId: serviceId,
        activeRole: roleKey,
        nurses,
        doctors,
        workingHours,
        personLeaves: {}, // TODO: backend leaves endpoint eklenince buraya bağla
        taskLines,
      });

      const ctx = {
        year: result.year,
        month: result.month,
        role: result.role,
        serviceId: result.serviceId,
        result: result.dpResult,
        taskLines: result.taskLines,
        workingHours: result.workingHours,
      };
      try {
        localStorage.setItem("dpResultLast", JSON.stringify(ctx));
        window.dispatchEvent(new Event("planner:dpResult"));
      } catch {}

      setPlannerStatus("done");
    } catch (err) {
      console.error(err);
      setPlannerStatus("error");
      setPlannerError(err?.message || "Planlama çalıştırılamadı.");
    }
  }, [activeRole, selectedService, year, month]);

  return (
    <div className="p-4 space-y-4">
      <ScheduleToolbar
        title={`Planlama • ${MONTH_LABEL(year, month)}`}
        year={year}
        month={month}
        setYear={setYear}
        setMonth={setMonth}
        onBuild={handleRunPlanner}
        role={activeRole}
        onRoleChange={setActiveRole}
      />

      {plannerStatus === "error" && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {plannerError || "Planlama çalıştırılamadı."}
        </div>
      )}
      {plannerStatus === "done" && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          Plan oluşturuldu.
        </div>
      )}

      {showServiceSelect && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-slate-600">Servis:</label>
          <select
            className="h-9 px-2 rounded-lg border text-sm text-slate-700"
            value={selectedService}
            onChange={(e) => setSelectedService(e.target.value)}
          >
            {serviceOptions.map((opt) => (
              <option key={opt.id ?? "_"} value={opt.id ?? ""}>
                {opt.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {isStandardUser && !matchedPerson && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Kullanıcı bilgilerinizle eşleşen bir personel kaydı bulunamadı. Personel listesinde kimlik bilgilerinizi
          güncelledikten sonra tekrar deneyin.
        </div>
      )}

      <div className="rounded-lg border bg-white p-4">
        <PersonScheduleCalendar
          year={year}
          month={month}
          people={calendarPeople}
          allLeaves={allLeaves}
          user={user}
          role={roleInfo}
          sectionId="calisma-cizelgesi"
          serviceId={selectedService || ""}
          scheduleRole={activeRole}
        />
      </div>
    </div>
  );
}
