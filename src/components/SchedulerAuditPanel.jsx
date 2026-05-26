// src/components/SchedulerAuditPanel.jsx
import React, { useState } from "react";
import { ChevronDown, ChevronRight, AlertTriangle, Info } from "lucide-react";

const FILTER_REASON_LABELS = {
  "izin": "Personel izinli",
  "24h-ban": "Önceki uzun/gece vardiyası sonrası dinlenme kuralı",
  "alan-uyumsuz": "Çalışma alanı uyumsuz",
  "N-gap": "Nöbet aralığı kuralı",
  "kota-doldu": "Aylık kota doldu",
  "hafta-sonu-kota": "Haftalık saat limiti",
};

function translateReason(reason) {
  const raw = String(reason || "").trim();
  return FILTER_REASON_LABELS[raw] || raw;
}

function CollapsibleSection({ title, badge, badgeColor = "bg-slate-100 text-slate-600", defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 hover:bg-slate-100 transition text-left"
      >
        <span className="text-sm font-medium text-slate-700 flex items-center gap-2">
          {title}
          {badge !== undefined && (
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${badgeColor}`}>
              {badge}
            </span>
          )}
        </span>
        {open ? (
          <ChevronDown className="h-4 w-4 text-slate-400" />
        ) : (
          <ChevronRight className="h-4 w-4 text-slate-400" />
        )}
      </button>
      {open && <div className="divide-y divide-slate-100">{children}</div>}
    </div>
  );
}

function StatCard({ label, value, accent = "text-slate-800" }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-center">
      <div className={`text-2xl font-bold tabular-nums ${accent}`}>{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}

export default function SchedulerAuditPanel({ issues, overrides, totalDays }) {
  const safeIssues = Array.isArray(issues) ? issues : [];
  const safeOverrides = Array.isArray(overrides) ? overrides : [];
  const safeTotalDays = Number(totalDays) > 0 ? Number(totalDays) : 30;

  if (safeIssues.length === 0 && safeOverrides.length === 0) return null;

  const missingSlots = safeIssues.reduce((sum, x) => {
    const miss = Math.max(0, (Number(x.need) || 0) - (Number(x.assigned) || 0));
    return sum + miss;
  }, 0);
  const problemDays = new Set(safeIssues.map((x) => x.day)).size;
  const totalSlots = safeIssues.reduce((sum, x) => sum + (Number(x.need) || 0), 0);
  const filledSlots = safeIssues.reduce((sum, x) => sum + (Number(x.assigned) || 0), 0);
  const fillRate =
    totalSlots > 0 ? Math.round((filledSlots / totalSlots) * 100) : 100;

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 bg-white flex items-start gap-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-100">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-800">Çizelge Denetim Raporu</div>
          <div className="text-xs text-slate-500 mt-0.5">
            Plan oluşturulurken doldurulamayan veya kurallara takılan alanlar
          </div>
        </div>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-4 py-3 bg-white border-b border-slate-200">
        <StatCard
          label="Eksik Atama"
          value={missingSlots}
          accent={missingSlots > 0 ? "text-red-600" : "text-slate-800"}
        />
        <StatCard
          label="Sorunlu Gün/Slot"
          value={`${problemDays} gün / ${safeIssues.length} slot`}
          accent={safeIssues.length > 0 ? "text-amber-700" : "text-slate-800"}
        />
        <StatCard
          label="Override Sayısı"
          value={safeOverrides.length}
          accent={safeOverrides.length > 0 ? "text-sky-700" : "text-slate-800"}
        />
        <StatCard
          label="Doluluk Oranı"
          value={`%${fillRate}`}
          accent={fillRate < 90 ? "text-red-600" : fillRate < 100 ? "text-amber-700" : "text-emerald-700"}
        />
      </div>

      {/* Issues list */}
      <div className="p-3 space-y-2">
        {safeIssues.length > 0 && (
          <CollapsibleSection
            title="Doldurulamayan Slotlar"
            badge={safeIssues.length}
            badgeColor="bg-amber-100 text-amber-800"
            defaultOpen
          >
            <div className="max-h-64 overflow-auto divide-y divide-slate-100">
              {safeIssues.map((issue, i) => {
                const missing = Math.max(0, (Number(issue.need) || 0) - (Number(issue.assigned) || 0));
                const audits = Array.isArray(issue.filterAudit) ? issue.filterAudit : [];
                return (
                  <div key={i} className="px-4 py-2.5">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                      <span className="text-xs font-semibold text-slate-500 tabular-nums w-12 shrink-0">
                        Gün {issue.day}
                      </span>
                      <span className="text-sm font-medium text-slate-800 flex-1 min-w-0 truncate">
                        {issue.label || "—"}
                      </span>
                      <span className="text-xs text-slate-500 tabular-nums shrink-0">
                        Gerek: <b>{issue.need ?? "?"}</b> / Atanan: <b>{issue.assigned ?? "?"}</b>
                        {missing > 0 && (
                          <span className="ml-1 text-red-600 font-semibold">(-{missing} eksik)</span>
                        )}
                      </span>
                    </div>
                    {audits.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1 pl-12">
                        {audits.map((a, j) => (
                          <span
                            key={j}
                            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600"
                            title={`${a.name}: ${translateReason(a.reason)}`}
                          >
                            <Info className="h-3 w-3 text-slate-400 shrink-0" />
                            <span className="font-medium">{a.name}</span>
                            <span className="text-slate-400">—</span>
                            <span>{translateReason(a.reason)}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CollapsibleSection>
        )}

        {/* Overrides list */}
        {safeOverrides.length > 0 && (
          <CollapsibleSection
            title="Kural Esnetimleri (Override)"
            badge={safeOverrides.length}
            badgeColor="bg-sky-100 text-sky-800"
            defaultOpen={safeOverrides.length <= 10}
          >
            <div className="max-h-48 overflow-auto divide-y divide-slate-100">
              {safeOverrides.map((ov, i) => (
                <div key={i} className="px-4 py-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="text-xs font-semibold text-slate-500 tabular-nums w-12 shrink-0">
                    Gün {ov.day}
                  </span>
                  <span className="text-sm text-slate-700 flex-1 min-w-0">
                    {ov.roleLabel || ov.shiftCode
                      ? `${ov.roleLabel || ""}${ov.roleLabel && ov.shiftCode ? " · " : ""}${ov.shiftCode || ""}`
                      : "—"}
                  </span>
                  <span className="text-xs text-sky-700 shrink-0 font-medium">
                    {translateReason(ov.reason) || ov.reason || "—"}
                  </span>
                  {ov.personId && (
                    <span className="text-xs text-slate-400 tabular-nums shrink-0">
                      {String(ov.personId).slice(-6)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}
      </div>
    </div>
  );
}
