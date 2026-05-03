import React, { useMemo } from "react";
import { X, Scale, AlertTriangle, CheckCircle, Info } from "lucide-react";

// Renk kodlamaları
const getScoreStatus = (score) => {
  if (score < 10) return { text: "Adil", color: "text-emerald-700 bg-emerald-100 border-emerald-200", icon: <CheckCircle className="w-4 h-4 text-emerald-600" /> };
  if (score < 30) return { text: "Kabul Edilebilir", color: "text-blue-700 bg-blue-100 border-blue-200", icon: <Info className="w-4 h-4 text-blue-600" /> };
  if (score < 60) return { text: "Dengesiz", color: "text-amber-700 bg-amber-100 border-amber-200", icon: <AlertTriangle className="w-4 h-4 text-amber-600" /> };
  return { text: "Kritik", color: "text-rose-700 bg-rose-100 border-rose-200", icon: <AlertTriangle className="w-4 h-4 text-rose-600" /> };
};

export default function JusticeAnalyzerModal({ isOpen, onClose, assignments, people, year, month, requiredHoursPerPerson }) {
  const analysis = useMemo(() => {
    if (!assignments || !people) return [];

    const personStats = new Map();

    // Initialize stats
    people.forEach(p => {
      personStats.set(String(p.id), {
        id: p.id,
        name: p.fullName || p.name,
        hours: 0,
        weekendShifts: 0,
        consecutivePenalties: 0,
        assignments: []
      });
    });

    // Process assignments
    assignments.forEach(a => {
      const pid = String(a.personId);
      if (!personStats.has(pid)) return;
      const stats = personStats.get(pid);

      stats.hours += Number.isFinite(Number(a.hours)) ? Number(a.hours) : 0;
      stats.assignments.push(a);

      const d = new Date(a.day || a.date);
      const wd = d.getDay();
      if (wd === 0 || wd === 6) stats.weekendShifts++;
    });

    // Calculate penalties
    const results = Array.from(personStats.values()).map(stats => {
      const targetHours = requiredHoursPerPerson || 160; // Varsayılan hedef saat
      const hourDiff = Math.abs(stats.hours - targetHours);
      
      // Saat Sapması: Her 8 saat fark için 10 ceza puanı
      const hourPenalty = Math.round((hourDiff / 8) * 10);
      
      // Hafta sonu yükü: 2 nöbetten fazla ise ceza
      const weekendPenalty = Math.max(0, stats.weekendShifts - 2) * 15;

      // Toplam Ceza Puanı
      const totalScore = hourPenalty + weekendPenalty + stats.consecutivePenalties;

      return {
        ...stats,
        targetHours,
        hourDiff,
        hourPenalty,
        weekendPenalty,
        totalScore,
        status: getScoreStatus(totalScore)
      };
    });

    // En kötü durumdakiler en üstte
    return results.sort((a, b) => b.totalScore - a.totalScore);

  }, [assignments, people, requiredHoursPerPerson]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 rounded-lg text-indigo-600">
              <Scale className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800 leading-tight">Adalet Puanı Analizi</h2>
              <p className="text-sm text-slate-500">Personel nöbet dağılımındaki eşitsizlikleri (Ceza Puanı) analiz eder.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6 bg-white">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="p-4 rounded-xl border border-slate-100 bg-slate-50">
              <div className="text-sm text-slate-500 font-medium mb-1">Saat Sapması</div>
              <div className="text-xs text-slate-400">Hedef saate ( {requiredHoursPerPerson || 160}s ) olan uzaklık x 1.2</div>
            </div>
            <div className="p-4 rounded-xl border border-slate-100 bg-slate-50">
              <div className="text-sm text-slate-500 font-medium mb-1">Hafta Sonu Yükü</div>
              <div className="text-xs text-slate-400">Aylık 2 hafta sonu nöbetinden fazlası +15 Puan</div>
            </div>
            <div className="p-4 rounded-xl border border-slate-100 bg-slate-50">
              <div className="text-sm text-slate-500 font-medium mb-1">Toplam Eşitsizlik Puanı</div>
              <div className="text-xs text-slate-400">Puan ne kadar yüksekse sistem o kadar adaletsizdir.</div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 font-semibold">
                  <th className="p-3">Personel</th>
                  <th className="p-3 text-center">Çalışma (Saat)</th>
                  <th className="p-3 text-center">Sapma (C.P)</th>
                  <th className="p-3 text-center">H.Sonu Yükü (C.P)</th>
                  <th className="p-3 text-center">Eşitsizlik Puanı</th>
                  <th className="p-3">Durum</th>
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-slate-100">
                {analysis.map((row, idx) => (
                  <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3 font-medium text-slate-800">
                      {idx + 1}. {row.name}
                    </td>
                    <td className="p-3 text-center">
                      <span className="font-semibold">{row.hours}</span> / {row.targetHours}
                    </td>
                    <td className="p-3 text-center text-rose-600 font-medium">
                      +{row.hourPenalty}
                    </td>
                    <td className="p-3 text-center text-rose-600 font-medium">
                      {row.weekendPenalty > 0 ? `+${row.weekendPenalty}` : '-'}
                    </td>
                    <td className="p-3 text-center">
                      <span className="text-lg font-bold text-slate-700">{row.totalScore}</span>
                    </td>
                    <td className="p-3">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${row.status.color}`}>
                        {row.status.icon}
                        {row.status.text}
                      </span>
                    </td>
                  </tr>
                ))}
                {analysis.length === 0 && (
                  <tr>
                    <td colSpan="6" className="p-8 text-center text-slate-500">Analiz edilecek atama bulunamadı.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}
