// src/pages/ComplianceReportPage.jsx — Mevzuat Uyumluluk Raporu
import React, { useState, useCallback, useEffect } from 'react';
import { RefreshCw, ShieldCheck, XCircle, AlertTriangle, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { http } from '../lib/api.js';

const RULE_LABELS = {
  WEEKLY_MAX_HOURS:     'Haftalık Saat Limiti',
  DAILY_MAX_HOURS:      'Günlük Saat Limiti',
  MIN_REST_BETWEEN:     'Vardiyalar Arası Dinlenme',
  MAX_CONSECUTIVE_DAYS: 'Kesintisiz Çalışma',
  NIGHT_SHIFT_LIMIT:    'Gece Nöbeti Limiti',
};

const RULE_LAW = {
  WEEKLY_MAX_HOURS:     'İş K. 63. Madde',
  DAILY_MAX_HOURS:      'İş K. 63. Madde',
  MIN_REST_BETWEEN:     'İş K. 68. Madde',
  MAX_CONSECUTIVE_DAYS: 'İş K. Genel İlke',
  NIGHT_SHIFT_LIMIT:    'SB Yönetmeliği',
};

function SummaryCard({ label, value, icon: Icon, color }) {
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm flex items-center gap-3">
      <div className={`rounded-lg p-2 ${color}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="text-[11px] text-slate-400">{label}</div>
        <div className="text-[22px] font-bold text-slate-800">{value}</div>
      </div>
    </div>
  );
}

function groupViolationsByPerson(violations) {
  const map = new Map();
  for (const v of violations || []) {
    const key = v.personId || v.personName;
    if (!map.has(key)) map.set(key, { personName: v.personName, errors: [], warnings: [] });
    const bucket = v.severity === 'error' ? 'errors' : 'warnings';
    map.get(key)[bucket].push(v);
  }
  return [...map.values()].sort((a, b) => b.errors.length - a.errors.length);
}

const MONTHS = [
  'Ocak','Şubat','Mart','Nisan','Mayıs','Haziran',
  'Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık',
];

export default function ComplianceReportPage() {
  const now = new Date();
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await http.get(`/api/compliance/report?year=${year}&month=${month}`);
      setResult(res);
    } catch (e) {
      toast.error(e?.message || 'Rapor yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  const violations  = result?.violations  || [];
  const summary     = result?.summary     || {};
  const grouped     = groupViolationsByPerson(violations);
  const errorCount  = violations.filter(v => v.severity === 'error').length;
  const warnCount   = violations.filter(v => v.severity === 'warning').length;
  const clean       = result && violations.length === 0;

  const years = [];
  for (let y = now.getFullYear(); y >= now.getFullYear() - 2; y--) years.push(y);

  return (
    <div className="space-y-5 p-1">

      {/* Başlık + filtreler */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-blue-600" />
          <h1 className="text-[16px] font-semibold text-slate-800">Mevzuat Uyumluluk Raporu</h1>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
            4857 Sayılı İş Kanunu
          </span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] text-slate-700"
          >
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select
            value={month}
            onChange={e => setMonth(Number(e.target.value))}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] text-slate-700"
          >
            {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Yenile
          </button>
        </div>
      </div>

      {/* Özet kartlar */}
      {result && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryCard
            label="İncelenen Personel"
            value={summary.totalPeople ?? grouped.length}
            icon={ShieldCheck}
            color="bg-blue-50 text-blue-600"
          />
          <SummaryCard
            label="Etkilenen Personel"
            value={summary.peopleAffected ?? grouped.length}
            icon={ShieldAlert}
            color={grouped.length > 0 ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}
          />
          <SummaryCard
            label="Kritik Hata"
            value={errorCount}
            icon={XCircle}
            color={errorCount > 0 ? 'bg-rose-50 text-rose-600' : 'bg-slate-50 text-slate-400'}
          />
          <SummaryCard
            label="Uyarı"
            value={warnCount}
            icon={AlertTriangle}
            color={warnCount > 0 ? 'bg-amber-50 text-amber-600' : 'bg-slate-50 text-slate-400'}
          />
        </div>
      )}

      {/* Temiz durum */}
      {clean && (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4">
          <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0" />
          <div>
            <div className="text-[14px] font-semibold text-emerald-800">Tüm Personel Uyumlu</div>
            <div className="text-[12px] text-emerald-600">
              {MONTHS[month - 1]} {year} dönemi için herhangi bir mevzuat ihlali tespit edilmedi.
            </div>
          </div>
        </div>
      )}

      {/* İhlal listesi */}
      {grouped.length > 0 && (
        <div className="space-y-3">
          <div className="text-[12px] font-medium text-slate-500 uppercase tracking-wide">
            İhlal Detayları — {grouped.length} Personel
          </div>
          {grouped.map((person) => (
            <div key={person.personName} className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
              <div className="flex items-center gap-2 bg-slate-50 px-4 py-2.5 border-b border-slate-200">
                <div className="text-[13px] font-semibold text-slate-800">{person.personName}</div>
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
                  <div key={i} className="flex items-start gap-3 px-4 py-2.5">
                    {v.severity === 'error'
                      ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                      : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    }
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-slate-700">{v.label}</div>
                      <div className="mt-0.5 text-[11px] text-slate-400">
                        {RULE_LABELS[v.rule] || v.rule}
                        {RULE_LAW[v.rule] ? ` — ${RULE_LAW[v.rule]}` : ''}
                        {v.date ? ` · ${v.date}` : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Yükleniyor */}
      {loading && !result && (
        <div className="flex items-center justify-center py-16 text-slate-400 text-[13px] gap-2">
          <RefreshCw className="h-4 w-4 animate-spin" />
          Rapor yükleniyor…
        </div>
      )}

      {/* Yasal not */}
      {result && (
        <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-[12px] text-slate-500">
          Bu rapor <strong className="text-slate-600">4857 Sayılı İş Kanunu</strong> kapsamında otomatik
          hesaplanmaktadır. Çizelgeyi yayınlamadan önce bu raporu kontrol etmeniz tavsiye edilir.
          Uyumluluk ayarları <em>Yönetim → Parametreler</em> altından güncellenebilir.
        </div>
      )}
    </div>
  );
}
