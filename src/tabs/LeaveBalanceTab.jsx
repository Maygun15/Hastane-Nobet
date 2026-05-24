// src/tabs/LeaveBalanceTab.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MoreVertical } from "lucide-react";
import { toast } from "sonner";
import {
  getLeaveBalances,
  createLeaveBalance,
  updateLeaveBalance,
  deleteLeaveBalance,
} from "../api/apiAdapter.js";
import { setLeaveWithCheck } from "../lib/leaves.js";

function getLeaveCode(item) {
  try {
    const raw = localStorage.getItem("leaveTypesV2");
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        const found = list.find((lt) => String(lt._id || lt.id || "") === String(item.leaveTypeId));
        if (found?.code || found?.kisaltma) return (found.code || found.kisaltma).trim().toUpperCase();
      }
    }
  } catch {}
  return (item.leaveTypeName || "").trim().toUpperCase();
}

const THIS_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => THIS_YEAR - 2 + i);

function Badge({ children, variant = "default" }) {
  const cls =
    variant === "danger"
      ? "bg-red-100 text-red-700 border border-red-200"
      : variant === "warning"
      ? "bg-amber-100 text-amber-700 border border-amber-200"
      : variant === "success"
      ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
      : "bg-slate-100 text-slate-600 border border-slate-200";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {children}
    </span>
  );
}

function Modal({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

export default function LeaveBalanceTab() {
  const [year, setYear] = useState(THIS_YEAR);
  const [serviceFilter, setServiceFilter] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  const menuRef = useRef(null);

  // Edit modal state
  const [editItem, setEditItem] = useState(null);
  const [editAllocated, setEditAllocated] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // "İzin Kullan" modal state
  const [useItem, setUseItem] = useState(null);
  const [useDays, setUseDays] = useState("");
  const [useStartDate, setUseStartDate] = useState("");
  const [useSaving, setUseSaving] = useState(false);
  const [useConflict, setUseConflict] = useState(null); // { detail, dates, code }

  const insufficientError = useMemo(() => {
    if (!useItem || useDays === "") return null;
    const days = Number(useDays);
    if (!Number.isFinite(days) || days <= 0) return "Gün sayısı sıfırdan büyük olmalıdır";
    if (useItem.remaining <= 0) return `İzin Yetersiz — ${useItem.personName || "Personel"} adına kullanılabilir bakiye bulunmuyor (Kalan: 0 gün)`;
    if (days > useItem.remaining) return `İzin Yetersiz — ${days} gün talep edildi, yalnızca ${useItem.remaining} gün mevcut`;
    return null;
  }, [useItem, useDays]);

  const openUse = (item) => { setUseItem(item); setUseDays(""); setUseStartDate(""); setUseConflict(null); };
  const closeUse = () => { setUseItem(null); setUseDays(""); setUseStartDate(""); setUseConflict(null); };

  const buildDates = (startDateStr, days) => {
    const dates = [];
    const start = new Date(`${startDateStr}T00:00:00`);
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      dates.push({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() });
    }
    return dates;
  };

  const saveLeaveDays = async ({ dates, code, force }) => {
    if (!useItem) return;
    const personId = String(useItem.personId || "").trim();
    const personName = String(useItem.personName || "").trim();
    for (const { year, month, day } of dates) {
      await setLeaveWithCheck({ personId, personName, year, month, day, code, force });
    }
  };

  const handleUse = async () => {
    if (!useItem) return;
    if (insufficientError) { toast.error(insufficientError); return; }
    if (!useStartDate) { toast.error("Başlangıç tarihi seçiniz"); return; }
    const days = Number(useDays);
    const code = getLeaveCode(useItem);
    if (!code) { toast.error("İzin türü kodu bulunamadı"); return; }
    const dates = buildDates(useStartDate, days);
    setUseSaving(true);
    setUseConflict(null);
    try {
      await saveLeaveDays({ dates, code, force: false });
      toast.success(`${days} gün izin kaydedildi`);
      closeUse();
      await load();
    } catch (err) {
      if (err?.status === 409 && err?.data?.conflict) {
        setUseConflict({ detail: err.data.detail || err.data.error || "Nöbet çakışması tespit edildi.", dates, code });
      } else {
        toast.error(err?.message || "İzin kaydı başarısız");
      }
    } finally {
      setUseSaving(false);
    }
  };

  const handleUseForce = async () => {
    if (!useConflict || !useItem) return;
    setUseSaving(true);
    try {
      await saveLeaveDays({ dates: useConflict.dates, code: useConflict.code, force: true });
      toast.success(`${useConflict.dates.length} gün izin kaydedildi`);
      closeUse();
      await load();
    } catch (err) {
      toast.error(err?.message || "İzin kaydı başarısız");
    } finally {
      setUseSaving(false);
    }
  };

  // Create modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    personId: "",
    personName: "",
    leaveTypeId: "",
    leaveTypeName: "",
    allocated: "",
  });
  const [createSaving, setCreateSaving] = useState(false);

  useEffect(() => {
    if (!openMenuId) return;
    function handleOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpenMenuId(null);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [openMenuId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getLeaveBalances({ year });
      const data = Array.isArray(res?.items) ? res.items : Array.isArray(res) ? res : [];
      setItems(data);
    } catch (err) {
      toast.error(err?.message || "Bakiyeler yüklenemedi");
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    load();
  }, [load]);

  // Filtered list
  const filtered = items.filter((item) => {
    if (!serviceFilter.trim()) return true;
    const needle = serviceFilter.trim().toLowerCase();
    return (
      (item.personName || "").toLowerCase().includes(needle) ||
      (item.leaveTypeName || "").toLowerCase().includes(needle)
    );
  });

  // Edit handlers
  const openEdit = (item) => {
    setEditItem(item);
    setEditAllocated(String(item.allocated ?? 0));
  };

  const closeEdit = () => {
    setEditItem(null);
    setEditAllocated("");
  };

  const handleEditSave = async () => {
    if (!editItem) return;
    const alloc = Number(editAllocated);
    if (!Number.isFinite(alloc) || alloc < 0) {
      toast.error("Hak edilen gün geçerli bir sayı olmalıdır");
      return;
    }
    setEditSaving(true);
    try {
      await updateLeaveBalance(editItem._id, { allocated: alloc });
      toast.success("Bakiye güncellendi");
      closeEdit();
      await load();
    } catch (err) {
      toast.error(err?.message || "Güncelleme başarısız");
    } finally {
      setEditSaving(false);
    }
  };

  // Delete handler
  const handleDelete = async (item) => {
    if (!window.confirm(`"${item.personName} – ${item.leaveTypeName}" bakiyesini silmek istediğinize emin misiniz?`)) return;
    try {
      await deleteLeaveBalance(item._id);
      toast.success("Bakiye silindi");
      await load();
    } catch (err) {
      toast.error(err?.message || "Silme başarısız");
    }
  };

  // Create handlers
  const openCreate = () => {
    setForm({ personId: "", personName: "", leaveTypeId: "", leaveTypeName: "", allocated: "" });
    setCreateOpen(true);
  };

  const handleCreateSave = async () => {
    const { personId, personName, leaveTypeId, leaveTypeName, allocated } = form;
    if (!personId.trim() || !leaveTypeId.trim()) {
      toast.error("Personel ID ve İzin Türü ID zorunludur");
      return;
    }
    const alloc = Number(allocated);
    if (!Number.isFinite(alloc) || alloc < 0) {
      toast.error("Hak edilen gün geçerli bir sayı olmalıdır");
      return;
    }
    setCreateSaving(true);
    try {
      await createLeaveBalance({
        personId: personId.trim(),
        personName: personName.trim(),
        leaveTypeId: leaveTypeId.trim(),
        leaveTypeName: leaveTypeName.trim(),
        year,
        allocated: alloc,
      });
      toast.success("Bakiye oluşturuldu");
      setCreateOpen(false);
      await load();
    } catch (err) {
      toast.error(err?.message || "Oluşturma başarısız");
    } finally {
      setCreateSaving(false);
    }
  };

  const inputCls =
    "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100";

  const totalDeficit = filtered.filter((i) => i.remaining < 0).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_10px_28px_-20px_rgba(15,23,42,0.15)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Yönetim</div>
            <div className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
              İzin Bakiyesi
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Personel başına izin hakkı, kullanım ve kalan gün takibi
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Year selector */}
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-400"
            >
              {YEARS.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>

            {/* Service/name filter */}
            <input
              type="text"
              placeholder="Personel veya izin türü ara..."
              value={serviceFilter}
              onChange={(e) => setServiceFilter(e.target.value)}
              className="h-9 w-56 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none placeholder:text-slate-400 focus:border-slate-400"
            />

            <button
              type="button"
              onClick={openCreate}
              className="inline-flex h-9 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 transition-colors shadow-sm"
            >
              + Yeni Bakiye
            </button>

            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-60"
            >
              {loading ? "Yükleniyor..." : "Yenile"}
            </button>
          </div>
        </div>

        {totalDeficit > 0 && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 5v3.5M8 11h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <strong>{totalDeficit}</strong> personelde izin bakiyesi yetersiz (kalan &lt; 0)
          </div>
        )}
      </div>

      {/* Table */}
      <div className="rounded-[24px] border border-slate-200 bg-white shadow-[0_10px_28px_-20px_rgba(15,23,42,0.15)] overflow-hidden">
        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-slate-400 text-sm">
            Yükleniyor...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <div className="text-slate-400 text-sm">Kayıt bulunamadı</div>
            <div className="text-slate-400 text-xs">
              {serviceFilter ? "Filtreyi temizleyerek tekrar deneyin" : `${year} yılı için henüz bakiye eklenmemiş`}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/80">
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Ad Soyad
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Personel ID
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    İzin Türü
                  </th>
                  <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Hak Edilen
                  </th>
                  <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Kullanılan
                  </th>
                  <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Kalan
                  </th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    İşlemler
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item, idx) => {
                  const isDeficit = item.remaining < 0;
                  return (
                    <tr
                      key={item._id || idx}
                      className={`border-b border-slate-50 transition-colors hover:bg-slate-50/60 ${
                        isDeficit ? "bg-red-50/40" : ""
                      }`}
                    >
                      <td className="px-4 py-3 font-medium text-slate-800">
                        {item.personName || <span className="text-slate-400 italic">—</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-500 font-mono text-xs">
                        {item.personId}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {item.leaveTypeName || item.leaveTypeId}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge variant="default">{item.allocated} gün</Badge>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge variant={item.used > 0 ? "warning" : "default"}>{item.used} gün</Badge>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge variant={isDeficit ? "danger" : item.remaining === 0 ? "warning" : "success"}>
                          {item.remaining} gün
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="relative inline-block" ref={openMenuId === item._id ? menuRef : null}>
                          <button
                            type="button"
                            onClick={() => setOpenMenuId(openMenuId === item._id ? null : item._id)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                          {openMenuId === item._id && (
                            <div className="absolute right-0 top-9 z-20 min-w-[150px] rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                              <button
                                type="button"
                                onClick={() => { openUse(item); setOpenMenuId(null); }}
                                className="flex w-full items-center gap-2.5 px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50"
                              >
                                <span className={`h-2 w-2 rounded-full ${item.remaining <= 0 ? "bg-amber-400" : "bg-emerald-400"}`} />
                                İzin Kullan
                              </button>
                              <button
                                type="button"
                                onClick={() => { openEdit(item); setOpenMenuId(null); }}
                                className="flex w-full items-center gap-2.5 px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50"
                              >
                                <span className="h-2 w-2 rounded-full bg-blue-400" />
                                Düzenle
                              </button>
                              <div className="my-1 border-t border-slate-100" />
                              <button
                                type="button"
                                onClick={() => { handleDelete(item); setOpenMenuId(null); }}
                                className="flex w-full items-center gap-2.5 px-3 py-2 text-[13px] text-red-600 hover:bg-red-50"
                              >
                                <span className="h-2 w-2 rounded-full bg-red-400" />
                                Sil
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer summary */}
        {filtered.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
            <span>{filtered.length} kayıt gösteriliyor</span>
            <div className="flex gap-3">
              <span>
                Toplam hak edilen:{" "}
                <strong className="text-slate-700">
                  {filtered.reduce((s, i) => s + (i.allocated || 0), 0)} gün
                </strong>
              </span>
              <span>
                Toplam kullanılan:{" "}
                <strong className="text-slate-700">
                  {filtered.reduce((s, i) => s + (i.used || 0), 0)} gün
                </strong>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Edit Modal */}
      <Modal open={!!editItem} onClose={closeEdit} title="Bakiye Düzenle">
        {editItem && (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm text-slate-600 space-y-1">
              <div>
                <span className="font-medium text-slate-800">{editItem.personName || editItem.personId}</span>
              </div>
              <div>İzin Türü: <span className="font-medium">{editItem.leaveTypeName || editItem.leaveTypeId}</span></div>
              <div>Yıl: <span className="font-medium">{editItem.year}</span></div>
              <div>Kullanılan: <span className="font-medium">{editItem.used} gün</span></div>
            </div>

            <div>
              <label className="block text-[12px] font-semibold text-slate-600 mb-1.5">
                Hak Edilen Gün
              </label>
              <input
                type="number"
                min="0"
                value={editAllocated}
                onChange={(e) => setEditAllocated(e.target.value)}
                className={inputCls}
                placeholder="Örn: 14"
              />
            </div>

            {editAllocated !== "" && (
              <div className="text-xs text-slate-500">
                Yeni kalan:{" "}
                <strong className={Number(editAllocated) - editItem.used < 0 ? "text-red-600" : "text-emerald-600"}>
                  {Number(editAllocated) - editItem.used} gün
                </strong>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={closeEdit}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={handleEditSave}
                disabled={editSaving}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {editSaving ? "Kaydediliyor..." : "Kaydet"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Create Modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Yeni İzin Bakiyesi">
        <div className="space-y-3">
          <div>
            <label className="block text-[12px] font-semibold text-slate-600 mb-1">
              Personel ID <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              placeholder="Personel ID"
              value={form.personId}
              onChange={(e) => setForm((f) => ({ ...f, personId: e.target.value }))}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-slate-600 mb-1">
              Ad Soyad
            </label>
            <input
              type="text"
              placeholder="Ad Soyad (gösterim için)"
              value={form.personName}
              onChange={(e) => setForm((f) => ({ ...f, personName: e.target.value }))}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-slate-600 mb-1">
              İzin Türü ID <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              placeholder="İzin türü ID (örn: annual)"
              value={form.leaveTypeId}
              onChange={(e) => setForm((f) => ({ ...f, leaveTypeId: e.target.value }))}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-slate-600 mb-1">
              İzin Türü Adı
            </label>
            <input
              type="text"
              placeholder="Yıllık İzin, Mazeret İzni..."
              value={form.leaveTypeName}
              onChange={(e) => setForm((f) => ({ ...f, leaveTypeName: e.target.value }))}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-slate-600 mb-1">
              Hak Edilen Gün <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              min="0"
              placeholder="Örn: 14"
              value={form.allocated}
              onChange={(e) => setForm((f) => ({ ...f, allocated: e.target.value }))}
              className={inputCls}
            />
          </div>
          <div className="text-xs text-slate-500">
            Yıl: <strong>{year}</strong>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Vazgeç
            </button>
            <button
              type="button"
              onClick={handleCreateSave}
              disabled={createSaving}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {createSaving ? "Oluşturuluyor..." : "Oluştur"}
            </button>
          </div>
        </div>
      </Modal>

      {/* İzin Kullan Modal */}
      <Modal open={!!useItem} onClose={closeUse} title="İzin Günü Kullan">
        {useItem && (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm text-slate-600 space-y-1">
              <div>
                <span className="font-medium text-slate-800">{useItem.personName || useItem.personId}</span>
              </div>
              <div>İzin Türü: <span className="font-medium">{useItem.leaveTypeName || useItem.leaveTypeId}</span></div>
              <div className="flex gap-4">
                <span>Hak Edilen: <strong>{useItem.allocated} gün</strong></span>
                <span>Kullanılan: <strong>{useItem.used} gün</strong></span>
                <span className={useItem.remaining <= 0 ? "text-red-600 font-semibold" : "text-emerald-600 font-semibold"}>
                  Kalan: <strong>{useItem.remaining} gün</strong>
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[12px] font-semibold text-slate-600 mb-1.5">
                  Başlangıç Tarihi
                </label>
                <input
                  type="date"
                  value={useStartDate}
                  onChange={(e) => { setUseStartDate(e.target.value); setUseConflict(null); }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
                />
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-slate-600 mb-1.5">
                  Gün Sayısı
                </label>
                <input
                  type="number"
                  min="1"
                  max={useItem.allocated}
                  value={useDays}
                  onChange={(e) => { setUseDays(e.target.value); setUseConflict(null); }}
                  placeholder="Örn: 3"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
                />
              </div>
            </div>

            {/* Validation feedback */}
            {insufficientError ? (
              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M8 5v3.5M8 11h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <span>{insufficientError}</span>
              </div>
            ) : useStartDate && useDays !== "" && Number(useDays) > 0 ? (
              <div className="text-xs text-slate-500">
                İşlem sonrası kalan:{" "}
                <strong className="text-emerald-600">
                  {useItem.remaining - Number(useDays)} gün
                </strong>
              </div>
            ) : null}

            {/* Nöbet çakışma uyarısı */}
            {useConflict && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
                <p className="text-sm font-medium text-amber-800">Bu tarihte aktif nöbet mevcut</p>
                <p className="text-xs text-amber-700">{useConflict.detail}</p>
                <button
                  type="button"
                  onClick={handleUseForce}
                  disabled={useSaving}
                  className="w-full rounded-lg bg-amber-600 px-3 py-2 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-60 transition-colors"
                >
                  {useSaving ? "Kaydediliyor…" : "Nöbeti Yoksay ve Tümünü Kaydet"}
                </button>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button type="button" onClick={closeUse}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Vazgeç
              </button>
              <button
                type="button"
                onClick={handleUse}
                disabled={useSaving || !!insufficientError || useDays === "" || !useStartDate}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {useSaving ? "Kaydediliyor..." : "İzni Kaydet"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
