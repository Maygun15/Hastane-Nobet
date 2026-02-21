// src/tabs/ParametersTab.jsx
import React, { useEffect, useMemo, useState } from "react";

import WorkAreasTab from "./WorkAreasTab.jsx";
import WorkingHoursTab from "./WorkingHoursTab.jsx";
import LeaveTypesTab from "./LeaveTypesTab.jsx";
import HolidayCalendarTab from "./HolidayCalendarTab.jsx";
import DutyRulesTabExplained from "./DutyRulesTab.Explained.jsx"; // ✅ açıklamalı yeni bileşen
import RequestBoxTab from "./RequestBoxTab.jsx";

const LS_ACTIVE_SUBTAB = "paramsActiveSubtabV1";
const LS_KEY_RULES = "dutyRulesV2"; // ✅ nöbet kuralları LS anahtarı
const cn = (...c) => c.filter(Boolean).join(" ");

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
