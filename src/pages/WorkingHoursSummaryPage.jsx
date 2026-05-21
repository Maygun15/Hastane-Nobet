// src/pages/WorkingHoursSummaryPage.jsx
import React, { useState, useCallback, useEffect } from 'react';
import { RefreshCw, Download, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { http } from '../lib/api.js';
import * as XLSX from 'xlsx';

const MONTHS_TR = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];

export default function WorkingHoursSummaryPage() {
  const now = new Date();
  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData]   = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await http.get(`/api/reports/monthly-hours?year=${year}&month=${month}`);
      setData(Array.isArray(res?.data) ? res.data : []);
    } catch (e) {
      toast.error(e?.message || 'Veri yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  const exportExcel = () => {
    if (!data.length) return;
    const rows = data.map(d => ({
      'Ad Soyad':       d.personName || d._id || '—',
      'Servis':         d.serviceId || '—',
      'Toplam Atama':   d.totalAssignments || 0,
      'Toplam Saat':    d.totalHours || 0,
      'Gece Vardiyası': d.nightShifts || 0,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Çalışma Saatleri');
    XLSX.writeFile(wb, `calisma-saatleri-${year}-${String(month).padStart(2,'0')}.xlsx`);
  };

  const maxHours = Math.max(...data.map(d => d.totalHours || 0), 1);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-bold text-slate-800 flex items-center gap-2">
            <Clock size={18} className="text-sky-600" /> Aylık Çalışma Saatleri
          </h2>
          <p className="text-[12px] text-slate-400 mt-0.5">Atama verilerinden hesaplanmıştır</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="h-9 rounded-lg border px-2 text-[12px]" value={year} onChange={e => setYear(Number(e.target.value))}>
            {[2023,2024,2025,2026].map(y => <option key={y}>{y}</option>)}
          </select>
          <select className="h-9 rounded-lg border px-2 text-[12px]" value={month} onChange={e => setMonth(Number(e.target.value))}>
            {MONTHS_TR.map((m,i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
          <button onClick={load} disabled={loading} className="h-9 px-3 rounded-lg border text-[12px] flex items-center gap-1.5 hover:bg-slate-50">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Yükle
          </button>
          <button onClick={exportExcel} disabled={!data.length} className="h-9 px-3 rounded-lg border text-[12px] flex items-center gap-1.5 hover:bg-slate-50 disabled:opacity-40">
            <Download size={13} /> Excel
          </button>
        </div>
      </div>

      {loading && <div className="py-12 text-center text-[13px] text-slate-400">Yükleniyor…</div>}

      {!loading && data.length === 0 && (
        <div className="rounded-xl border border-dashed p-10 text-center text-[13px] text-slate-400">
          Bu dönem için çalışma saati verisi bulunamadı.
        </div>
      )}

      {!loading && data.length > 0 && (
        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
          <table className="w-full text-[12px]">
            <thead className="bg-slate-50 border-b">
              <tr>
                {['Ad Soyad','Servis','Toplam Atama','Toplam Saat','Gece Vardiyası','Dağılım'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left font-semibold text-slate-600 text-[11px]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((d, i) => (
                <tr key={i} className="border-b last:border-0 hover:bg-slate-50/50">
                  <td className="px-4 py-2.5 font-medium text-slate-700">{d.personName || d._id || '—'}</td>
                  <td className="px-4 py-2.5 text-slate-500">{d.serviceId || '—'}</td>
                  <td className="px-4 py-2.5 text-center">{d.totalAssignments}</td>
                  <td className="px-4 py-2.5 text-center font-semibold">{d.totalHours}s</td>
                  <td className="px-4 py-2.5 text-center text-slate-500">{d.nightShifts}</td>
                  <td className="px-4 py-2.5 w-32">
                    <div className="h-2 rounded bg-slate-100 overflow-hidden">
                      <div className="h-full bg-sky-500 rounded" style={{ width: `${((d.totalHours||0)/maxHours)*100}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
