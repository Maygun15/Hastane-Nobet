import React, { useEffect, useRef, useState } from "react";
import DutyRulesTabExplained from "../tabs/DutyRulesTab.Explained.jsx";
import RuleEditor from "../components/RuleEditor.jsx";
import { fetchDutyRules, saveDutyRules } from "../api/apiAdapter.js";

const LS_KEY_RULES = "dutyRulesV2";
const RULE_SCOPE = { sectionId: "calisma-cizelgesi", serviceId: "", role: "" };

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

export default function DutyRulesPage() {
  const [mode, setMode] = useState("level2");
  const [rules, setRules] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY_RULES) || "[]");
    } catch {
      return [];
    }
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const loadedRef = useRef(false);
  const syncTimer = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY_RULES, JSON.stringify(rules));
    } catch {}
  }, [rules]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");

    fetchDutyRules(RULE_SCOPE)
      .then((res) => {
        if (!alive) return;
        const backendRules = res?.rule?.rules || res?.rules || null;
        if (backendRules) {
          setRules((prev) => applyBackendRulesToList(prev, backendRules));
        }
        loadedRef.current = true;
      })
      .catch((err) => {
        if (!alive) return;
        setError(err?.message || "Nöbet kuralları alınamadı.");
        loadedRef.current = true;
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!loadedRef.current) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);

    syncTimer.current = setTimeout(async () => {
      try {
        setSaving(true);
        const rulesPayload = mapRulesToBackend(rules);
        await saveDutyRules({ ...RULE_SCOPE, rules: rulesPayload, weights: {} });
        setError("");
      } catch (err) {
        setError(err?.message || "Kurallar kaydedilemedi.");
      } finally {
        setSaving(false);
      }
    }, 600);

    return () => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
  }, [rules]);

  return (
    <div className="p-2 md:p-4 max-w-[1400px] mx-auto space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg md:text-xl font-semibold text-slate-800">Nöbet Kuralları</h1>
        <div className="text-xs md:text-sm text-slate-500">
          {saving ? "Kaydediliyor…" : loading ? "Yükleniyor…" : "Hazır"}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          className={`px-3 py-1.5 rounded-lg text-xs border ${
            mode === "level2"
              ? "bg-sky-100 border-sky-200 text-sky-700"
              : "bg-white border-slate-200 text-slate-600"
          }`}
          onClick={() => setMode("level2")}
        >
          Level 2 Editor
        </button>
        <button
          className={`px-3 py-1.5 rounded-lg text-xs border ${
            mode === "legacy"
              ? "bg-sky-100 border-sky-200 text-sky-700"
              : "bg-white border-slate-200 text-slate-600"
          }`}
          onClick={() => setMode("legacy")}
        >
          Legacy Editor
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}

      {mode === "level2" ? (
        <RuleEditor scope={RULE_SCOPE} />
      ) : (
        <DutyRulesTabExplained rules={rules} setRules={setRules} />
      )}
    </div>
  );
}
