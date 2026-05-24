// src/pages/FairnessReportPage.jsx — Adillik skoru ve nöbet dağılımı raporu
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BarChart2, CheckCircle2, Download,
  FileDown, Info, Moon, RefreshCw, Star, Sun, TrendingUp, Users,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getMonthlySchedule } from '../api/apiAdapter.js';
import { http } from '../lib/api.js';

const TR_MONTHS = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];

// Türkiye resmi & dini tatilleri (2025-2026; dini bayramlar tahmini)
const TURKISH_HOLIDAYS = new Set([
  '2025-01-01',
  '2025-03-30','2025-03-31','2025-04-01',          // Ramazan 2025
  '2025-04-23','2025-05-01','2025-05-19',
  '2025-06-06','2025-06-07','2025-06-08','2025-06-09', // Kurban 2025
  '2025-07-15','2025-08-30','2025-10-28','2025-10-29',
  '2026-01-01',
  '2026-03-19','2026-03-20','2026-03-21',           // Ramazan 2026 (tahmini)
  '2026-04-23','2026-05-01','2026-05-19',
  '2026-05-26','2026-05-27','2026-05-28','2026-05-29', // Kurban 2026 (tahmini)
  '2026-07-15','2026-08-30','2026-10-28','2026-10-29',
]);

// ── Yardımcılar ────────────────────────────────────────────────────────────────

function computeFairnessScore(counts) {
  const nonZero = counts.filter(c => c > 0);
  if (nonZero.length < 2) return 100;
  const mean = nonZero.reduce((s, c) => s + c, 0) / nonZero.length;
  if (!mean) return 100;
  const variance = nonZero.reduce((s, c) => s + (c - mean) ** 2, 0) / nonZero.length;
  const cv = Math.sqrt(variance) / mean;
  return Math.round(Math.max(0, 1 - cv) * 100);
}

function scoreColor(score) {
  return score >= 80 ? '#10b981' : score >= 55 ? '#f59e0b' : '#ef4444';
}
function scoreLabel(score) {
  return score >= 80 ? 'Adil' : score >= 55 ? 'Orta' : 'Dengesiz';
}

// ── Ağırlıklı Adillik Hesaplama (frontend mirror of fairnessEngine.js) ─────────

const FAIRNESS_WEIGHTS = { night: 1.5, weekend: 1.3, holiday: 2.0, regular: 1.0 };

function computeWeightedLoad({ totalShifts, nightCount, weekendCount, holidayCount }) {
  const regular = Math.max(0, totalShifts - nightCount - weekendCount - holidayCount);
  return regular * FAIRNESS_WEIGHTS.regular
    + nightCount   * FAIRNESS_WEIGHTS.night
    + weekendCount * FAIRNESS_WEIGHTS.weekend
    + holidayCount * FAIRNESS_WEIGHTS.holiday;
}

function computePersonFairnessScores(people) {
  if (!people || people.length === 0) return [];
  const loads   = people.map(computeWeightedLoad);
  const mean    = loads.reduce((s, l) => s + l, 0) / loads.length;
  const minLoad = Math.min(...loads);
  const maxLoad = Math.max(...loads);
  const spread  = maxLoad - minLoad;

  const totalShifts  = people.reduce((s, p) => s + p.totalShifts,  0);
  const totalNight   = people.reduce((s, p) => s + (p.nightCount   || 0), 0);
  const totalWeekend = people.reduce((s, p) => s + (p.weekendCount || 0), 0);
  const totalHoliday = people.reduce((s, p) => s + (p.holidayCount || 0), 0);
  const idealNight   = totalShifts > 0 ? totalNight   / totalShifts : 0;
  const idealWeekend = totalShifts > 0 ? totalWeekend / totalShifts : 0;
  const idealHoliday = totalShifts > 0 ? totalHoliday / totalShifts : 0;

  const nearness = (ratio, ideal) => {
    if (ideal <= 0) return 100;
    return Math.round(Math.max(0, (1 - Math.abs(ratio - ideal) / ideal) * 100));
  };

  return people.map((p, i) => {
    const wLoad        = loads[i];
    const fScore       = spread > 0 ? Math.round(Math.max(0, (1 - Math.abs(wLoad - mean) / spread) * 100)) : 100;
    const nightRatio   = p.totalShifts > 0 ? (p.nightCount   || 0) / p.totalShifts : 0;
    const weekendRatio = p.totalShifts > 0 ? (p.weekendCount || 0) / p.totalShifts : 0;
    const holidayRatio = p.totalShifts > 0 ? (p.holidayCount || 0) / p.totalShifts : 0;
    return {
      ...p,
      weightedLoad:    Math.round(wLoad * 10) / 10,
      fairnessScore:   fScore,
      nightRatioPct:   Math.round(nightRatio   * 100),
      weekendRatioPct: Math.round(weekendRatio * 100),
      holidayRatioPct: Math.round(holidayRatio * 100),
      nightNearness:   nearness(nightRatio,   idealNight),
      weekendNearness: nearness(weekendRatio, idealWeekend),
      holidayNearness: nearness(holidayRatio, idealHoliday),
    };
  });
}

// ── Bileşenler ─────────────────────────────────────────────────────────────────

function FairnessGauge({ score }) {
  const color = scoreColor(score);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <svg viewBox="0 0 36 36" style={{ width: 80, height: 80, transform: 'rotate(-90deg)' }}>
        <circle cx="18" cy="18" r="15.9" fill="none" stroke="#f3f4f6" strokeWidth="3" />
        <circle cx="18" cy="18" r="15.9" fill="none" stroke={color} strokeWidth="3"
          strokeDasharray={`${score} 100`} strokeLinecap="round" />
      </svg>
      <div>
        <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1 }}>{score}</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>{scoreLabel(score)}</div>
        <div style={{ fontSize: 12, color: '#9ca3af' }}>Adillik puanı /100</div>
      </div>
    </div>
  );
}

function MiniGauge({ score, size = 44 }) {
  const color = scoreColor(score);
  return (
    <svg viewBox="0 0 36 36" style={{ width: size, height: size, transform: 'rotate(-90deg)', flexShrink: 0 }}>
      <circle cx="18" cy="18" r="15.9" fill="none" stroke="#f3f4f6" strokeWidth="4" />
      <circle cx="18" cy="18" r="15.9" fill="none" stroke={color} strokeWidth="4"
        strokeDasharray={`${score} 100`} strokeLinecap="round" />
    </svg>
  );
}

function PersonBar({ name, count, max, ideal, rank }) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  const delta = Math.round(count - ideal);
  const overloaded = delta > 1;
  const underloaded = delta < -1;
  const color = overloaded ? '#ef4444' : underloaded ? '#f59e0b' : '#10b981';
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#9ca3af', width: 22, textAlign: 'right' }}>#{rank}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#111827', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>{count}</span>
          {(overloaded || underloaded) && (
            <span style={{ fontSize: 11, fontWeight: 700, color, background: color + '15', borderRadius: 20, padding: '1px 7px' }}>
              {overloaded ? `+${delta}` : delta}
            </span>
          )}
        </div>
      </div>
      <div style={{ height: 8, background: '#f3f4f6', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 4, transition: 'width 0.4s' }} />
      </div>
    </div>
  );
}

// Metrik dağılım kartı: Gece / Hafta Sonu / Bayram
function MetricCard({ title, subtitle, icon: Icon, iconColor, score, people, metricKey, emptyMsg }) {
  const sorted = [...people]
    .filter(p => (p[metricKey] || 0) > 0)
    .sort((a, b) => (b[metricKey] || 0) - (a[metricKey] || 0));
  const maxVal = sorted[0]?.[metricKey] || 0;
  const color = scoreColor(score);
  const allVals = sorted.map(x => x[metricKey] || 0);
  const mean = allVals.length ? allVals.reduce((s, c) => s + c, 0) / allVals.length : 0;

  return (
    <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e5e7eb', padding: '18px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            {Icon && <Icon size={13} color={iconColor} />}
            <span style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>{title}</span>
          </div>
          <div style={{ fontSize: 11, color: '#9ca3af' }}>{subtitle}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <MiniGauge score={score} size={40} />
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color, lineHeight: 1 }}>{score}</div>
            <div style={{ fontSize: 10, color: '#9ca3af' }}>{scoreLabel(score)}</div>
          </div>
        </div>
      </div>

      {score < 55 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: '#fef2f2', borderRadius: 8, padding: '6px 10px',
          marginBottom: 10, fontSize: 11, color: '#dc2626', fontWeight: 600,
        }}>
          <AlertTriangle size={11} /> Dengesiz dağılım tespit edildi
        </div>
      )}

      {sorted.length === 0 ? (
        <div style={{ color: '#9ca3af', fontSize: 12, textAlign: 'center', padding: '12px 0' }}>{emptyMsg}</div>
      ) : (
        <div>
          {sorted.slice(0, 6).map((p, i) => {
            const val = p[metricKey] || 0;
            const pct = maxVal > 0 ? (val / maxVal) * 100 : 0;
            const isOver = mean > 0 && val - mean > mean * 0.3;
            const barColor = isOver ? '#ef4444' : i === 0 ? iconColor : '#94a3b8';
            return (
              <div key={i} style={{ marginBottom: 7 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2, fontSize: 11 }}>
                  <span style={{ color: '#374151', fontWeight: isOver ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}>{p.name}</span>
                  <span style={{ fontWeight: 700, color: isOver ? '#ef4444' : '#111827' }}>{val}</span>
                </div>
                <div style={{ height: 5, background: '#f3f4f6', borderRadius: 3 }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: barColor, borderRadius: 3, transition: 'width .4s' }} />
                </div>
              </div>
            );
          })}
          {sorted.length > 6 && (
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>+{sorted.length - 6} kişi daha…</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sayfa ──────────────────────────────────────────────────────────────────────

export default function FairnessReportPage({ activeYM }) {
  const now = new Date();
  const [year, setYear]   = useState(activeYM ? parseInt(activeYM.slice(0, 4)) : now.getFullYear());
  const [month, setMonth] = useState(activeYM ? parseInt(activeYM.slice(5, 7)) : now.getMonth() + 1);
  const [data, setData]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [sortBy, setSortBy]     = useState('count-desc');
  const [publishing, setPublishing] = useState(false);

  const publishSchedule = async () => {
    setPublishing(true);
    try {
      const res = await http.post('/api/schedules/publish-notify', { year, month });
      alert(`Bildirim gönderildi: ${res?.message || `${res?.groupStats?.personCount ?? '?'} personel`}`);
    } catch (e) {
      alert(e?.message || 'Bildirim gönderilemedi');
    } finally {
      setPublishing(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getMonthlySchedule({ sectionId: 'calisma-cizelgesi', year, month });
      const assignments = res?.data?.assignments || [];
      const issues      = res?.issues || res?.data?.issues || [];

      // Tek geçişte tüm kişi metriklerini topla
      const byPerson = {};
      for (const a of assignments) {
        const key  = String(a?.personId || a?.personName || '?');
        const name = a?.personName || a?.personId || '?';
        if (!byPerson[key]) byPerson[key] = { name, count: 0, hours: 0, nightCount: 0, weekendCount: 0, holidayCount: 0 };

        byPerson[key].count++;
        byPerson[key].hours += Number(a?.hours || 0);

        // Gece tespiti: shiftCode G, shiftId 'gece' içeriyor ya da startHour >= 22
        const sc      = (a?.shiftCode || a?.shiftId || '').toUpperCase();
        const startH  = Number(a?.startHour ?? -1);
        const isNight = sc === 'G' || sc === 'GECE' || (a?.shiftId || '').toLowerCase().includes('gece') || startH >= 22;

        // Hafta sonu tespiti (weekday 0=Pazar, 6=Cumartesi)
        const wd         = a?.weekday != null ? Number(a.weekday) : new Date(a?.date || 0).getDay();
        const isWeekend  = wd === 0 || wd === 6;

        // Resmi tatil tespiti
        const dateStr   = (a?.date || '').slice(0, 10);
        const isHoliday = TURKISH_HOLIDAYS.has(dateStr);

        if (isNight)   byPerson[key].nightCount++;
        if (isWeekend) byPerson[key].weekendCount++;
        if (isHoliday) byPerson[key].holidayCount++;
      }

      const byShift = {};
      for (const a of assignments) {
        const k = a?.shiftId || a?.shiftCode || '—';
        byShift[k] = (byShift[k] || 0) + 1;
      }

      const people      = Object.values(byPerson);
      const counts      = people.map(p => p.count);
      const totalShifts = counts.reduce((s, c) => s + c, 0);
      const ideal       = people.length > 0 ? totalShifts / people.length : 0;

      const fairnessScore   = computeFairnessScore(counts);
      const nightFairness   = computeFairnessScore(people.map(p => p.nightCount));
      const weekendFairness = computeFairnessScore(people.map(p => p.weekendCount));
      const holidayFairness = computeFairnessScore(people.map(p => p.holidayCount));

      const unfilledSlots = issues.filter(i => Number(i?.missing || 0) > 0).reduce((s, i) => s + Number(i.missing), 0);
      const totalHours    = people.reduce((s, p) => s + p.hours, 0);

      setData({ people, byShift, fairnessScore, nightFairness, weekendFairness, holidayFairness, ideal, totalShifts, totalHours, unfilledSlots });
    } catch (e) {
      setError(e?.data?.message || e?.message || 'Veri yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  const sortedPeople = useMemo(() => {
    if (!data?.people) return [];
    const copy = [...data.people];
    if (sortBy === 'count-desc') return copy.sort((a, b) => b.count - a.count);
    if (sortBy === 'count-asc')  return copy.sort((a, b) => a.count - b.count);
    return copy.sort((a, b) => (a.name > b.name ? 1 : -1));
  }, [data, sortBy]);

  const personScores = useMemo(() => {
    if (!data?.people) return [];
    return computePersonFairnessScores(data.people).sort((a, b) => b.fairnessScore - a.fairnessScore);
  }, [data]);

  const maxCount    = sortedPeople.reduce((m, p) => Math.max(m, p.count), 0);
  const shiftEntries = data ? Object.entries(data.byShift).sort((a, b) => b[1] - a[1]) : [];
  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];

  // ── Dışa aktarma ────────────────────────────────────────────────────────────

  const exportToExcel = () => {
    if (!data?.people) return;
    const rows = data.people.map(p => ({
      'Ad Soyad':      p.name,
      'Toplam Nöbet':  p.count,
      'Gece Nöbeti':   p.nightCount,
      'Hafta Sonu':    p.weekendCount,
      'Bayram Nöbeti': p.holidayCount,
      'Toplam Saat':   p.hours,
      'Adillik Skoru': data.fairnessScore,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Adillik Raporu');
    XLSX.writeFile(wb, `adillik-raporu-${year}-${String(month).padStart(2, '0')}.xlsx`);
  };

  const exportToPdf = () => {
    if (!data) return;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    doc.setFontSize(18);
    doc.setTextColor(17, 24, 39);
    doc.text('Adillik ve Dağılım Raporu', 14, 20);

    doc.setFontSize(10);
    doc.setTextColor(107, 114, 128);
    doc.text(`${TR_MONTHS[month - 1]} ${year}  ·  ${data.people.length} personel  ·  ${data.totalShifts} toplam atama`, 14, 28);
    doc.text(`Oluşturulma: ${new Date().toLocaleDateString('tr-TR')}`, 14, 33);

    // Özet skorlar tablosu
    autoTable(doc, {
      startY: 38,
      head: [['Metrik', 'Skor / Değer', 'Durum']],
      body: [
        ['Genel Adillik Skoru',         `${data.fairnessScore} / 100`,   scoreLabel(data.fairnessScore)],
        ['Gece Nöbeti Dengesi',          `${data.nightFairness} / 100`,   scoreLabel(data.nightFairness)],
        ['Hafta Sonu Dağılımı',          `${data.weekendFairness} / 100`, scoreLabel(data.weekendFairness)],
        ['Bayram Nöbeti Dengesi',        `${data.holidayFairness} / 100`, scoreLabel(data.holidayFairness)],
        ['Toplam Atama',                 String(data.totalShifts),        ''],
        ['Kişi Başı Ortalama',           `${data.ideal.toFixed(1)} nöbet`,''],
        ['Toplam Saat',                  `${data.totalHours} saat`,       ''],
        ['Doldurulmayan Slot',           String(data.unfilledSlots),      data.unfilledSlots > 0 ? 'Dikkat' : 'Tamam'],
      ],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [99, 102, 241], textColor: 255 },
      columnStyles: { 0: { fontStyle: 'bold' } },
      didParseCell(hookData) {
        if (hookData.column.index !== 2) return;
        const v = hookData.cell.raw;
        if (v === 'Dengesiz') hookData.cell.styles.textColor = [220, 38, 38];
        else if (v === 'Adil') hookData.cell.styles.textColor = [16, 185, 129];
        else if (v === 'Dikkat') hookData.cell.styles.textColor = [245, 158, 11];
      },
    });

    // Kişi dağılım tablosu
    const y2 = doc.lastAutoTable.finalY + 8;
    doc.setFontSize(12);
    doc.setTextColor(17, 24, 39);
    doc.text('Kişi Bazlı Dağılım', 14, y2);

    autoTable(doc, {
      startY: y2 + 4,
      head: [['Ad Soyad', 'Toplam', 'Gece', 'H. Sonu', 'Bayram', 'Saat (h)']],
      body: sortedPeople.map(p => [
        p.name,
        p.count,
        p.nightCount   || 0,
        p.weekendCount || 0,
        p.holidayCount || 0,
        p.hours,
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [99, 102, 241], textColor: 255 },
      alternateRowStyles: { fillColor: [249, 250, 251] },
      didParseCell(hookData) {
        if (hookData.section !== 'body') return;
        const p = sortedPeople[hookData.row.index];
        if (!p) return;
        // Gece nöbeti 1.5x ortalamanın üstündeyse kırmızı vurgula
        if (hookData.column.index === 2 && (p.nightCount || 0) > data.ideal * 1.5) {
          hookData.cell.styles.textColor = [220, 38, 38];
          hookData.cell.styles.fontStyle = 'bold';
        }
      },
    });

    const pageH = doc.internal.pageSize.getHeight();
    doc.setFontSize(8);
    doc.setTextColor(156, 163, 175);
    doc.text('Hastane Nöbet Yönetim Sistemi — Gizlilik Dereceli', 14, pageH - 8);

    doc.save(`adillik-raporu-${year}-${String(month).padStart(2, '0')}.pdf`);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto' }}>
      {/* Başlık */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <BarChart2 size={20} color="#6366f1" /> Adillik ve Dağılım Raporu
          </h1>
          <p style={{ fontSize: 13, color: '#6b7280' }}>
            {TR_MONTHS[month - 1]} {year} · Nöbet yükü dağılımı ve adillik analizi
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={exportToPdf}
            disabled={!data}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
              borderRadius: 10, border: '1px solid #6366f1',
              background: data ? '#6366f1' : '#f9fafb',
              color: data ? '#fff' : '#9ca3af',
              fontSize: 13, fontWeight: 600,
              cursor: data ? 'pointer' : 'not-allowed',
              opacity: data ? 1 : 0.5, transition: 'all .15s',
            }}
          >
            <FileDown size={14} /> PDF İndir
          </button>
          <button
            onClick={exportToExcel}
            disabled={!data}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
              borderRadius: 10, border: '1px solid #d1d5db', background: '#fff',
              color: '#374151', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              opacity: !data ? 0.4 : 1,
            }}
          >
            <Download size={14} /> Excel
          </button>
          <button
            onClick={load}
            disabled={loading}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
              borderRadius: 10, border: '1px solid #d1d5db', background: '#fff',
              color: '#374151', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            <RefreshCw size={13} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
            Yenile
          </button>
          <button
            onClick={publishSchedule}
            disabled={!data || publishing}
            title="Personele adillik skorlu bildirim gönder"
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
              borderRadius: 10, border: '1px solid #10b981',
              background: data && !publishing ? '#10b981' : '#f9fafb',
              color: data && !publishing ? '#fff' : '#9ca3af',
              fontSize: 13, fontWeight: 600,
              cursor: data && !publishing ? 'pointer' : 'not-allowed',
              opacity: !data ? 0.5 : 1, transition: 'all .15s',
            }}
          >
            <CheckCircle2 size={14} />
            {publishing ? 'Gönderiliyor…' : 'Çizelgeyi Yayınla'}
          </button>
        </div>
      </div>

      {/* Filtreler */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <select value={month} onChange={e => setMonth(Number(e.target.value))} style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid #d1d5db', fontSize: 13 }}>
          {TR_MONTHS.map((n, i) => <option key={i} value={i + 1}>{n}</option>)}
        </select>
        <select value={year} onChange={e => setYear(Number(e.target.value))} style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid #d1d5db', fontSize: 13 }}>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 16px', color: '#dc2626', fontSize: 13, marginBottom: 20, display: 'flex', gap: 8 }}>
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {data && (
        <>
          {/* Satır 1 — 4 genel özet kart */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 14, marginBottom: 18 }}>
            <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e5e7eb', padding: '16px 20px' }}>
              <FairnessGauge score={data.fairnessScore} />
            </div>
            <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e5e7eb', padding: '16px 20px' }}>
              <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>Toplam Atama</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#111827' }}>{data.totalShifts}</div>
              <div style={{ fontSize: 11, color: '#9ca3af' }}>{data.people.length} kişi</div>
            </div>
            <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e5e7eb', padding: '16px 20px' }}>
              <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>Kişi Başı Ortalama</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#111827' }}>
                {data.people.length > 0 ? data.ideal.toFixed(1) : '—'}
              </div>
              <div style={{ fontSize: 11, color: '#9ca3af' }}>nöbet</div>
            </div>
            <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e5e7eb', padding: '16px 20px' }}>
              <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>Eksik Slot</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: data.unfilledSlots > 0 ? '#ef4444' : '#10b981' }}>
                {data.unfilledSlots}
              </div>
              <div style={{ fontSize: 11, color: '#9ca3af' }}>doldurulmayan</div>
            </div>
          </div>

          {/* Satır 2 — 3 metrik kart */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 18 }}>
            <MetricCard
              title="Gece Nöbeti Dengesi"
              subtitle="22:00–08:00 vardiyalarının dağılımı"
              icon={Moon}
              iconColor="#6366f1"
              score={data.nightFairness}
              people={data.people}
              metricKey="nightCount"
              emptyMsg="Bu ay gece nöbeti kaydı yok"
            />
            <MetricCard
              title="Hafta Sonu Dağılımı"
              subtitle="Cumartesi & Pazar vardiyaları"
              icon={Sun}
              iconColor="#f59e0b"
              score={data.weekendFairness}
              people={data.people}
              metricKey="weekendCount"
              emptyMsg="Bu ay hafta sonu ataması yok"
            />
            <MetricCard
              title="Bayram Nöbetleri"
              subtitle="Resmi tatil & dini bayram nöbetleri"
              icon={Star}
              iconColor="#10b981"
              score={data.holidayFairness}
              people={data.people}
              metricKey="holidayCount"
              emptyMsg="Bu ay resmi tatil nöbeti yok"
            />
          </div>

          {/* Satır 3 — Kişi dağılımı + Vardiya breakdown */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 18 }}>
            <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e5e7eb', padding: '18px 22px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>
                  <Users size={14} style={{ display: 'inline', marginRight: 6 }} />
                  Kişi Bazlı Toplam Dağılım
                </h3>
                <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ fontSize: 12, padding: '4px 8px', borderRadius: 8, border: '1px solid #d1d5db' }}>
                  <option value="count-desc">Çoktan aza</option>
                  <option value="count-asc">Azdan çoğa</option>
                  <option value="name">İsim</option>
                </select>
              </div>
              {sortedPeople.length === 0 ? (
                <div style={{ color: '#9ca3af', textAlign: 'center', padding: 24, fontSize: 13 }}>
                  {loading ? 'Yükleniyor…' : 'Bu ay için veri yok'}
                </div>
              ) : (
                <div style={{ maxHeight: 420, overflowY: 'auto', paddingRight: 4 }}>
                  {sortedPeople.map((p, i) => (
                    <PersonBar key={i} rank={i + 1} name={p.name} count={p.count} max={maxCount} ideal={data.ideal} />
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 14, marginTop: 14, paddingTop: 12, borderTop: '1px solid #f3f4f6', fontSize: 11, color: '#6b7280' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#10b981', display: 'inline-block' }} />Normal</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#ef4444', display: 'inline-block' }} />Fazla yüklü</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#f59e0b', display: 'inline-block' }} />Az yüklü</span>
              </div>
            </div>

            <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e5e7eb', padding: '18px 22px' }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 14 }}>
                <TrendingUp size={14} style={{ display: 'inline', marginRight: 6 }} />
                Vardiya Türleri
              </h3>
              {shiftEntries.length === 0 ? (
                <div style={{ color: '#9ca3af', fontSize: 13, textAlign: 'center', padding: 20 }}>Veri yok</div>
              ) : (
                shiftEntries.map(([shift, count], i) => {
                  const pct = data.totalShifts > 0 ? (count / data.totalShifts) * 100 : 0;
                  const colors = ['#6366f1','#8b5cf6','#06b6d4','#10b981','#f59e0b','#ef4444'];
                  const color  = colors[i % colors.length];
                  return (
                    <div key={shift} style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13 }}>
                        <span style={{ fontWeight: 600, color: '#374151' }}>{shift}</span>
                        <span style={{ color: '#6b7280' }}>{count} <span style={{ color: '#9ca3af' }}>({pct.toFixed(0)}%)</span></span>
                      </div>
                      <div style={{ height: 6, background: '#f3f4f6', borderRadius: 3 }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width .4s' }} />
                      </div>
                    </div>
                  );
                })
              )}
              {data.people.length > 0 && (
                <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid #f3f4f6' }}>
                  <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8 }}>İstatistikler</div>
                  {[
                    { label: 'Min nöbet',     value: Math.min(...data.people.map(p => p.count)) },
                    { label: 'Max nöbet',     value: Math.max(...data.people.map(p => p.count)) },
                    { label: 'Ort. saat',     value: data.people.length ? (data.totalHours / data.people.length).toFixed(1) + 'h' : '—' },
                    { label: 'Toplam gece',   value: data.people.reduce((s, p) => s + (p.nightCount   || 0), 0) },
                    { label: 'Toplam h.sonu', value: data.people.reduce((s, p) => s + (p.weekendCount || 0), 0) },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
                      <span style={{ color: '#6b7280' }}>{label}</span>
                      <span style={{ fontWeight: 700, color: '#111827' }}>{value}</span>
                    </div>
                  ))}
                </div>
              )}
              {data.fairnessScore >= 80 && (
                <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 6, color: '#10b981', fontSize: 12, fontWeight: 600 }}>
                  <CheckCircle2 size={14} /> Genel dağılım adil görünüyor
                </div>
              )}
            </div>
          </div>
          {/* ── Adalet Metrikleri ─────────────────────────────────────────── */}
          {personScores.length > 0 && (
            <div style={{ marginTop: 18 }}>
              {/* Başlık */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <BarChart2 size={16} color="#6366f1" />
                <span style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>Adalet Metrikleri</span>
              </div>

              {/* Sistem Notu */}
              <div style={{
                display: 'flex', gap: 10, alignItems: 'flex-start',
                background: '#eef2ff', border: '1px solid #c7d2fe',
                borderRadius: 12, padding: '12px 16px', marginBottom: 16,
              }}>
                <Info size={15} color="#4f46e5" style={{ flexShrink: 0, marginTop: 1 }} />
                <p style={{ fontSize: 12, color: '#3730a3', lineHeight: 1.6, margin: 0 }}>
                  <strong>Sistem Notu:</strong> Bu puan; nöbet türlerinin zorluk derecesi, gece nöbeti dağılımı ve hafta sonu yükü
                  kriterleri baz alınarak, tüm personel için eşitlik ilkesine göre otomatik hesaplanmıştır.
                  Ağırlıklar: Gece nöbeti ×1.5 · Hafta sonu ×1.3 · Tatil günü ×2.0 · Standart nöbet ×1.0
                </p>
              </div>

              {/* Kıyaslama Tablosu */}
              <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      {['#','Ad Soyad','Nöbet Yükü Puanı','Gece Nöbeti Oranı','Hafta Sonu Yükü','Tatil Nöbeti','Durum'].map((h, i) => (
                        <th key={i} style={{
                          padding: '10px 14px', textAlign: i >= 2 ? 'center' : 'left',
                          fontSize: 10, fontWeight: 700, color: '#6b7280',
                          textTransform: 'uppercase', letterSpacing: '0.07em',
                          borderBottom: '1px solid #e5e7eb',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {personScores.map((p, i) => {
                      const fColor = scoreColor(p.fairnessScore);
                      const rowBg  = i % 2 === 1 ? '#f9fafb' : '#fff';

                      const NearBar = ({ value, label }) => (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: scoreColor(value) }}>{value}%</div>
                          <div style={{ width: 60, height: 4, background: '#f3f4f6', borderRadius: 2 }}>
                            <div style={{ width: `${value}%`, height: '100%', background: scoreColor(value), borderRadius: 2 }} />
                          </div>
                          <div style={{ fontSize: 9, color: '#9ca3af' }}>{label}</div>
                        </div>
                      );

                      return (
                        <tr key={i} style={{ background: rowBg }}>
                          <td style={{ padding: '10px 14px', color: '#9ca3af' }}>{i + 1}</td>
                          <td style={{ padding: '10px 14px', fontWeight: 600, color: '#111827', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.name}
                          </td>
                          {/* Nöbet Yükü Puanı */}
                          <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                              <MiniGauge score={p.fairnessScore} size={32} />
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 800, color: fColor, lineHeight: 1 }}>{p.fairnessScore}</div>
                                <div style={{ fontSize: 9, color: '#9ca3af' }}>yük: {p.weightedLoad}</div>
                              </div>
                            </div>
                          </td>
                          {/* Gece Nöbeti Oranı — ideal yakınlığı */}
                          <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                            <NearBar value={p.nightNearness} label={`${p.nightCount || 0} nöbet (${p.nightRatioPct}%)`} />
                          </td>
                          {/* Hafta Sonu Yükü */}
                          <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                            <NearBar value={p.weekendNearness} label={`${p.weekendCount || 0} nöbet (${p.weekendRatioPct}%)`} />
                          </td>
                          {/* Tatil Nöbeti */}
                          <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                            <NearBar value={p.holidayNearness} label={`${p.holidayCount || 0} nöbet (${p.holidayRatioPct}%)`} />
                          </td>
                          {/* Durum */}
                          <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                            <span style={{
                              display: 'inline-block', padding: '3px 10px', borderRadius: 20,
                              fontSize: 11, fontWeight: 700,
                              background: fColor + '18', color: fColor,
                            }}>
                              {scoreLabel(p.fairnessScore)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Ağırlık açıklaması */}
              <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
                {[
                  { label: 'Standart Nöbet', color: '#94a3b8', weight: '×1.0' },
                  { label: 'Hafta Sonu',     color: '#f59e0b', weight: '×1.3' },
                  { label: 'Gece Nöbeti',    color: '#6366f1', weight: '×1.5' },
                  { label: 'Tatil Nöbeti',   color: '#10b981', weight: '×2.0' },
                ].map(({ label, color, weight }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#6b7280' }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: 'inline-block' }} />
                    {label} <span style={{ fontWeight: 700, color }}>{weight}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {loading && !data && (
        <div style={{ textAlign: 'center', color: '#9ca3af', padding: 60, fontSize: 14 }}>Yükleniyor…</div>
      )}

      <style>{`@keyframes spin { from { transform:rotate(0) } to { transform:rotate(360deg) } }`}</style>
    </div>
  );
}
