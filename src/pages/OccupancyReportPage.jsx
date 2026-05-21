// src/pages/OccupancyReportPage.jsx
import React, { useState } from "react";
import { toast } from "sonner";
import { BarChart2, RefreshCw, Calendar } from "lucide-react";
import { http } from "../lib/api.js";

export default function OccupancyReportPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await http.get(
        `/api/reports/occupancy?year=${year}&month=${month}`
      );
      setResult(data);
    } catch (err) {
      toast.error(err?.message || "Rapor yüklenemedi");
    } finally {
      setLoading(false);
    }
  };

  const rows = result?.data || [];
  const maxAssignments = rows.length > 0 ? Math.max(...rows.map((r) => r.totalAssignments || 0)) : 1;

  const monthNames = [
    "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
    "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
  ];

  return (
    <div className="space-y-5">
      {/* Header card */}
      <div className="rounded-[26px] border border-slate-200 bg-slate-50/80 p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
            <BarChart2 className="h-3.5 w-3.5 text-sky-700" />
            Raporlama
          </span>
        </div>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Servis Doluluk Oranı</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600 max-w-2xl">
          Seçili ay için servis bazında toplam atama, benzersiz personel, toplam saat ve vardiya sayısı istatistiklerini görüntüleyin.
        </p>
      </div>

      {/* Filters */}
      <div className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Yıl</label>
            <input
              type="number"
              min="2020"
              max="2099"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="w-28 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Ay</label>
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="w-36 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
            >
              {monthNames.map((name, i) => (
                <option key={i + 1} value={i + 1}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-700 disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Yükleniyor..." : "Yükle"}
          </button>
        </div>
      </div>

      {/* Results */}
      {result && (
        <div className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm space-y-5">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <Calendar className="h-4 w-4 text-slate-500" />
            <span className="text-sm font-semibold text-slate-800">
              {monthNames[result.month - 1]} {result.year} — {rows.length} servis
            </span>
          </div>

          {rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <BarChart2 className="h-10 w-10 mb-3 opacity-30" />
              <div className="text-sm">Bu ay için atama verisi bulunamadı</div>
            </div>
          ) : (
            <>
              {/* Bar chart */}
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Atama Dağılımı</div>
                {rows.map((row, i) => {
                  const pct = maxAssignments > 0
                    ? Math.round((row.totalAssignments / maxAssignments) * 100)
                    : 0;
                  return (
                    <div key={row._id || i} className="flex items-center gap-3">
                      <div className="w-32 shrink-0 truncate text-xs text-slate-600 font-medium text-right">
                        {row.serviceId || "(boş)"}
                      </div>
                      <div className="flex-1 rounded-full bg-slate-100 h-5 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-sky-500 transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="w-10 shrink-0 text-xs text-slate-600 tabular-nums text-right">
                        {row.totalAssignments}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Table */}
              <div className="rounded-xl border border-slate-200 overflow-hidden mt-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Servis ID</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Toplam Atama</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Benzersiz Personel</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Toplam Saat</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Vardiya Sayısı</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((row, i) => (
                      <tr key={row._id || i} className="hover:bg-slate-50 transition">
                        <td className="px-4 py-2.5 font-medium text-slate-800">{row.serviceId || "(boş)"}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{row.totalAssignments}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{row.uniquePersonCount}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{row.totalHours}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{row.shiftCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
