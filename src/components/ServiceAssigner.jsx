import React, { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import useUsersModel from "../hooks/useUsersModel.js";
import useServicesModel from "../hooks/useServicesModel.js";

export default function ServiceAssigner({ open = false, userId = null, onClose }) {
  // --- HOOKLAR (koşulsuz) ---
  const users = useUsersModel();
  const servicesModel = useServicesModel();

  const [serviceId, setServiceId] = useState("");
  const [mode, setMode] = useState("append"); // append | replace | remove
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const services = useMemo(() => servicesModel.list?.() ?? [], [servicesModel]);
  const targetUser = useMemo(() => (userId ? users.getById?.(userId) : null), [users, userId]);

  const firstServiceId = useMemo(
    () => (services.length ? services[0].id ?? services[0]._id ?? "" : ""),
    [services]
  );

  useEffect(() => {
    if (open) {
      setServiceId((prev) => prev || firstServiceId);
      setMode("append");
      setError("");
      setSubmitting(false);
    }
  }, [open, firstServiceId]);

  const canSubmit = useMemo(() => Boolean(open && userId && serviceId && !submitting), [open, userId, serviceId, submitting]);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      const current = users.getById(userId)?.serviceIds ?? [];
      const sId = serviceId;
      let next = current;
      if (mode === "append") next = current.includes(sId) ? current : [...current, sId];
      else if (mode === "replace") next = [sId];
      else if (mode === "remove") next = current.filter((x) => x !== sId);

      await users.setServices?.(userId, next);
      onClose?.();
    } catch (e) {
      setError(e?.message || "Atama sırasında bir hata oluştu.");
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, users, userId, serviceId, mode, onClose]);

  // --- RENDER ---
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Servis Ata</h2>
          <button type="button" onClick={onClose} className="p-2 rounded hover:bg-slate-100" aria-label="Kapat">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="text-sm text-slate-600 mb-4">
          Kullanıcı: <b>{targetUser?.name || targetUser?.email || userId || "-"}</b>
        </div>

        <label className="block text-sm font-medium mb-1">Servis</label>
        <select className="w-full rounded border p-2 mb-4" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
          {services.map((s) => (
            <option key={s.id ?? s._id} value={s.id ?? s._id}>
              {s.name ?? s.title ?? String(s.code || "")}
            </option>
          ))}
        </select>

        <label className="block text-sm font-medium mb-1">İşlem</label>
        <div className="flex gap-3 mb-4">
          {[
            { key: "append", label: "Ekle (üzerine)" },
            { key: "replace", label: "Değiştir (tek servis kalsın)" },
            { key: "remove", label: "Kaldır" },
          ].map((opt) => (
            <label key={opt.key} className="inline-flex items-center gap-2">
              <input type="radio" name="assign-mode" value={opt.key} checked={mode === opt.key} onChange={() => setMode(opt.key)} />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>

        {!!error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="flex justify-end gap-2">
          <button type="button" className="px-4 py-2 rounded border" onClick={onClose} disabled={submitting}>İptal</button>
          <button type="button" className="px-4 py-2 rounded bg-indigo-600 text-white disabled:opacity-60" onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? "Kaydediliyor…" : "Kaydet"}
          </button>
        </div>
      </div>
    </div>
  );
}
