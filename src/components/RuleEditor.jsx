import React, { useEffect, useMemo, useState } from "react";
import {
  fetchDutyRules,
  saveDutyRules,
  testDutyRules,
} from "../api/apiAdapter.js";

const defaultDoc = {
  departman: "",
  description: "",
  enabled: true,
  rules: {},
  weights: {},
  basicRules: {
    maxConsecutiveDays: 6,
    minRestHours: 12,
    maxWeeklyHours: 72,
    maxDailyHours: 24,
    noDoubleShiftPerDay: true,
    nightShiftFollowUp: "min24hours",
  },
  leaveRules: {},
  shiftRules: {},
  taskRequirements: {},
  personnelRules: {},
  metadata: {},
};

function safeJson(value) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

function parseJson(str, fallback = {}) {
  if (!str || !String(str).trim()) return fallback;
  return JSON.parse(str);
}

export default function RuleEditor({ scope }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("basic");
  const [form, setForm] = useState(defaultDoc);
  const [raw, setRaw] = useState({
    leaveRules: "{}",
    shiftRules: "{}",
    taskRequirements: "{}",
    personnelRules: "{}",
    metadata: "{}",
  });
  const [testInput, setTestInput] = useState(
    safeJson({
      person: { id: "p1", name: "Test Person" },
      shifts: [{ code: "N", label: "Resüsitasyon" }],
      dates: ["2026-03-01"],
      context: {},
    })
  );
  const [testResult, setTestResult] = useState(null);

  const resolvedScope = useMemo(
    () => ({
      sectionId: scope?.sectionId || "calisma-cizelgesi",
      serviceId: scope?.serviceId || "",
      role: scope?.role || "",
    }),
    [scope]
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    fetchDutyRules(resolvedScope)
      .then((res) => {
        if (!alive) return;
        const rule = res?.rule || {};
        const merged = {
          ...defaultDoc,
          ...rule,
          basicRules: { ...defaultDoc.basicRules, ...(rule.basicRules || {}) },
          leaveRules: rule.leaveRules || {},
          shiftRules: rule.shiftRules || {},
          taskRequirements: rule.taskRequirements || {},
          personnelRules: rule.personnelRules || {},
          metadata: rule.metadata || {},
          rules: rule.rules || {},
          weights: rule.weights || {},
        };
        setForm(merged);
        setRaw({
          leaveRules: safeJson(merged.leaveRules),
          shiftRules: safeJson(merged.shiftRules),
          taskRequirements: safeJson(merged.taskRequirements),
          personnelRules: safeJson(merged.personnelRules),
          metadata: safeJson(merged.metadata),
        });
      })
      .catch((err) => setError(err?.message || "Kurallar alınamadı."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [resolvedScope.sectionId, resolvedScope.serviceId, resolvedScope.role]);

  const updateBasic = (key, value) => {
    setForm((prev) => ({
      ...prev,
      basicRules: {
        ...prev.basicRules,
        [key]: value,
      },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const payload = {
        ...resolvedScope,
        departman: form.departman,
        description: form.description,
        enabled: form.enabled,
        rules: form.rules || {},
        weights: form.weights || {},
        basicRules: form.basicRules || {},
        leaveRules: parseJson(raw.leaveRules, form.leaveRules),
        shiftRules: parseJson(raw.shiftRules, form.shiftRules),
        taskRequirements: parseJson(raw.taskRequirements, form.taskRequirements),
        personnelRules: parseJson(raw.personnelRules, form.personnelRules),
        metadata: parseJson(raw.metadata, form.metadata),
      };
      await saveDutyRules(payload);
    } catch (err) {
      setError(err?.message || "Kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    try {
      const body = parseJson(testInput, {});
      const res = await testDutyRules({
        ...resolvedScope,
        ...body,
      });
      setTestResult(res?.result || res);
    } catch (err) {
      setTestResult({ error: err?.message || "Test hatası" });
    }
  };

  const tabs = [
    { id: "basic", label: "Temel Kurallar" },
    { id: "leaves", label: "İzin Kuralları" },
    { id: "shifts", label: "Vardiya Kuralları" },
    { id: "tasks", label: "Görev Gereksinimleri" },
    { id: "personnel", label: "Personel Kuralları" },
    { id: "test", label: "Kural Testi" },
  ];

  if (loading) {
    return <div className="p-4 text-sm text-slate-500">Kurallar yükleniyor…</div>;
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-sm text-slate-600">
          Departman
          <input
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            value={form.departman || ""}
            onChange={(e) => setForm((p) => ({ ...p, departman: e.target.value }))}
            placeholder="Acil Servis"
          />
        </label>
        <label className="text-sm text-slate-600">
          Açıklama
          <input
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            value={form.description || ""}
            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            placeholder="Acil Servis Nöbet Kuralları"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
              activeTab === t.id
                ? "bg-sky-100 border-sky-200 text-sky-700"
                : "bg-white border-slate-200 text-slate-600"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "basic" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-sm text-slate-600">
            Max Consecutive Days
            <input
              type="number"
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              value={form.basicRules?.maxConsecutiveDays ?? 0}
              onChange={(e) => updateBasic("maxConsecutiveDays", Number(e.target.value))}
            />
          </label>
          <label className="text-sm text-slate-600">
            Min Rest Hours
            <input
              type="number"
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              value={form.basicRules?.minRestHours ?? 0}
              onChange={(e) => updateBasic("minRestHours", Number(e.target.value))}
            />
          </label>
          <label className="text-sm text-slate-600">
            Max Weekly Hours
            <input
              type="number"
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              value={form.basicRules?.maxWeeklyHours ?? 0}
              onChange={(e) => updateBasic("maxWeeklyHours", Number(e.target.value))}
            />
          </label>
          <label className="text-sm text-slate-600">
            Max Daily Hours
            <input
              type="number"
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              value={form.basicRules?.maxDailyHours ?? 0}
              onChange={(e) => updateBasic("maxDailyHours", Number(e.target.value))}
            />
          </label>
          <label className="text-sm text-slate-600 flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!form.basicRules?.noDoubleShiftPerDay}
              onChange={(e) => updateBasic("noDoubleShiftPerDay", e.target.checked)}
            />
            No Double Shift Per Day
          </label>
          <label className="text-sm text-slate-600">
            Night Shift Follow-up
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              value={form.basicRules?.nightShiftFollowUp ?? ""}
              onChange={(e) => updateBasic("nightShiftFollowUp", e.target.value)}
              placeholder="min24hours"
            />
          </label>
        </div>
      )}

      {activeTab === "leaves" && (
        <div>
          <div className="text-xs text-slate-500 mb-2">JSON formatında düzenleyin.</div>
          <textarea
            className="w-full min-h-[220px] rounded-lg border px-3 py-2 text-xs font-mono"
            value={raw.leaveRules}
            onChange={(e) => setRaw((r) => ({ ...r, leaveRules: e.target.value }))}
          />
        </div>
      )}

      {activeTab === "shifts" && (
        <div>
          <div className="text-xs text-slate-500 mb-2">JSON formatında düzenleyin.</div>
          <textarea
            className="w-full min-h-[220px] rounded-lg border px-3 py-2 text-xs font-mono"
            value={raw.shiftRules}
            onChange={(e) => setRaw((r) => ({ ...r, shiftRules: e.target.value }))}
          />
        </div>
      )}

      {activeTab === "tasks" && (
        <div>
          <div className="text-xs text-slate-500 mb-2">JSON formatında düzenleyin.</div>
          <textarea
            className="w-full min-h-[220px] rounded-lg border px-3 py-2 text-xs font-mono"
            value={raw.taskRequirements}
            onChange={(e) => setRaw((r) => ({ ...r, taskRequirements: e.target.value }))}
          />
        </div>
      )}

      {activeTab === "personnel" && (
        <div>
          <div className="text-xs text-slate-500 mb-2">JSON formatında düzenleyin.</div>
          <textarea
            className="w-full min-h-[220px] rounded-lg border px-3 py-2 text-xs font-mono"
            value={raw.personnelRules}
            onChange={(e) => setRaw((r) => ({ ...r, personnelRules: e.target.value }))}
          />
        </div>
      )}

      {activeTab === "test" && (
        <div className="space-y-2">
          <div className="text-xs text-slate-500">Test payload (JSON)</div>
          <textarea
            className="w-full min-h-[200px] rounded-lg border px-3 py-2 text-xs font-mono"
            value={testInput}
            onChange={(e) => setTestInput(e.target.value)}
          />
          <button
            className="px-3 py-2 rounded-lg bg-sky-600 text-white text-xs"
            onClick={handleTest}
            type="button"
          >
            Test Et
          </button>
          {testResult && (
            <pre className="text-xs bg-slate-50 border rounded-lg p-2 overflow-auto">
              {safeJson(testResult)}
            </pre>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Kaydediliyor..." : "Kaydet"}
        </button>
      </div>
    </div>
  );
}
