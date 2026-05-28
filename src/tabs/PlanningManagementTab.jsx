// src/tabs/PlanningManagementTab.jsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Calendar, ChevronRight, Clock, Flag, LayoutList, Plus,
  RefreshCw, Search, Trash2, X, CheckCircle2, Circle,
  AlertCircle, BarChart2, Pencil, ChevronLeft,
} from "lucide-react";
import {
  getPlannings, getPlanning, createPlanning, updatePlanning, deletePlanning,
  createPlanningTask, updatePlanningTask, patchPlanningTaskStatus, deletePlanningTask,
  checkPlanningTaskConflicts,
} from "../api/apiAdapter.js";
import useServicesModel from "../hooks/useServicesModel.js";

// ─── Sabitler ────────────────────────────────────────────────────────────────

const STATUS_META = {
  draft:     { label: "Taslak",      cls: "bg-slate-100 text-slate-600" },
  active:    { label: "Aktif",       cls: "bg-blue-100 text-blue-700" },
  completed: { label: "Tamamlandı",  cls: "bg-emerald-100 text-emerald-700" },
  cancelled: { label: "İptal",       cls: "bg-rose-100 text-rose-700" },
};
const PRIORITY_META = {
  low:      { label: "Düşük",   cls: "bg-emerald-100 text-emerald-700", icon: "↓" },
  medium:   { label: "Orta",    cls: "bg-amber-100 text-amber-700",     icon: "●" },
  high:     { label: "Yüksek",  cls: "bg-orange-100 text-orange-700",   icon: "↑" },
  critical: { label: "Kritik",  cls: "bg-rose-100 text-rose-700",       icon: "!!!" },
};
const TASK_STATUS_META = {
  "todo":        { label: "Yapılacak",     cls: "bg-slate-100 text-slate-600" },
  "in-progress": { label: "Devam Ediyor", cls: "bg-blue-100 text-blue-700" },
  "review":      { label: "İncelemede",   cls: "bg-amber-100 text-amber-700" },
  "completed":   { label: "Tamamlandı",   cls: "bg-emerald-100 text-emerald-700" },
};

const now = new Date();
const DEFAULT_PERIOD = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const MONTH_LABELS = ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"];

const EMPTY_PLANNING_FORM = { title: "", period: DEFAULT_PERIOD, serviceId: "", description: "", priority: "medium", status: "draft" };
const EMPTY_TASK_FORM     = { title: "", description: "", startDate: "", dueDate: "", priority: "medium", status: "todo", estimatedHours: "", assignedToName: "" };

function toYmd(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function periodBounds(period) {
  const [rawYear, rawMonth] = String(period || DEFAULT_PERIOD).split("-").map(Number);
  const year = rawYear || now.getFullYear();
  const month = rawMonth || now.getMonth() + 1;
  return {
    year,
    month,
    startDate: `${year}-${String(month).padStart(2, "0")}-01`,
    endDate: toYmd(new Date(year, month, 0)),
  };
}

function periodFromPlanning(planning) {
  if (planning?.year && planning?.month) return `${planning.year}-${String(planning.month).padStart(2, "0")}`;
  return String(planning?.startDate || "").slice(0, 7) || DEFAULT_PERIOD;
}

function formatPlanningPeriod(planning) {
  const [year, month] = periodFromPlanning(planning).split("-").map(Number);
  return year && month ? `${MONTH_LABELS[month - 1]} ${year}` : "Dönem seçilmedi";
}

function normalizeService(service) {
  const id = String(service?._id || service?.id || service?.serviceId || "");
  const name = String(service?.name || service?.title || service?.label || service?.code || id);
  return { id, name };
}

function extractPlanning(response) {
  return response?.planning || response?.data || response;
}

// ─── Yardımcı bileşenler ─────────────────────────────────────────────────────

function Badge({ meta, value }) {
  const m = meta[value] || { label: value, cls: "bg-slate-100 text-slate-600" };
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${m.cls}`}>{m.icon && <span>{m.icon}</span>}{m.label}</span>;
}

function ProgressBar({ value = 0 }) {
  return (
    <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
      <div className="h-1.5 rounded-full bg-blue-500 transition-all" style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  );
}

function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className={`bg-white rounded-2xl shadow-2xl w-full ${wide ? "max-w-2xl" : "max-w-lg"} max-h-[90vh] flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-[15px] font-semibold text-slate-800">{title}</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 text-slate-500"><X size={16} /></button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-4">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, required, error, children }) {
  return (
    <div className="space-y-1">
      <label className="text-[12px] font-medium text-slate-600">{label}{required && <span className="text-rose-500 ml-0.5">*</span>}</label>
      {children}
      {error && <p className="text-[11px] text-rose-500">{error}</p>}
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent";
const selCls   = inputCls;

// ─── Form: Planlama ──────────────────────────────────────────────────────────

function PlanningForm({ initial, services = [], onSave, onClose, saving }) {
  const [form, setForm] = useState(initial || EMPTY_PLANNING_FORM);
  const [errors, setErrors] = useState({});

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const validate = () => {
    const e = {};
    if (!form.title.trim() || form.title.trim().length < 3) e.title = "En az 3 karakter";
    if (!form.period) e.period = "Zorunlu";
    if (!form.serviceId) e.serviceId = "Zorunlu";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = () => {
    if (!validate()) return;
    const selectedService = services.find((service) => service.id === String(form.serviceId));
    onSave({
      title: form.title.trim(),
      description: String(form.description || "").trim(),
      ...periodBounds(form.period),
      serviceId: String(form.serviceId || ""),
      serviceName: selectedService?.name || "",
      priority: form.priority || "medium",
      status: form.status || "draft",
    });
  };

  return (
    <div className="space-y-4">
      <Field label="Plan Adı" required error={errors.title}>
        <input className={inputCls} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Örn. Mayıs 2026 Acil Servis Hemşire Planı" maxLength={100} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Dönem" required error={errors.period}>
          <input type="month" className={inputCls} value={form.period} onChange={(e) => set("period", e.target.value)} />
        </Field>
        <Field label="Servis" required error={errors.serviceId}>
          <select className={selCls} value={form.serviceId} onChange={(e) => set("serviceId", e.target.value)}>
            <option value="">Servis seçin</option>
            {services.map((service) => (
              <option key={service.id} value={service.id}>{service.name}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Açıklama" error={errors.description}>
        <textarea className={inputCls} rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="İsteğe bağlı..." maxLength={500} />
      </Field>
      <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-[12px] text-blue-700">
        Yeni plan taslak olarak oluşturulur. Sağ panelden detayları görebilir veya çalışma çizelgesine geçebilirsin.
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border text-[13px] text-slate-600 hover:bg-slate-50">Vazgeç</button>
        <button onClick={submit} disabled={saving} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-[13px] font-medium hover:bg-blue-700 disabled:opacity-60">
          {saving ? "Kaydediliyor…" : "Kaydet"}
        </button>
      </div>
    </div>
  );
}

// ─── Form: Görev ─────────────────────────────────────────────────────────────

function TaskForm({ initial, planningId, onSave, onClose, saving }) {
  const [form, setForm] = useState(initial || EMPTY_TASK_FORM);
  const [errors, setErrors] = useState({});
  const [conflict, setConflict] = useState(null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const validate = () => {
    const e = {};
    if (!form.title.trim() || form.title.trim().length < 3) e.title = "En az 3 karakter";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const checkConflict = async () => {
    if (!form.assignedToName || !form.startDate || !form.dueDate) return;
    try {
      const res = await checkPlanningTaskConflicts({ planningId, startDate: form.startDate, dueDate: form.dueDate, excludeTaskId: initial?._id });
      setConflict(res);
    } catch {}
  };

  const submit = () => { if (validate()) onSave({ ...form, planningId }); };

  return (
    <div className="space-y-4">
      <Field label="Görev Başlığı" required error={errors.title}>
        <input className={inputCls} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Görev başlığı..." maxLength={100} />
      </Field>
      <Field label="Açıklama">
        <textarea className={inputCls} rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="İsteğe bağlı..." maxLength={500} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Başlangıç Tarihi">
          <input type="date" className={inputCls} value={form.startDate} onChange={(e) => set("startDate", e.target.value)} onBlur={checkConflict} />
        </Field>
        <Field label="Bitiş / Son Tarih">
          <input type="date" className={inputCls} value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} onBlur={checkConflict} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Durum">
          <select className={selCls} value={form.status} onChange={(e) => set("status", e.target.value)}>
            <option value="todo">Yapılacak</option>
            <option value="in-progress">Devam Ediyor</option>
            <option value="review">İncelemede</option>
            <option value="completed">Tamamlandı</option>
          </select>
        </Field>
        <Field label="Öncelik">
          <select className={selCls} value={form.priority} onChange={(e) => set("priority", e.target.value)}>
            <option value="low">Düşük</option>
            <option value="medium">Orta</option>
            <option value="high">Yüksek</option>
            <option value="critical">Kritik</option>
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tahmini Saat">
          <input type="number" min="0" step="0.5" className={inputCls} value={form.estimatedHours} onChange={(e) => set("estimatedHours", e.target.value)} placeholder="ör. 8" />
        </Field>
        <Field label="Atanan Kişi">
          <input className={inputCls} value={form.assignedToName} onChange={(e) => set("assignedToName", e.target.value)} onBlur={checkConflict} placeholder="Kişi adı..." />
        </Field>
      </div>

      {conflict?.hasConflict && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-[12px]">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <div>Bu tarih aralığında <strong>{conflict.conflicts.length} çakışma</strong> tespit edildi. Yine de kaydedebilirsin.</div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border text-[13px] text-slate-600 hover:bg-slate-50">Vazgeç</button>
        <button onClick={submit} disabled={saving} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-[13px] font-medium hover:bg-blue-700 disabled:opacity-60">
          {saving ? "Kaydediliyor…" : "Kaydet"}
        </button>
      </div>
    </div>
  );
}

// ─── Takvim Görünümü ─────────────────────────────────────────────────────────

function CalendarView({ plannings }) {
  const [current, setCurrent] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const { year, month } = current;

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const offset = (firstDay + 6) % 7; // Pazartesi başlangıç

  const monthStr = `${year}-${String(month + 1).padStart(2, "0")}`;
  const DAYS = ["Pt", "Sa", "Ça", "Pe", "Cu", "Ct", "Pz"];
  const MONTHS = ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"];

  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const planningsForDay = (day) => {
    if (!day) return [];
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return plannings.filter((p) => p.startDate <= dateStr && p.endDate >= dateStr);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={() => setCurrent(({ year, month }) => month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 })}
          className="p-2 rounded-lg hover:bg-slate-100"><ChevronLeft size={16} /></button>
        <span className="text-[14px] font-semibold text-slate-700">{MONTHS[month]} {year}</span>
        <button onClick={() => setCurrent(({ year, month }) => month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 })}
          className="p-2 rounded-lg hover:bg-slate-100"><ChevronRight size={16} /></button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {DAYS.map((d) => <div key={d} className="text-center text-[11px] font-semibold text-slate-400 py-1">{d}</div>)}
        {cells.map((day, i) => {
          const items = planningsForDay(day);
          return (
            <div key={i} className={`min-h-[70px] rounded-lg p-1 ${day ? "bg-white border border-slate-100" : ""}`}>
              {day && <div className="text-[11px] text-slate-400 mb-1">{day}</div>}
              {items.slice(0, 2).map((p) => (
                <div key={p._id} className={`text-[10px] px-1 py-0.5 rounded mb-0.5 truncate ${STATUS_META[p.status]?.cls || "bg-blue-100 text-blue-700"}`} title={p.title}>{p.title}</div>
              ))}
              {items.length > 2 && <div className="text-[10px] text-slate-400">+{items.length - 2}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Timeline Görünümü ───────────────────────────────────────────────────────

function TimelineView({ plannings }) {
  if (plannings.length === 0) return <EmptyState message="Gösterilecek planlama yok" />;

  const allDates = plannings.flatMap((p) => [p.startDate, p.endDate]).filter(Boolean).sort();
  const minDate = allDates[0];
  const maxDate = allDates[allDates.length - 1];

  if (!minDate || !maxDate) return <EmptyState message="Tarih bilgisi eksik" />;

  const totalDays = Math.max(1, (new Date(maxDate) - new Date(minDate)) / 86400000);

  const pos = (date) => Math.max(0, Math.min(100, ((new Date(date) - new Date(minDate)) / 86400000 / totalDays) * 100));
  const width = (start, end) => Math.max(2, pos(end) - pos(start));

  return (
    <div className="space-y-2 overflow-x-auto">
      <div className="flex text-[10px] text-slate-400 mb-1">
        <div className="w-36 shrink-0">&nbsp;</div>
        <div className="flex-1 relative h-4">
          <span className="absolute left-0">{minDate}</span>
          <span className="absolute right-0">{maxDate}</span>
        </div>
      </div>
      {plannings.map((p) => (
        <div key={p._id} className="flex items-center gap-2">
          <div className="w-36 shrink-0 text-[12px] text-slate-600 truncate font-medium" title={p.title}>{p.title}</div>
          <div className="flex-1 relative h-7 bg-slate-50 rounded-full overflow-hidden">
            <div
              className={`absolute h-full rounded-full flex items-center px-2 text-[10px] font-semibold text-white overflow-hidden ${
                p.status === "completed" ? "bg-emerald-500" :
                p.status === "cancelled" ? "bg-rose-400" :
                p.priority === "critical" ? "bg-rose-500" :
                p.priority === "high" ? "bg-orange-400" : "bg-blue-500"
              }`}
              style={{ left: `${pos(p.startDate)}%`, width: `${width(p.startDate, p.endDate)}%` }}
              title={`${p.startDate} → ${p.endDate}`}
            >
              {width(p.startDate, p.endDate) > 10 && <span className="truncate">{p.title}</span>}
            </div>
          </div>
          <div className="w-10 text-right text-[11px] text-slate-500">{p.taskStats?.progress ?? 0}%</div>
        </div>
      ))}
    </div>
  );
}

// ─── Boş durum ───────────────────────────────────────────────────────────────

function EmptyState({ message = "Planlama bulunamadı", sub }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
      <LayoutList size={36} className="mb-3 opacity-40" />
      <div className="text-[14px] font-medium">{message}</div>
      {sub && <div className="text-[12px] mt-1">{sub}</div>}
    </div>
  );
}

function PlanningListEmptyState() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-br from-white via-blue-50/50 to-slate-50 px-6 py-10 text-center shadow-sm">
      <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full bg-blue-100/70 blur-2xl" />
      <div className="absolute -left-10 bottom-4 h-24 w-24 rounded-full bg-emerald-100/50 blur-2xl" />

      <div className="relative mx-auto mb-5 flex h-24 w-24 items-center justify-center rounded-3xl bg-white shadow-sm ring-1 ring-blue-100">
        <svg viewBox="0 0 88 88" className="h-16 w-16" role="img" aria-label="Planlama takvimi">
          <rect x="16" y="18" width="56" height="52" rx="14" fill="#eff6ff" stroke="#bfdbfe" strokeWidth="2" />
          <path d="M16 34h56" stroke="#93c5fd" strokeWidth="2" />
          <path d="M31 14v12M57 14v12" stroke="#1d4ed8" strokeWidth="4" strokeLinecap="round" />
          <rect x="27" y="44" width="12" height="10" rx="3" fill="#2563eb" opacity=".88" />
          <rect x="43" y="44" width="18" height="10" rx="3" fill="#14b8a6" opacity=".82" />
          <rect x="27" y="58" width="34" height="5" rx="2.5" fill="#cbd5e1" />
          <path d="M66 59l5 5 10-13" stroke="#059669" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </div>

      <h3 className="relative text-[16px] font-semibold text-slate-900">
        Henüz planlama oluşturulmadı.
      </h3>
      <p className="relative mx-auto mt-2 max-w-[280px] text-[12px] leading-5 text-slate-500">
        Sağ üstteki 'Yeni Planlama' butonunu kullanarak ilk nöbet listenizi hemen hazırlayabilirsiniz.
      </p>
      <div className="relative mt-5 inline-flex items-center gap-2 rounded-full border border-blue-100 bg-white px-3 py-1.5 text-[11px] font-medium text-blue-700 shadow-sm">
        <Plus size={12} />
        İlk planı oluşturun
      </div>
    </div>
  );
}

function PlanningDetailPlaceholder() {
  const rows = ["Acil Servis", "Dahiliye", "Cerrahi", "Yoğun Bakım"];
  return (
    <div className="relative h-full min-h-[360px] overflow-hidden bg-gradient-to-br from-white via-slate-50 to-blue-50/40 p-5">
      <div className="absolute inset-5 opacity-70 blur-[0.2px]">
        <div className="mb-5 flex items-center justify-between rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
          <div className="space-y-2">
            <div className="h-3 w-28 rounded-full bg-slate-200" />
            <div className="h-5 w-52 rounded-full bg-slate-100" />
          </div>
          <div className="h-9 w-28 rounded-xl bg-blue-100" />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="h-20 rounded-2xl border border-blue-100 bg-white" />
          <div className="h-20 rounded-2xl border border-emerald-100 bg-white" />
          <div className="h-20 rounded-2xl border border-amber-100 bg-white" />
        </div>

        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="grid grid-cols-[1.3fr_.8fr_.8fr_.8fr] gap-3 bg-slate-50 px-4 py-3">
            <div className="h-3 rounded-full bg-slate-200" />
            <div className="h-3 rounded-full bg-slate-200" />
            <div className="h-3 rounded-full bg-slate-200" />
            <div className="h-3 rounded-full bg-slate-200" />
          </div>
          {rows.map((row, index) => (
            <div key={row} className="grid grid-cols-[1.3fr_.8fr_.8fr_.8fr] gap-3 border-t border-slate-100 px-4 py-3">
              <div className="h-4 rounded-full bg-slate-200/80" style={{ width: `${72 - index * 6}%` }} />
              <div className="h-4 rounded-full bg-blue-100" />
              <div className="h-4 rounded-full bg-slate-100" />
              <div className="h-4 rounded-full bg-emerald-100" />
            </div>
          ))}
        </div>
      </div>

      <div className="absolute inset-0 bg-white/45 backdrop-blur-[1.5px]" />
      <div className="relative z-10 flex h-full items-center justify-center text-center">
        <div className="max-w-sm rounded-2xl border border-white/80 bg-white/85 px-6 py-5 shadow-sm">
          <LayoutList size={24} className="mx-auto mb-3 text-slate-300" />
          <p className="text-[13px] leading-5 text-slate-500">
            Burada planlama detayları, klinik bilgileri ve nöbetçi listeleri görüntülenecektir.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Planlama Kartı ──────────────────────────────────────────────────────────

function PlanningCard({ p, selected, onSelect, onEdit, onDelete, deleting }) {
  const stats = p.taskStats || {};
  return (
    <div
      className={`rounded-xl border bg-white p-4 cursor-pointer transition-all hover:shadow-md ${selected ? "border-blue-400 ring-2 ring-blue-100" : "border-slate-200"}`}
      onClick={() => onSelect(p)}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="font-semibold text-[13px] text-slate-800 leading-snug flex-1">{p.title}</div>
        <div className="flex gap-1 shrink-0">
          <button onClick={(e) => { e.stopPropagation(); onEdit(p); }} className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600"><Pencil size={13} /></button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(p); }} disabled={deleting === p._id} className="p-1 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-500 disabled:opacity-40"><Trash2 size={13} /></button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1 mb-3">
        <Badge meta={STATUS_META} value={p.status} />
        <Badge meta={PRIORITY_META} value={p.priority} />
      </div>
      <div className="text-[11px] text-slate-500 mb-2">
        {(p.serviceName || "Servis seçilmedi")} · {formatPlanningPeriod(p)}
      </div>
      {(p.startDate || p.endDate) && (
        <div className="flex items-center gap-1 text-[10px] text-slate-400 mb-2">
          <Clock size={10} />
          <span>{p.startDate}{p.endDate && p.startDate ? " → " : ""}{p.endDate}</span>
        </div>
      )}
      <div className="space-y-1.5">
        <ProgressBar value={stats.progress || 0} />
        <div className="text-[10px] text-slate-400">
          {stats.completed || 0}/{stats.total || 0} görev · %{stats.progress || 0} tamamlandı
        </div>
      </div>
    </div>
  );
}

// ─── Görev Satırı ────────────────────────────────────────────────────────────

function TaskRow({ task, onStatusChange, onEdit, onDelete, saving }) {
  const isSaving = saving === task._id;
  const isCompleted = task.status === "completed";
  const statusMeta = TASK_STATUS_META[task.status] || TASK_STATUS_META.todo;

  return (
    <div className={`rounded-xl border p-3 transition-colors ${isCompleted ? "bg-slate-50 border-slate-100" : "bg-white border-slate-200"}`}>
      <div className="flex items-start gap-2">
        {/* Checkbox: hızlı todo↔completed toggle */}
        <button
          onClick={() => onStatusChange(task, isCompleted ? "todo" : "completed")}
          disabled={isSaving}
          className="mt-0.5 shrink-0 text-slate-300 hover:text-emerald-500 disabled:opacity-40 transition-colors"
          title={isCompleted ? "Yapılacak olarak işaretle" : "Tamamlandı olarak işaretle"}
        >
          {isCompleted
            ? <CheckCircle2 size={16} className="text-emerald-500" />
            : <Circle size={16} />}
        </button>

        <div className="flex-1 min-w-0">
          <div className={`text-[13px] font-medium ${isCompleted ? "line-through text-slate-400" : "text-slate-800"}`}>
            {task.title}
          </div>
          {task.description && (
            <div className="text-[11px] text-slate-400 mt-0.5 truncate">{task.description}</div>
          )}

          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {/* Status: inline select, badge görünümünde */}
            <select
              value={task.status}
              onChange={(e) => onStatusChange(task, e.target.value)}
              disabled={isSaving}
              title="Durumu değiştir"
              className={`text-[11px] font-medium rounded-full px-2 py-0.5 cursor-pointer appearance-none border-0 focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:opacity-60 ${statusMeta.cls}`}
            >
              <option value="todo">Yapılacak</option>
              <option value="in-progress">Devam Ediyor</option>
              <option value="review">İncelemede</option>
              <option value="completed">Tamamlandı</option>
            </select>

            <Badge meta={PRIORITY_META} value={task.priority} />

            {task.dueDate && (
              <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                <Clock size={10} />{task.dueDate}
              </span>
            )}
            {task.assignedToName && (
              <span className="text-[10px] text-slate-400">{task.assignedToName}</span>
            )}
            {task.estimatedHours && (
              <span className="text-[10px] text-slate-400">{task.estimatedHours}s</span>
            )}
          </div>
        </div>

        {/* Aksiyonlar: Düzenle + Sil */}
        <div className="flex gap-1 shrink-0 mt-0.5">
          <button
            onClick={() => onEdit(task)}
            className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600"
            title="Düzenle"
          >
            <Pencil size={12} />
          </button>
          <button
            onClick={() => onDelete(task)}
            className="p-1 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-500"
            title="Sil"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Detay Paneli ────────────────────────────────────────────────────────────

function DetailPanel({ planning, tasks, onAddTask, onEditTask, onDeleteTask, onStatusChange, savingTask }) {
  const [activeTab, setActiveTab] = useState("tasks");
  const stats = planning.taskStats || {};

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex border-b px-2 bg-slate-50/50">
        {[["tasks", "Görevler"], ["summary", "Özet"]].map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-3 text-[12px] font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {label}
            {tab === "tasks" && (
              <span className="ml-1.5 text-[10px] bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded-full font-semibold">
                {tasks.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab: Görevler */}
      {activeTab === "tasks" && (
        <>
          <div className="flex items-center justify-between px-4 py-2.5 border-b">
            <span className="text-[12px] font-semibold text-slate-600 truncate max-w-[180px]" title={planning.title}>
              {planning.title}
            </span>
            <button
              onClick={onAddTask}
              className="flex items-center gap-1 text-[12px] px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 shrink-0"
            >
              <Plus size={12} /> Görev Ekle
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {tasks.length === 0
              ? <EmptyState message="Henüz görev yok" sub='Yukarıdan "Görev Ekle"' />
              : tasks.map((t) => (
                <TaskRow
                  key={t._id}
                  task={t}
                  onStatusChange={onStatusChange}
                  onEdit={onEditTask}
                  onDelete={onDeleteTask}
                  saving={savingTask}
                />
              ))
            }
          </div>
        </>
      )}

      {/* Tab: Özet */}
      {activeTab === "summary" && (
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <h2 className="text-[15px] font-semibold text-slate-800 leading-snug">{planning.title}</h2>
          {planning.description && (
            <p className="text-[12px] text-slate-500 leading-relaxed">{planning.description}</p>
          )}
          <div className="flex flex-wrap gap-1.5">
            <Badge meta={STATUS_META} value={planning.status} />
            <Badge meta={PRIORITY_META} value={planning.priority} />
          </div>
          {(planning.startDate || planning.endDate) && (
            <div className="flex items-center gap-2 text-[12px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              <Clock size={13} className="text-slate-400 shrink-0" />
              <span>{planning.startDate}{planning.endDate ? ` → ${planning.endDate}` : ""}</span>
            </div>
          )}
          <div className="space-y-2 p-3 bg-slate-50 border border-slate-200 rounded-xl">
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-slate-500">{stats.completed || 0}/{stats.total || 0} görev tamamlandı</span>
              <span className="font-semibold text-slate-700">%{stats.progress || 0}</span>
            </div>
            <ProgressBar value={stats.progress || 0} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Ana bileşen ─────────────────────────────────────────────────────────────

export default function PlanningManagementTab() {
  const [view, setView] = useState("list"); // list | calendar | timeline
  const [plannings, setPlannings] = useState([]);
  const [selected, setSelected] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ search: "", status: "", priority: "" });
  const [showPlanningModal, setShowPlanningModal] = useState(false);
  const [editingPlanning, setEditingPlanning] = useState(null);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savingTask, setSavingTask] = useState("");
  const [deleting, setDeleting] = useState("");
  const servicesModel = useServicesModel();

  const services = useMemo(() => (
    servicesModel.list().map(normalizeService).filter((service) => service.id)
  ), [servicesModel]);

  // ── Veri yükleme ─────────────────────────────────────────────────────────

  const loadPlannings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getPlannings({ status: filters.status || undefined, priority: filters.priority || undefined });
      const list = res?.plannings || [];
      setPlannings(list);
      setSelected((prev) => {
        if (!prev?._id) return prev;
        return list.find((p) => p._id === prev._id) || prev;
      });
    } catch (e) {
      toast.error(e?.message || "Planlamalar yüklenemedi");
    } finally {
      setLoading(false);
    }
  }, [filters.status, filters.priority]);

  const loadTasks = useCallback(async (planningId) => {
    if (!planningId) return;
    try {
      const res = await getPlanning(planningId);
      setTasks(res?.tasks || []);
      if (res) {
        setSelected((prev) => prev?._id === planningId ? { ...prev, taskStats: res.taskStats } : prev);
        setPlannings((prev) => prev.map((p) => p._id === planningId ? { ...p, taskStats: res.taskStats } : p));
      }
    } catch (e) {
      toast.error(e?.message || "Görevler yüklenemedi");
    }
  }, []);

  useEffect(() => { loadPlannings(); }, [loadPlannings]);
  useEffect(() => { if (selected?._id) loadTasks(selected._id); }, [selected?._id, loadTasks]);

  // ── Filtreleme ────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = filters.search.toLowerCase();
    return plannings.filter((p) => {
      const haystack = `${p.title || ""} ${p.description || ""} ${p.serviceName || ""} ${formatPlanningPeriod(p)}`.toLowerCase();
      if (q && !haystack.includes(q)) return false;
      return true;
    });
  }, [plannings, filters.search]);
  const isPlanningListEmpty = !loading && plannings.length === 0;
  const hasNoFilteredPlanning = !loading && filtered.length === 0;

  const selectPlanning = useCallback((planning) => {
    setSelected(planning);
    if (planning?._id) sessionStorage.setItem("planningManagement:selectedId", planning._id);
  }, []);

  const openSelectedPlanningSchedule = useCallback(() => {
    if (!selected?._id) return;
    const [year, month] = periodFromPlanning(selected).split("-").map(Number);
    sessionStorage.setItem("planningManagement:selectedPlan", JSON.stringify({
      id: selected._id,
      title: selected.title || "",
      serviceId: selected.serviceId || "",
      serviceName: selected.serviceName || "",
      year,
      month,
    }));
    window.location.hash = "#/cizelgeler/calisma-cizelgesi";
  }, [selected]);

  // ── Planlama CRUD ─────────────────────────────────────────────────────────

  const handleSavePlanning = async (form) => {
    setSaving(true);
    try {
      let saved = null;
      if (editingPlanning) {
        saved = extractPlanning(await updatePlanning(editingPlanning._id, form));
        toast.success("Planlama güncellendi");
      } else {
        saved = extractPlanning(await createPlanning(form));
        toast.success("Planlama oluşturuldu");
      }
      if (saved?._id) {
        setSelected(saved);
        setPlannings((prev) => {
          if (editingPlanning) return prev.map((p) => p._id === saved._id ? saved : p);
          return [saved, ...prev.filter((p) => p._id !== saved._id)];
        });
        if (!editingPlanning) setTasks([]);
      }
      setShowPlanningModal(false);
      setEditingPlanning(null);
      await loadPlannings();
    } catch (e) {
      toast.error(e?.message || "Kaydedilemedi");
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePlanning = async (p) => {
    if (!window.confirm(`"${p.title}" planlamasını silmek istediğinizden emin misiniz?\nBağlı tüm görevler de silinecek.`)) return;
    setDeleting(p._id);
    try {
      await deletePlanning(p._id);
      toast.success("Planlama silindi");
      if (selected?._id === p._id) { setSelected(null); setTasks([]); }
      loadPlannings();
    } catch (e) {
      toast.error(e?.message || "Silinemedi");
    } finally {
      setDeleting("");
    }
  };

  // ── Görev CRUD ────────────────────────────────────────────────────────────

  const handleSaveTask = async (form) => {
    setSaving(true);
    try {
      if (editingTask) {
        await updatePlanningTask(editingTask._id, form);
        toast.success("Görev güncellendi");
      } else {
        await createPlanningTask(form);
        toast.success("Görev eklendi");
      }
      setShowTaskModal(false);
      setEditingTask(null);
      loadTasks(selected._id);
    } catch (e) {
      toast.error(e?.message || "Görev kaydedilemedi");
    } finally {
      setSaving(false);
    }
  };

  const handleTaskStatusChange = async (task, newStatus) => {
    setSavingTask(task._id);
    try {
      await patchPlanningTaskStatus(task._id, newStatus);
      loadTasks(selected._id);
    } catch (e) {
      toast.error(e?.message || "Durum güncellenemedi");
    } finally {
      setSavingTask("");
    }
  };

  const handleDeleteTask = async (task) => {
    if (!window.confirm(`"${task.title}" görevini silmek istiyor musunuz?`)) return;
    setSavingTask(task._id);
    try {
      await deletePlanningTask(task._id);
      toast.success("Görev silindi");
      loadTasks(selected._id);
    } catch (e) {
      toast.error(e?.message || "Görev silinemedi");
    } finally {
      setSavingTask("");
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full gap-4">

      {/* ── Satır 1: Sayfa başlığı + Primary action ── */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[16px] font-semibold text-slate-800 leading-tight">Planlama Kontrol Merkezi</h1>
          <p className="text-[12px] text-slate-400 mt-0.5">Proje planlama ve görev takibi</p>
        </div>
        <div className="relative shrink-0">
          <button
            onClick={() => { setEditingPlanning(null); setShowPlanningModal(true); }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 text-white text-[13px] font-medium hover:bg-blue-700 shadow-sm"
          >
            <Plus size={14} /> Yeni Planlama
          </button>
          {isPlanningListEmpty && (
            <div className="pointer-events-none absolute right-0 top-[calc(100%+10px)] z-20 hidden w-64 rounded-2xl border border-blue-100 bg-white px-4 py-3 text-[12px] text-slate-600 shadow-xl lg:block">
              <div className="absolute -top-1.5 right-8 h-3 w-3 rotate-45 border-l border-t border-blue-100 bg-white" />
              <div className="font-semibold text-slate-800">İlk planlamanızı oluşturmak için buraya tıklayın</div>
            </div>
          )}
        </div>
      </div>

      {/* ── Satır 2: Secondary controls ── */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200">
        {/* Görünüm seçici */}
        <div className="flex rounded-lg border border-slate-200 overflow-hidden text-[12px] bg-white">
          {[["list","Liste",<LayoutList size={12}/>],["calendar","Takvim",<Calendar size={12}/>],["timeline","Timeline",<BarChart2 size={12}/>]].map(([v, l, icon]) => (
            <button key={v} onClick={() => setView(v)} className={`flex items-center gap-1 px-3 py-1.5 transition-colors ${view === v ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}>{icon}{l}</button>
          ))}
        </div>

        <div className="w-px h-5 bg-slate-200 hidden sm:block" />

        {/* Arama */}
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="pl-7 pr-3 py-1.5 text-[12px] border border-slate-200 rounded-lg w-36 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
            placeholder="Ara…"
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          />
        </div>

        {/* Durum filtresi */}
        <select
          className="text-[12px] border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
          value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
        >
          <option value="">Tüm Durumlar</option>
          <option value="draft">Taslak</option>
          <option value="active">Aktif</option>
          <option value="completed">Tamamlandı</option>
          <option value="cancelled">İptal</option>
        </select>

        {/* Öncelik filtresi */}
        <select
          className="text-[12px] border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
          value={filters.priority}
          onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))}
        >
          <option value="">Tüm Öncelikler</option>
          <option value="low">Düşük</option>
          <option value="medium">Orta</option>
          <option value="high">Yüksek</option>
          <option value="critical">Kritik</option>
        </select>

        {/* Yenile */}
        <button
          onClick={loadPlannings}
          disabled={loading}
          className="ml-auto p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 disabled:opacity-40"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Takvim / Timeline görünümleri */}
      {view === "calendar" && (
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <CalendarView plannings={filtered} />
        </div>
      )}
      {view === "timeline" && (
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <TimelineView plannings={filtered} />
        </div>
      )}

      {/* Liste görünümü: 2 kolon */}
      {view === "list" && (
        <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
          {/* Sol: Planlama listesi */}
          <div className="lg:w-80 xl:w-96 flex flex-col gap-2 overflow-y-auto">
            {loading && <div className="text-center py-8 text-slate-400 text-[13px]">Yükleniyor…</div>}
            {hasNoFilteredPlanning && (
              isPlanningListEmpty
                ? <PlanningListEmptyState />
                : <EmptyState message="Sonuç bulunamadı" sub="Arama veya filtreleri temizleyin" />
            )}
            {filtered.map((p) => (
              <PlanningCard
                key={p._id}
                p={p}
                selected={selected?._id === p._id}
                onSelect={selectPlanning}
                onEdit={(pl) => { setEditingPlanning(pl); setShowPlanningModal(true); }}
                onDelete={handleDeletePlanning}
                deleting={deleting}
              />
            ))}
          </div>

          {/* Sağ: Detay + Görevler */}
          <div className="flex-1 rounded-2xl border bg-white shadow-sm min-h-0 overflow-hidden">
            {selected ? (
              <div className="flex flex-col h-full">
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b bg-slate-50/70">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-slate-800 truncate">{selected.title}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {(selected.serviceName || "Servis seçilmedi")} · {formatPlanningPeriod(selected)}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => loadTasks(selected._id)}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-[12px] text-slate-600 hover:bg-slate-50"
                    >
                      Detayları Gör
                    </button>
                    <button
                      onClick={openSelectedPlanningSchedule}
                      className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-[12px] font-medium hover:bg-blue-700"
                    >
                      Çizelgeyi Düzenle
                    </button>
                  </div>
                </div>
                <div className="flex-1 min-h-0">
                  <DetailPanel
                    planning={selected}
                    tasks={tasks}
                    onAddTask={() => { setEditingTask(null); setShowTaskModal(true); }}
                    onEditTask={(t) => { setEditingTask(t); setShowTaskModal(true); }}
                    onDeleteTask={handleDeleteTask}
                    onStatusChange={handleTaskStatusChange}
                    savingTask={savingTask}
                  />
                </div>
              </div>
            ) : isPlanningListEmpty ? (
              <PlanningDetailPlaceholder />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 py-20">
                <ChevronRight size={32} className="mb-2 opacity-30" />
                <div className="text-[13px]">Soldaki listeden bir planlama seçin</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Planlama formu */}
      {showPlanningModal && (
        <Modal title={editingPlanning ? "Planlamayı Düzenle" : "Yeni Planlama"} onClose={() => { setShowPlanningModal(false); setEditingPlanning(null); }}>
          <PlanningForm
            initial={editingPlanning ? {
              title: editingPlanning.title || "",
              period: periodFromPlanning(editingPlanning),
              serviceId: String(editingPlanning.serviceId || ""),
              description: editingPlanning.description || "",
              priority: editingPlanning.priority || "medium",
              status: editingPlanning.status || "draft",
            } : null}
            services={services}
            onSave={handleSavePlanning}
            onClose={() => { setShowPlanningModal(false); setEditingPlanning(null); }}
            saving={saving}
          />
        </Modal>
      )}

      {/* Modal: Görev formu */}
      {showTaskModal && selected && (
        <Modal title={editingTask ? "Görevi Düzenle" : "Yeni Görev"} onClose={() => { setShowTaskModal(false); setEditingTask(null); }}>
          <TaskForm
            initial={editingTask ? { title: editingTask.title, description: editingTask.description || "", startDate: editingTask.startDate || "", dueDate: editingTask.dueDate || "", priority: editingTask.priority, status: editingTask.status, estimatedHours: editingTask.estimatedHours || "", assignedToName: editingTask.assignedToName || "" } : null}
            planningId={selected._id}
            onSave={handleSaveTask}
            onClose={() => { setShowTaskModal(false); setEditingTask(null); }}
            saving={saving}
          />
        </Modal>
      )}
    </div>
  );
}
