// src/tabs/ParametersTab.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import "../styles/parameters-ui-v2.css";
import {
  Building2,
  CalendarClock,
  Clock3,
  ClipboardList,
  FileSpreadsheet,
  Settings2,
  ShieldCheck,
} from "lucide-react";

import WorkAreasTab from "./WorkAreasTab.jsx";
import WorkingHoursTab from "./WorkingHoursTab.jsx";
import LeaveTypesTab from "./LeaveTypesTab.jsx";
import HolidayCalendarTab from "./HolidayCalendarTab.jsx";
import ServicesTab from "./ServicesTab.jsx";
import DutyRulesTabExplained from "./DutyRulesTab.Explained.jsx"; // ✅ açıklamalı yeni bileşen
import ScheduleRulesManager from "../components/ScheduleRulesManager.jsx";
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

  const v6 = numRule(["WEEKLY_MAX_SHIFTS", "WEEKLY_MAX_DUTIES", "WEEKLY_MAX_SHIFTS_PER_PERSON"], 0);
  if (v6 !== undefined) out.MAX_SHIFTS_PER_WEEK = v6;

  const v7 = numRule(["MAX_TASK_PER_PERSON", "MAX_SAME_TASK_PER_PERSON"], 0);
  if (v7 !== undefined) out.MAX_TASK_PER_PERSON = v7;

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
  if ("MAX_SHIFTS_PER_WEEK" in backendRules) {
    const v = Number(backendRules.MAX_SHIFTS_PER_WEEK);
    setRule("WEEKLY_MAX_SHIFTS", Number.isFinite(v) && v > 0, Number.isFinite(v) ? v : undefined);
    setRule("WEEKLY_MAX_DUTIES", Number.isFinite(v) && v > 0, Number.isFinite(v) ? v : undefined);
  }
  if ("MAX_TASK_PER_PERSON" in backendRules) {
    const v = Number(backendRules.MAX_TASK_PER_PERSON);
    setRule("MAX_TASK_PER_PERSON", Number.isFinite(v) && v > 0, Number.isFinite(v) ? v : undefined);
    setRule("MAX_SAME_TASK_PER_PERSON", Number.isFinite(v) && v > 0, Number.isFinite(v) ? v : undefined);
  }

  return rules.map((r) => byId.get(r.id) || r);
}

function stableRulesPayload(scope, list) {
  return JSON.stringify({
    ...scope,
    rules: mapRulesToBackend(list),
    weights: {},
  });
}

const SUBTABS = [
  {
    id: "calisma-alanlari",
    label: "Çalışma Alanları",
    eyebrow: "Yerleşim",
    description: "Personel görev alanları ve çalışma kapsamı tanımlarını yönetin.",
    icon: Building2,
  },
  {
    id: "calisma-saatleri",
    label: "Çalışma Saatleri",
    eyebrow: "Saat Tanımı",
    description: "Vardiya kodlarının başlangıç, bitiş ve saat karşılıklarını belirleyin.",
    icon: Clock3,
  },
  {
    id: "izin-turleri",
    label: "İzin Türleri",
    eyebrow: "İzin Kuralları",
    description: "İzin kodlarının çalışma saati etkisini ve kullanım mantığını tanımlayın.",
    icon: ClipboardList,
  },
  {
    id: "servisler",
    label: "Servisler",
    eyebrow: "Organizasyon",
    description: "Kurumsal servis listesini ve aktif servis yapısını düzenleyin.",
    icon: Building2,
  },
  {
    id: "tatil-takvimi",
    label: "Tatil Takvimi",
    eyebrow: "Takvim",
    description: "Resmi tatil ve arife günlerini tüm hesap ekranları için ortak yönetin.",
    icon: CalendarClock,
  },
  {
    id: "nobet-kurallari",
    label: "Nöbet Kuralları",
    eyebrow: "Kural Seti",
    description: "Dinlenme, izin, ardışık vardiya ve güvenlik kurallarını yönetin.",
    icon: ShieldCheck,
  },
  {
    id: "nobet-yazma-kurallari",
    label: "Nöbet Yazma Kuralları",
    eyebrow: "Yazım Mantığı",
    description: "Otomatik çizelge üretiminde kullanılan yazım davranışlarını belirleyin.",
    icon: Settings2,
  },
  {
    id: "istek",
    label: "İstek",
    eyebrow: "Talep Kaynağı",
    description: "Personel taleplerinin planlama ve çizelgelere nasıl yansıyacağını yönetin.",
    icon: FileSpreadsheet,
  },
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
export default function ParametersTab({
  workAreas,
  setWorkAreas,
  workingHours,
  setWorkingHours,
  leaveTypes,
  setLeaveTypes,
  requestBox,
  setRequestBox,
  people,
}) {
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
  const lastSyncedRulesRef = useRef("");
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
          setDutyRules((prev) => {
            const next = applyBackendRulesToList(prev, backendRules);
            lastSyncedRulesRef.current = stableRulesPayload(RULE_SCOPE, next);
            return next;
          });
        } else {
          lastSyncedRulesRef.current = stableRulesPayload(RULE_SCOPE, dutyRules);
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
    const payload = { ...RULE_SCOPE, rules: mapRulesToBackend(dutyRules), weights: {} };
    const serialized = JSON.stringify(payload);
    if (lastSyncedRulesRef.current === serialized) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(async () => {
      try {
        await API.http.req(`/api/duty-rules`, { method: "PUT", body: payload, retries: 0 });
        lastSyncedRulesRef.current = serialized;
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

  const activeMeta = SUBTABS.find((t) => t.id === active) || SUBTABS[0];
  const ActiveIcon = activeMeta?.icon || Settings2;

  return (
    <div className="params-ui-v2 p-4">
      <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
              <Settings2 className="h-3.5 w-3.5 text-sky-700" />
              Sistem Parametreleri
            </div>
            <div className="mt-3 text-xl font-semibold tracking-tight text-slate-950">Yapılandırma Merkezi</div>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Buradaki ayarlar çalışma çizelgesi, aylık çalışma, fazla mesai ve izin akışlarının ortak davranışını belirler.
            </p>
          </div>

          <div className="mt-4 space-y-2">
            {SUBTABS.map((t) => {
              const Icon = t.icon;
              const isActiveTab = active === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleClick(t.id)}
                  data-params-tab-btn
                  data-active={isActiveTab ? "true" : "false"}
                  className={cn(
                    "w-full rounded-[22px] border px-4 py-3 text-left transition-all",
                    isActiveTab
                      ? "border-slate-900 bg-slate-950 text-white shadow-[0_18px_40px_-28px_rgba(15,23,42,0.75)]"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border",
                      isActiveTab
                        ? "border-white/15 bg-white/10 text-white"
                        : "border-slate-200 bg-slate-100 text-slate-700"
                    )}>
                      <Icon className="h-4.5 w-4.5" />
                    </div>
                    <div className="min-w-0">
                      <div className={cn(
                        "text-[11px] font-medium uppercase tracking-[0.16em]",
                        isActiveTab ? "text-white/70" : "text-slate-500"
                      )}>
                        {t.eyebrow}
                      </div>
                      <div className={cn("mt-1 text-sm font-semibold", isActiveTab ? "text-white" : "text-slate-900")}>
                        {t.label}
                      </div>
                      <div className={cn("mt-1 text-xs leading-5", isActiveTab ? "text-white/72" : "text-slate-500")}>
                        {t.description}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-4 rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
            <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Hızlı Geçiş</div>
            <div className="mt-3 flex gap-2">
              <button type="button" className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100" onClick={() => go(-1)} title="Önceki">
                Önceki
              </button>
              <button type="button" className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100" onClick={() => go(1)} title="Sonraki">
                Sonraki
              </button>
            </div>
            <button
              type="button"
              className="mt-3 w-full rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100"
              onClick={resetRemembered}
            >
              Varsayılan Sekmeye Dön
            </button>
          </div>
        </aside>

        <section className="min-w-0 space-y-4">
          <div data-params-topbar className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
                  <ActiveIcon className="h-3.5 w-3.5 text-sky-700" />
                  {activeMeta.eyebrow}
                </div>
                <div className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{activeMeta.label}</div>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{activeMeta.description}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[320px]">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Etkilediği Alanlar</div>
                  <div className="mt-2 text-sm font-medium text-slate-800">Çizelgeler, Planlama, Fazla Mesai</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Çalışma Notu</div>
                  <div className="mt-2 text-sm font-medium text-slate-800">Değişiklikler tüm sistem davranışını etkileyebilir.</div>
                </div>
              </div>
            </div>
          </div>

          <div data-params-content className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
        {active === "calisma-alanlari" && (
          <WorkAreasTab
            workAreas={workAreas}
            setWorkAreas={setWorkAreas}
            people={people}
          />
        )}
        {active === "calisma-saatleri" && (
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-slate-600">
                Aylık Zorunlu Çalışma Saati
              </label>
              <input
                type="number"
                min={0}
                step={1}
                defaultValue={Number(localStorage.getItem("monthlyRequiredHours")) || ""}
                placeholder="örn. 160"
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (val > 0) {
                    localStorage.setItem("monthlyRequiredHours", String(val));
                  } else {
                    localStorage.removeItem("monthlyRequiredHours");
                  }
                  window.dispatchEvent(new Event("settings:changed"));
                }}
              />
            </div>
            <WorkingHoursTab workingHours={workingHours} setWorkingHours={setWorkingHours} />
          </div>
        )}
        {active === "izin-turleri"     && (
          <LeaveTypesTab leaveTypes={leaveTypes} setLeaveTypes={setLeaveTypes} />
        )}
        {active === "servisler"        && <ServicesTab />}
        {active === "tatil-takvimi"    && <HolidayCalendarTab />}
        {active === "nobet-kurallari"  && (
          <DutyRulesTabExplained rules={dutyRules} setRules={setDutyRules} />
        )}
        {active === "nobet-yazma-kurallari" && (
          <ScheduleRulesManager sectionId="calisma-cizelgesi" />
        )}
        {active === "istek"            && (
          <RequestBoxTab
            requests={requestBox}
            setRequests={setRequestBox}
            people={people}
          />
        )}
          </div>
        </section>
      </div>
    </div>
  );
}
