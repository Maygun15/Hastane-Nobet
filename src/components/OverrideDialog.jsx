// src/components/OverrideDialog.jsx
// Kural ihlali tespit edildiğinde "neden girerek kaydet" akışı.
// force:true + overrideReason backend'e gönderilir.
import React, { useState } from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";

export default function OverrideDialog({ open, errors = [], onConfirm, onCancel, title = "Kural İhlali" }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const handleConfirm = async () => {
    if (!reason.trim()) return;
    setBusy(true);
    try { await onConfirm(reason.trim()); }
    finally { setBusy(false); }
  };

  const handleCancel = () => {
    setReason("");
    onCancel();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center gap-2 bg-amber-50 border-b border-amber-200 px-5 py-4">
          <AlertTriangle className="text-amber-500 shrink-0" size={20} />
          <h2 className="font-semibold text-amber-800 text-sm">{title}</h2>
        </div>

        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-slate-600">
            Bu atama aşağıdaki kurallara aykırı. Neden girip yine de kaydedebilirsiniz:
          </p>
          <ul className="space-y-1">
            {errors.map((e, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                <span className="mt-0.5 shrink-0">⚠</span>
                <span>{e}</span>
              </li>
            ))}
          </ul>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Geçersiz kılma nedeni <span className="text-red-500">*</span>
            </label>
            <textarea
              rows={3}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300 resize-none"
              placeholder="Örn: Acil servis personel eksikliği nedeniyle yönetici onayıyla atandı."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              autoFocus
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 bg-slate-50 border-t border-slate-100">
          <button
            className="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-200 transition-colors"
            onClick={handleCancel}
            disabled={busy}
          >
            İptal
          </button>
          <button
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
            onClick={handleConfirm}
            disabled={busy || !reason.trim()}
          >
            <ShieldCheck size={15} />
            Yine de kaydet
          </button>
        </div>
      </div>
    </div>
  );
}
