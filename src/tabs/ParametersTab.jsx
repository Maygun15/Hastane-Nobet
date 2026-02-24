// src/tabs/ParametersTab.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

import WorkAreasTab from "./WorkAreasTab.jsx";
import WorkingHoursTab from "./WorkingHoursTab.jsx";
import LeaveTypesTab from "./LeaveTypesTab.jsx";
import HolidayCalendarTab from "./HolidayCalendarTab.jsx";
import DutyRulesTabExplained from "./DutyRulesTab.Explained.jsx"; // ✅ açıklamalı yeni bileşen
import RequestBoxTab from "./RequestBoxTab.jsx";
import { API, getToken } from "../lib/api.js";

const LS_ACTIVE_SUBTAB = "paramsActiveSubtabV1";
const LS_KEY_RULES = "dutyRulesV2"; // ✅ nöbet kuralları LS anahtarı
const cn = (...c) => c.filter(Boolean).join(" ");

// Backend kural anahtarlarını UI listesinden türet
function mapRulesToBackend(list) {
  const arr = Array.isArray(list) ? list : [];
  const findById = (id) => arr.find((r) => r?.id === id);
  const findAny = (ids) => ids.map(findById).find(Boolean);
  const findEnabled = (ids) => ids.map(findById).find((r) => r && r.enabled);

  const boolRule = (ids) => {
    const any = findAny(ids);
    if (!any) return undefined;
    const enabled = !!findEnabled(ids);
    return enabled;
  };
  const numRule = (ids, fallback) => {
    const any = findAny(ids);
    if (!any) return undefined;
    const r = findEnabled(ids);
    if (!r) return 0;
    const n = Number(r.value);
    return Number.isFinite(n) ? n : fallback;
  };

  const out = {};
  const v1 = boolRule(["ONE_SHIFT_PER_DAY", "NO_MULTIPLE_ASSIGNMENTS_PER_DAY"]);
  if (v1 !== undefined) out.ONE_SHIFT_PER_DAY = v1;

  const v2 = boolRule(["LEAVE_BLOCK_GENERIC"]);
  if (v2 !== undefined) out.LEAVE_BLOCK = v2;

  const v3 = numRule(["MAX_CONSECUTIVE_6D"], 6);
  if (v3 !== undefined) out.MAX_CONSECUTIVE_DAYS = v3;

  const v4 = numRule(["MIN_GAP_12H", "MIN_REST_11H"], 11);
  if (v4 !== undefined) out.MIN_REST_HOURS = v4;

  const v5 = boolRule(["NIGHT_NEXT_DAY_OFF"]);
  if (v5 !== undefined) out.NIGHT_NEXT_DAY_OFF = v5;

  return out;
}

function applyBackendRulesToList(list, backendRules) {
  if (!backendRules) return list;
  const rules = Array.isArray(list) ? list : [];
  const byId = new Map(rules.map((r) => [r.id, r]));
  const setRule = (id, enabled, value) => {
    const r = byId.get(id);
    if (!r) return;
    byId.set(id, { ...r, enabled: !!enabled, value: value ?? r.value });
  };

  if ("ONE_SHIFT_PER_DAY" in backendRules) {
    setRule("ONE_SHIFT_PER_DAY", backendRules.ONE_SHIFT_PER_DAY);
  }
  if ("LEAVE_BLOCK" in backendRules) {
    setRule("LEAVE_BLOCK_GENERIC", backendRules.LEAVE_BLOCK);
  }
  if ("MAX_CONSECUTIVE_DAYS" in backendRules) {
    const v = Number(backendRules.MAX_CONSECUTIVE_DAYS);
    setRule("MAX_CONSECUTIVE_6D", Number.isFinite(v) && v > 0, Number.isFinite(v) ? v : undefined);
  }
  if ("MIN_REST_HOURS" in backendRules) {
    const v = Number(backendRules.MIN_REST_HOURS);
    setRule("MIN_REST_11H", Number.isFinite(v) && v > 0, Number.isFinite(v) ? v : undefined);
  }
  if ("NIGHT_NEXT_DAY_OFF" in backendRules) {
    setRule("NIGHT_NEXT_DAY_OFF", backendRules.NIGHT_NEXT_DAY_OFF);
  }

  return rules.map((r) => byId.get(r.id) || r);
}

const SUBTABS = [
  { id: "calisma-alanlari", label: "Çalışma Alanları" },
  { id: "calisma-saatleri", label: "Çalışma Saatleri" },
  { id: "izin-turleri",     label: "İzin Türleri" },
  { id: "tatil-takvimi",    label: "Tatil Takvimi" },
  { id: "nobet-kurallari",  label: "Nöbet Kuralları" },
  { id: "istek",            label: "İstek" },
];

const DEFAULT_ID = "calisma-alanlari";
const isValid = (id) => SUBTABS.some((t) => t.id === id);

/* ---------- helpers: url + ls ---------- */
function normHash(h) {
  return (h || "").replace(/^#/, "").replace(/^\/+/, "");
}

// #/parametreler/<sub> | #parametreler/<sub> | parametreler/<sub>
function subFromHash() {
  try {
    const h = normHash(window.location.hash);
    if (!h) return null;
    const parts = h.split("/").filter(Boolean);
    const i = parts.findIndex((p) => p === "parametreler");
    if (i >= 0) {
      const candidate = parts[i + 1];
      return isValid(candidate) ? candidate : null;
    }
    return null;
  } catch {
    return null;
  }
}

function subFromQuery() {
  try {
    const u = new URL(window.location.href);
    const v = (u.searchParams.get("sub") || "").trim();
    return isValid(v) ? v : null;
  } catch {
    return null;
  }
}

function currentHashEquals(id) {
  const want = "#/parametreler/" + id;
  return window.location.hash === want;
}

function setHashSub(id) {
  try {
    const target = "#/parametreler/" + id;
    if (window.location.hash !== target) {
      window.location.hash = target; // tetikler
    }
  } catch {}
}

// localStorage helpers
function lsGet() {
  try {
    const v = localStorage.getItem(LS_ACTIVE_SUBTAB);
    return isValid(v) ? v : null;
  } catch {
    return null;
  }
}
function lsSet(id) {
  try {
    if (isValid(id)) localStorage.setItem(LS_ACTIVE_SUBTAB, id);
  } catch {}
}
function lsClear() {
  try {
    localStorage.removeItem(LS_ACTIVE_SUBTAB);
  } catch {}
}

/* ---------- component ---------- */
export default function ParametersTab() {
  // Açılış önceliği: HASH > QUERY > LS > DEFAULT
  const initial = useMemo(() => {
    return subFromHash() ?? subFromQuery() ?? lsGet() ?? DEFAULT_ID;
  }, []);
  const [active, setActive] = useState(isValid(initial) ? initial : DEFAULT_ID);

  // Nöbet kuralları state'i (tek yerde yönetim)
  const [dutyRules, setDutyRules] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY_RULES) || "[]");
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try { localStorage.setItem(LS_KEY_RULES, JSON.stringify(dutyRules)); } catch {}
  }, [dutyRules]);

  // Backend sync (online-only yapıda tek kaynak)
  const syncTimer = useRef(null);
  const loadedRef = useRef(false);
  const RULE_SCOPE = { sectionId: "calisma-cizelgesi", serviceId: "", role: "" };

  useEffect(() => {
    let alive = true;
    const token = getToken();
    if (!token) return;
    (async () => {
      try {
        const qs = new URLSearchParams(RULE_SCOPE).toString();
        const res = await API.http.get(`/api/duty-rules?${qs}`);
        const backendRules = res?.rule?.rules || null;
        if (!alive) return;
        if (backendRules) {
          setDutyRules((prev) => applyBackendRulesToList(prev, backendRules));
        }
        loadedRef.current = true;
      } catch (err) {
        loadedRef.current = true;
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    if (!loadedRef.current) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(async () => {
      try {
        const rules = mapRulesToBackend(dutyRules);
        await API.http.req(`/api/duty-rules`, { method: "PUT", body: { ...RULE_SCOPE, rules, weights: {} } });
      } catch (err) {
        console.warn("DutyRules sync failed:", err?.message || err);
      }
    }, 600);
    return () => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
  }, [dutyRules]);

  // active değişince hem LS’e hem HASH’e yaz
  useEffect(() => {
    if (!isValid(active)) {
      lsClear();
      setActive(DEFAULT_ID);
      return;
    }
    lsSet(active);
    if (!currentHashEquals(active)) setHashSub(active);
  }, [active]);

  // Dışarıdan hash değişirse içeri al (geri/ileri butonları vb.)
  useEffect(() => {
    const onHash = () => {
      const h = subFromHash();
      if (h && h !== active) {
        setActive(h);
      } else if (!h) {
        const fromLs = lsGet() ?? DEFAULT_ID;
        if (fromLs !== active) setActive(fromLs);
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [active]);

  const handleClick = (id) => {
    if (!isValid(id)) return;
    lsSet(id);
    setHashSub(id);
    setActive(id);
  };

  const go = (dir) => {
    const i = SUBTABS.findIndex((t) => t.id === active);
    const j = Math.min(SUBTABS.length - 1, Math.max(0, i + dir));
    handleClick(SUBTABS[j].id);
  };

  const resetRemembered = () => {
    lsClear();
    handleClick(DEFAULT_ID);
  };

  return (
    <div className="p-4">
      {/* Üst menü */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {SUBTABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => handleClick(t.id)}
            className={cn(
              "px-3 py-2 text-sm rounded border",
              active === t.id ? "bg-blue-50 border-blue-400" : "bg-white"
            )}
          >
            {t.label}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          <button type="button" className="px-2 py-2 text-sm border rounded" onClick={() => go(-1)} title="Önceki">‹</button>
          <button type="button" className="px-2 py-2 text-sm border rounded" onClick={() => go(1)} title="Sonraki">›</button>
          <button type="button" className="px-2 py-1 text-xs border rounded" onClick={resetRemembered}>Sıfırla</button>
        </div>
      </div>

      {/* İçerik */}
      <div className="mt-2">
        {active === "calisma-alanlari" && <WorkAreasTab />}
        {active === "calisma-saatleri" && <WorkingHoursTab />}
        {active === "izin-turleri"     && <LeaveTypesTab />}
        {active === "tatil-takvimi"    && <HolidayCalendarTab />}
        {active === "nobet-kurallari"  && (
          <DutyRulesTabExplained rules={dutyRules} setRules={setDutyRules} />
        )}
        {active === "istek"            && <RequestBoxTab />}
      </div>
    </div>
  );
}
