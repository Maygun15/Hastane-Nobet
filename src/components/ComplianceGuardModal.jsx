// src/components/ComplianceGuardModal.jsx
// Pre-publish compliance soft-block modal
import React from "react";
import { AlertTriangle, XCircle, CheckCircle, ShieldAlert } from "lucide-react";

const RULE_LABELS = {
  WEEKLY_MAX_HOURS:    "Haftalık Saat Limiti",
  DAILY_MAX_HOURS:     "Günlük Saat Limiti",
  MIN_REST_BETWEEN:    "Vardiyalar Arası Dinlenme",
  MAX_CONSECUTIVE_DAYS:"Kesintisiz Çalışma",
  NIGHT_SHIFT_LIMIT:   "Gece Nöbeti Limiti",
};

const RULE_LAW = {
  WEEKLY_MAX_HOURS:    "İş Kanunu 63. Madde",
  DAILY_MAX_HOURS:     "İş Kanunu 63. Madde",
  MIN_REST_BETWEEN:    "İş Kanunu 68. Madde",
  MAX_CONSECUTIVE_DAYS:"İş Kanunu Genel İlke",
  NIGHT_SHIFT_LIMIT:   "Sağlık Bakanlığı Yönetmeliği",
};

function groupViolationsByPerson(violations) {
  const map = new Map();
  for (const v of violations || []) {
    const key = v.personId || v.personName;
    if (!map.has(key)) map.set(key, { personName: v.personName, errors: [], warnings: [] });
    const bucket = v.severity === "error" ? "errors" : "warnings";
    map.get(key)[bucket].push(v);
  }
  return [...map.values()].sort((a, b) => b.errors.length - a.errors.length);
}

export default function ComplianceGuardModal({ result, onProceed, onCancel, publishing }) {
  if (!result) return null;

  const { violations = [], summary = {}, hasCritical, hasWarning } = result;
  const grouped = groupViolationsByPerson(violations);

  const errorCount   = violations.filter((v) => v.severity === "error").length;
  const warningCount = violations.filter((v) => v.severity === "warning").length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className={`flex items-center gap-3 rounded-t-2xl px-5 py-4 ${hasCritical ? "bg-rose-50 border-b border-rose-200" : "bg-amber-50 border-b border-amber-200"}`}>
          <ShieldAlert className={`h-6 w-6 shrink-0 ${hasCritical ? "text-rose-600" : "text-amber-600"}`} />
          <div className="flex-1 min-w-0">
            <div className={`font-semibold text-[15px] ${hasCritical ? "text-rose-800" : "text-amber-800"}`}>
              Mevzuat Uyumluluk Uyarısı
            </div>
            <div className={`text-[12px] mt-0.5 ${hasCritical ? "text-rose-600" : "text-amber-600"}`}>
              {summary.peopleAffected ?? grouped.length} personelde {violations.length} ihlal tespit edildi
            </div>
          </div>
          <div className="flex gap-3 shrink-0">
            {errorCount > 0 && (
              <div className="flex items-center gap-1.5 rounded-full bg-rose-100 px-2.5 py-1">
                <XCircle className="h-3.5 w-3.5 text-rose-600" />
                <span className="text-[11px] font-semibold text-rose-700">{errorCount} Hata</span>
              </div>
            )}
            {warningCount > 0 && (
              <div className="flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                <span className="text-[11px] font-semibold text-amber-700">{warningCount} Uyarı</span>
              </div>
            )}
          </div>
        </div>

        {/* Mevzuat notu */}
        <div className="px-5 pt-3 pb-2">
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-[12px] text-slate-600">
            <strong className="text-slate-700">4857 Sayılı İş Kanunu</strong> kapsamında tespit edilen ihlaller.
            Çizelgeyi yayınlamak <strong>yasal yükümlülüğünüzü değiştirmez</strong> — devam etmek için onayla.
          </div>
        </div>

        {/* Violations listesi */}
        <div className="flex-1 overflow-y-auto px-5 pb-3 space-y-3">
          {grouped.map((person) => (
            <div key={person.personName} className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 border-b border-slate-200">
                <div className="text-[13px] font-medium text-slate-800">{person.personName}</div>
                {person.errors.length > 0 && (
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                    {person.errors.length} hata
                  </span>
                )}
                {person.warnings.length > 0 && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                    {person.warnings.length} uyarı
                  </span>
                )}
              </div>
              <div className="divide-y divide-slate-100">
                {[...person.errors, ...person.warnings].map((v, i) => (
                  <div key={i} className="flex items-start gap-2.5 px-3 py-2">
                    {v.severity === "error"
                      ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                      : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    }
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] text-slate-700">{v.label}</div>
                      <div className="mt-0.5 text-[10px] text-slate-400">
                        {RULE_LABELS[v.rule] || v.rule} — {RULE_LAW[v.rule] || ""}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-3 rounded-b-2xl border-t border-slate-200 bg-slate-50 px-5 py-4">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <CheckCircle className="h-3.5 w-3.5 text-slate-400" />
            Yayınladıktan sonra Uyumluluk Raporu kayıt altına alınır
          </div>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              disabled={publishing}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Geri Dön
            </button>
            <button
              onClick={onProceed}
              disabled={publishing}
              className="rounded-lg bg-rose-600 px-4 py-2 text-[13px] font-medium text-white hover:bg-rose-700 disabled:opacity-60"
            >
              {publishing ? "Yayınlanıyor…" : "Yine de Yayınla"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
