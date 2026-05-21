// src/pages/LeaveStatsPage.jsx
import React, { useState, useCallback, useEffect } from 'react';
import { RefreshCw, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { http } from '../lib/api.js';

const STATUS_LABEL = { pending: 'Beklemede', approved: 'Onaylandı', rejected: 'Reddedildi' };
const STATUS_COLOR = { pending: '#f59e0b', approved: '#10b981', rejected: '#ef4444' };
const TYPE_LABEL   = { izin: 'İzin', takas: 'Takas', tercih: 'Tercih', diger: 'Diğer' };
const TYPE_COLOR   = ['#6366f1','#8b5cf6','#06b6d4','#f59e0b','#10b981'];

function StatCard({ label, value, color }) {
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm flex items-center gap-3">
      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
      <div>
        <div className="text-[11px] text-slate-400">{label}</div>
        <div className="text-[22px] font-bold text-slate-800">{value}</div>
      </div>
    </div>
  );
}

function BarGroup({ data, labelMap, colorMap }) {
  const max = Math.max(...data.map(d => d.count || 0), 1);
  return (
    <div className="space-y-2">
      {data.map((d, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="w-20 text-[12px] text-slate-600 text-right shrink-0">{labelMap[d._id] || d._id}</div>
          <div className="flex-1 h-5 bg-slate-100 rounded overflow-hidden">
            <div
              className="h-full rounded transition-all"
              style={{
                width: `${((d.count||0)/max)*100}%`,
                background: colorMap?.[d._id] || TYPE_COLOR[i % TYPE_COLOR.length],
              }}
            />
          </div>
          <div className="w-8 text-[12px] font-semibold text-slate-700 shrink-0">{d.count}</div>
        </div>
      ))}
    </div>
  );
}

export default function LeaveStatsPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await http.get(`/api/reports/leave-stats?year=${year}`);
      setStats(res);
    } catch (e) {
      toast.error(e?.message || 'Veri yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => { load(); }, [load]);

  const total    = (stats?.byStatus || []).reduce((s, d) => s + d.count, 0);
  const approved = (stats?.byStatus || []).find(d => d._id === 'approved')?.count || 0;
  const pending  = (stats?.byStatus || []).find(d => d._id === 'pending')?.count  || 0;
  const rejected = (stats?.byStatus || []).find(d => d._id === 'rejected')?.count || 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-bold text-slate-800 flex items-center gap-2">
            <FileText size={18} className="text-violet-600" /> İzin İstatistikleri
          </h2>
          <p className="text-[12px] text-slate-400 mt-0.5">Talep veritabanından hesaplanmıştır</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="h-9 rounded-lg border px-2 text-[12px]" value={year} onChange={e => setYear(Number(e.target.value))}>
            {[2023,2024,2025,2026].map(y => <option key={y}>{y}</option>)}
          </select>
          <button onClick={load} disabled={loading} className="h-9 px-3 rounded-lg border text-[12px] flex items-center gap-1.5 hover:bg-slate-50">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Yükle
          </button>
        </div>
      </div>

      {loading && <div className="py-12 text-center text-[13px] text-slate-400">Yükleniyor…</div>}

      {!loading && stats && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Toplam Talep"  value={total}    color="#6366f1" />
            <StatCard label="Onaylandı"     value={approved} color="#10b981" />
            <StatCard label="Beklemede"     value={pending}  color="#f59e0b" />
            <StatCard label="Reddedildi"    value={rejected} color="#ef4444" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <h3 className="text-[13px] font-semibold text-slate-700 mb-3">Durum Dağılımı</h3>
              <BarGroup data={stats.byStatus || []} labelMap={STATUS_LABEL} colorMap={STATUS_COLOR} />
            </div>
            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <h3 className="text-[13px] font-semibold text-slate-700 mb-3">Tür Dağılımı</h3>
              <BarGroup data={stats.byType || []} labelMap={TYPE_LABEL} colorMap={null} />
            </div>
          </div>
        </>
      )}

      {!loading && !stats && (
        <div className="rounded-xl border border-dashed p-10 text-center text-[13px] text-slate-400">
          Veri yüklemek için "Yükle" butonuna tıklayın.
        </div>
      )}
    </div>
  );
}
