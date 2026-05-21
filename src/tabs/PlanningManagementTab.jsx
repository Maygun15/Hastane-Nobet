// src/tabs/PlanningManagementTab.jsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Calendar, ChevronRight, Clock, Flag, LayoutList, Plus,
  RefreshCw, Search, Trash2, X, CheckCircle2, Circle,
  AlertCircle, BarChart2, Pencil, ChevronLeft, ChevronDown,
} from "lucide-react";
import {
  getPlannings, getPlanning, createPlanning, updatePlanning, deletePlanning,
  createPlanningTask, updatePlanningTask, patchPlanningTaskStatus, deletePlanningTask,
  checkPlanningTaskConflicts,
} from "../api/apiAdapter.js";

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

const EMPTY_PLANNING_FORM = { title: "", description: "", startDate: "", endDate: "", priority: "medium", status: "active" };
const EMPTY_TASK_FORM     = { title: "", description: "", startDate: "", dueDate: "", priority: "medium", status: "todo", estimatedHours: "", assignedToName: "" };

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

function PlanningForm({ initial, onSave, onClose, saving }) {
  const [form, setForm] = useState(initial || EMPTY_PLANNING_FORM);
  const [errors, setErrors] = useState({});

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const validate = () => {
    const e = {};
    if (!form.title.trim() || form.title.trim().length < 3) e.title = "En az 3 karakter";
    if (!form.startDate) e.startDate = "Zorunlu";
    if (!form.endDate) e.endDate = "Zorunlu";
    if (form.startDate && form.endDate && form.endDate < form.startDate) e.endDate = "Başlangıçtan önce olamaz";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = () => { if (validate()) onSave(form); };

  return (
    <div className="space-y-4">
      <Field label="Başlık" required error={errors.title}>
        <input className={inputCls} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Planlama başlığı..." maxLength={100} />
      </Field>
      <Field label="Açıklama" error={errors.description}>
        <textarea className={inputCls} rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="İsteğe bağlı..." maxLength={500} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Başlangıç Tarihi" required error={errors.startDate}>
          <input type="date" className={inputCls} value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />
        </Field>
        <Field label="Bitiş Tarihi" required error={errors.endDate}>
          <input type="date" className={inputCls} value={form.endDate} onChange={(e) => set("endDate", e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Öncelik">
          <select className={selCls} value={form.priority} onChange={(e) => set("priority", e.target.value)}>
            <option value="low">Düşük</option>
            <option value="medium">Orta</option>
            <option value="high">Yüksek</option>
            <option value="critical">Kritik</option>
          </select>
        </Field>
        <Field label="Durum">
          <select className={selCls} value={form.status} onChange={(e) => set("status", e.target.value)}>
            <option value="draft">Taslak</option>
            <option value="active">Aktif</option>
            <option value="completed">Tamamlandı</option>
            <option value="cancelled">İptal</option>
          </select>
        </Field>
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
      {(p.startDate || p.endDate) && (
        <div className="flex items-center gap-1 text-[11px] text-slate-400 mb-3">
          <Clock size={11} />{p.startDate} → {p.endDate}
        </div>
      )}
      <div className="space-y-1">
        <div className="flex justify-between text-[11px] text-slate-500">
          <span>{stats.total || 0} görev</span>
          <span>{stats.progress || 0}%</span>
        </div>
        <ProgressBar value={stats.progress || 0} />
        <div className="text-[10px] text-slate-400">{stats.completed || 0} tamamlandı · {(stats.total || 0) - (stats.completed || 0)} kaldı</div>
      </div>
    </div>
  );
}

// ─── Görev Satırı ────────────────────────────────────────────────────────────

function TaskRow({ task, onStatusChange, onEdit, onDelete, saving }) {
  const [open, setOpen] = useState(false);
  const isSaving = saving === task._id;
  const isCompleted = task.status === "completed";

  return (
    <div className={`rounded-xl border p-3 transition-colors ${isCompleted ? "bg-slate-50 border-slate-100" : "bg-white border-slate-200"}`}>
      <div className="flex items-start gap-2">
        <button
          onClick={() => onStatusChange(task, isCompleted ? "todo" : "completed")}
          disabled={isSaving}
          className="mt-0.5 shrink-0 text-slate-300 hover:text-emerald-500 disabled:opacity-40 transition-colors"
        >
          {isCompleted ? <CheckCircle2 size={16} className="text-emerald-500" /> : <Circle size={16} />}
        </button>
        <div className="flex-1 min-w-0">
          <div className={`text-[13px] font-medium ${isCompleted ? "line-through text-slate-400" : "text-slate-800"}`}>{task.title}</div>
          {task.description && <div className="text-[11px] text-slate-400 mt-0.5 truncate">{task.description}</div>}
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <Badge meta={TASK_STATUS_META} value={task.status} />
            <Badge meta={PRIORITY_META} value={task.priority} />
            {task.dueDate && <span className="text-[10px] text-slate-400 flex items-center gap-0.5"><Clock size={10} />{task.dueDate}</span>}
            {task.assignedToName && <span className="text-[10px] text-slate-400">{task.assignedToName}</span>}
            {task.estimatedHours && <span className="text-[10px] text-slate-400">{task.estimatedHours}s</span>}
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          <button onClick={() => onEdit(task)} className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600"><Pencil size={12} /></button>
          <button onClick={() => onDelete(task)} className="p-1 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-500"><Trash2 size={12} /></button>
          <button onClick={() => setOpen((v) => !v)} className="p-1 rounded hover:bg-slate-100 text-slate-400">
            <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-3 pl-6 space-y-1">
          <select
            value={task.status}
            onChange={(e) => onStatusChange(task, e.target.value)}
            disabled={isSaving}
            className="text-[12px] border rounded px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
          >
            <option value="todo">Yapılacak</option>
            <option value="in-progress">Devam Ediyor</option>
            <option value="review">İncelemede</option>
            <option value="completed">Tamamlandı</option>
          </select>
        </div>
      )}
    </div>
  );
}

// ─── Detay Paneli ────────────────────────────────────────────────────────────

function DetailPanel({ planning, tasks, onAddTask, onEditTask, onDeleteTask, onStatusChange, savingTask }) {
  const stats = planning.taskStats || {};

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b space-y-3">
        <h2 className="text-[15px] font-semibold text-slate-800">{planning.title}</h2>
        {planning.description && <p className="text-[12px] text-slate-500">{planning.description}</p>}
        <div className="flex flex-wrap gap-1">
          <Badge meta={STATUS_META} value={planning.status} />
          <Badge meta={PRIORITY_META} value={planning.priority} />
        </div>
        {(planning.startDate || planning.endDate) && (
          <div className="text-[11px] text-slate-400 flex items-center gap-1">
            <Clock size={11} />{planning.startDate} → {planning.endDate}
          </div>
        )}
        <div className="space-y-1">
          <div className="flex justify-between text-[11px] text-slate-500">
            <span>{stats.total || 0} görev</span><span>{stats.progress || 0}%</span>
          </div>
          <ProgressBar value={stats.progress || 0} />
        </div>
      </div>

      <div className="flex items-center justify-between px-4 py-3 border-b">
        <span className="text-[13px] font-semibold text-slate-700">Görevler</span>
        <button onClick={onAddTask} className="flex items-center gap-1 text-[12px] px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700">
          <Plus size={12} /> Görev Ekle
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {tasks.length === 0
          ? <EmptyState message="Henüz görev yok" sub="Yukarıdan ekleyin" />
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

  // ── Veri yükleme ─────────────────────────────────────────────────────────

  const loadPlannings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getPlannings({ status: filters.status || undefined, priority: filters.priority || undefined });
      const list = res?.plannings || [];
      setPlannings(list);
      if (selected) {
        const refreshed = list.find((p) => p._id === selected._id);
        if (refreshed) setSelected(refreshed);
      }
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
      if (q && !p.title.toLowerCase().includes(q) && !(p.description || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [plannings, filters.search]);

  // ── Planlama CRUD ─────────────────────────────────────────────────────────

  const handleSavePlanning = async (form) => {
    setSaving(true);
    try {
      if (editingPlanning) {
        await updatePlanning(editingPlanning._id, form);
        toast.success("Planlama güncellendi");
      } else {
        await createPlanning(form);
        toast.success("Planlama oluşturuldu");
      }
      setShowPlanningModal(false);
      setEditingPlanning(null);
      loadPlannings();
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

      {/* Başlık + Araç çubuğu */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="font-semibold text-[15px] text-slate-800">Planlama Yönetimi</div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Görünüm seçici */}
          <div className="flex rounded-lg border overflow-hidden text-[12px]">
            {[["list","Liste",<LayoutList size={12}/>],["calendar","Takvim",<Calendar size={12}/>],["timeline","Timeline",<BarChart2 size={12}/>]].map(([v, l, icon]) => (
              <button key={v} onClick={() => setView(v)} className={`flex items-center gap-1 px-3 py-1.5 ${view === v ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}>{icon}{l}</button>
            ))}
          </div>

          {/* Filtreler */}
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="pl-7 pr-3 py-1.5 text-[12px] border rounded-lg w-40 focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="Ara..."
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            />
          </div>
          <select className="text-[12px] border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="">Tüm Durumlar</option>
            <option value="draft">Taslak</option>
            <option value="active">Aktif</option>
            <option value="completed">Tamamlandı</option>
            <option value="cancelled">İptal</option>
          </select>
          <select className="text-[12px] border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent" value={filters.priority} onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))}>
            <option value="">Tüm Öncelikler</option>
            <option value="low">Düşük</option>
            <option value="medium">Orta</option>
            <option value="high">Yüksek</option>
            <option value="critical">Kritik</option>
          </select>

          <button onClick={loadPlannings} disabled={loading} className="p-1.5 rounded-lg border hover:bg-slate-50 text-slate-500 disabled:opacity-40">
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => { setEditingPlanning(null); setShowPlanningModal(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-[12px] font-medium hover:bg-blue-700"
          >
            <Plus size={13} /> Planlama
          </button>
        </div>
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
            {!loading && filtered.length === 0 && (
              <EmptyState message="Planlama bulunamadı" sub='Sağ üstten "Planlama" ekleyin' />
            )}
            {filtered.map((p) => (
              <PlanningCard
                key={p._id}
                p={p}
                selected={selected?._id === p._id}
                onSelect={setSelected}
                onEdit={(pl) => { setEditingPlanning(pl); setShowPlanningModal(true); }}
                onDelete={handleDeletePlanning}
                deleting={deleting}
              />
            ))}
          </div>

          {/* Sağ: Detay + Görevler */}
          <div className="flex-1 rounded-2xl border bg-white shadow-sm min-h-0 overflow-hidden">
            {selected ? (
              <DetailPanel
                planning={selected}
                tasks={tasks}
                onAddTask={() => { setEditingTask(null); setShowTaskModal(true); }}
                onEditTask={(t) => { setEditingTask(t); setShowTaskModal(true); }}
                onDeleteTask={handleDeleteTask}
                onStatusChange={handleTaskStatusChange}
                savingTask={savingTask}
              />
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
            initial={editingPlanning ? { title: editingPlanning.title, description: editingPlanning.description || "", startDate: editingPlanning.startDate || "", endDate: editingPlanning.endDate || "", priority: editingPlanning.priority, status: editingPlanning.status } : null}
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
