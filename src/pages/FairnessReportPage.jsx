// src/pages/FairnessReportPage.jsx — Adillik skoru ve nöbet dağılımı raporu
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart2, CheckCircle2, RefreshCw, TrendingUp, Users } from 'lucide-react';
import { http } from '../lib/api.js';

const TR_MONTHS = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];

function computeFairnessScore(counts) {
  if (counts.length < 2) return 100;
  const mean = counts.reduce((s, c) => s + c, 0) / counts.length;
  if (!mean) return 100;
  const variance = counts.reduce((s, c) => s + (c - mean) ** 2, 0) / counts.length;
  const cv = Math.sqrt(variance) / mean;
  return Math.round(Math.max(0, 1 - cv) * 100);
}

function FairnessGauge({ score }) {
  const color = score >= 80 ? '#10b981' : score >= 55 ? '#f59e0b' : '#ef4444';
  const label = score >= 80 ? 'Adil' : score >= 55 ? 'Orta' : 'Dengesiz';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <svg viewBox="0 0 36 36" style={{ width: 80, height: 80, transform: 'rotate(-90deg)' }}>
        <circle cx="18" cy="18" r="15.9" fill="none" stroke="#f3f4f6" strokeWidth="3" />
        <circle cx="18" cy="18" r="15.9" fill="none" stroke={color} strokeWidth="3"
          strokeDasharray={`${score} 100`} strokeLinecap="round" />
      </svg>
      <div>
        <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1 }}>{score}</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>{label}</div>
        <div style={{ fontSize: 12, color: '#9ca3af' }}>Adillik puanı /100</div>
      </div>
    </div>
  );
}

function PersonBar({ name, count, max, ideal, rank }) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  const delta = count - ideal;
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
        <div style={{
          height: '100%', width: `${pct}%`, background: color, borderRadius: 4,
          transition: 'width 0.4s',
        }} />
      </div>
    </div>
  );
}

export default function FairnessReportPage({ activeYM }) {
  const now = new Date();
  const [year, setYear] = useState(activeYM ? parseInt(activeYM.slice(0,4)) : now.getFullYear());
  const [month, setMonth] = useState(activeYM ? parseInt(activeYM.slice(5,7)) : now.getMonth() + 1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sortBy, setSortBy] = useState('count-desc'); // count-desc | count-asc | name

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await http.get(`/api/schedules?sectionId=calisma-cizelgesi&year=${year}&month=${month}&size=1`);
      const assignments = res?.data?.assignments || res?.assignments || [];
      const issues = res?.data?.issues || res?.issues || [];

      // Aggregate by person
      const byPerson = {};
      for (const a of assignments) {
        const key = String(a?.personId || a?.personName || '?');
        const name = a?.personName || a?.personId || '?';
        if (!byPerson[key]) byPerson[key] = { name, count: 0, hours: 0 };
        byPerson[key].count++;
        byPerson[key].hours += Number(a?.hours || 0);
      }

      // By shift type
      const byShift = {};
      for (const a of assignments) {
        const k = a?.shiftId || a?.shiftCode || '—';
        byShift[k] = (byShift[k] || 0) + 1;
      }

      const people = Object.values(byPerson);
      const counts = people.map((p) => p.count);
      const totalShifts = counts.reduce((s, c) => s + c, 0);
      const ideal = people.length > 0 ? totalShifts / people.length : 0;
      const fairnessScore = computeFairnessScore(counts);
      const unfilledSlots = issues.filter((i) => Number(i?.missing || 0) > 0).reduce((s, i) => s + Number(i.missing), 0);
      const totalHours = people.reduce((s, p) => s + p.hours, 0);

      setData({ people, byShift, fairnessScore, ideal, totalShifts, totalHours, unfilledSlots, assignments });
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
    if (sortBy === 'count-asc') return copy.sort((a, b) => a.count - b.count);
    return copy.sort((a, b) => (a.name > b.name ? 1 : -1));
  }, [data, sortBy]);

  const maxCount = sortedPeople.reduce((m, p) => Math.max(m, p.count), 0);
  const shiftEntries = data ? Object.entries(data.byShift).sort((a, b) => b[1] - a[1]) : [];

  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <BarChart2 size={20} color="#6366f1" /> Adillik ve Dağılım Raporu
          </h1>
          <p style={{ fontSize: 13, color: '#6b7280' }}>
            {TR_MONTHS[month-1]} {year} · Nöbet yükü dağılımı ve adillik analizi
          </p>
        </div>
        <button onClick={load} disabled={loading} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
          borderRadius: 10, border: '1px solid #d1d5db', background: '#fff',
          color: '#374151', fontSize: 13, fontWeight: 600, cursor: 'pointer',
        }}>
          <RefreshCw size={13} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
          Yenile
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))} style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid #d1d5db', fontSize: 13 }}>
          {TR_MONTHS.map((n, i) => <option key={i} value={i+1}>{n}</option>)}
        </select>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid #d1d5db', fontSize: 13 }}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 16px', color: '#dc2626', fontSize: 13, marginBottom: 20, display: 'flex', gap: 8 }}>
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {data && (
        <>
          {/* Summary row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 14, marginBottom: 24 }}>
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
              <div style={{ fontSize: 24, fontWeight: 800, color: '#111827' }}>{data.people.length > 0 ? data.ideal.toFixed(1) : '—'}</div>
              <div style={{ fontSize: 11, color: '#9ca3af' }}>nöbet</div>
            </div>
            <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e5e7eb', padding: '16px 20px' }}>
              <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>Eksik Slot</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: data.unfilledSlots > 0 ? '#ef4444' : '#10b981' }}>{data.unfilledSlots}</div>
              <div style={{ fontSize: 11, color: '#9ca3af' }}>doldurulmayan</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 18 }}>
            {/* Person distribution */}
            <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e5e7eb', padding: '18px 22px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>
                  <Users size={14} style={{ display: 'inline', marginRight: 6 }} />
                  Kişi Bazlı Dağılım
                </h3>
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ fontSize: 12, padding: '4px 8px', borderRadius: 8, border: '1px solid #d1d5db' }}>
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
                    <PersonBar
                      key={i}
                      rank={i + 1}
                      name={p.name}
                      count={p.count}
                      max={maxCount}
                      ideal={data.ideal}
                    />
                  ))}
                </div>
              )}

              {/* Legend */}
              <div style={{ display: 'flex', gap: 14, marginTop: 14, paddingTop: 12, borderTop: '1px solid #f3f4f6', fontSize: 11, color: '#6b7280' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#10b981', display: 'inline-block' }} />Normal</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#ef4444', display: 'inline-block' }} />Fazla yüklü</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#f59e0b', display: 'inline-block' }} />Az yüklü</span>
              </div>
            </div>

            {/* Shift type breakdown */}
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
                  const color = colors[i % colors.length];
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

              {/* Summary stats */}
              {data.people.length > 0 && (
                <div style={{ marginTop: 20, paddingTop: 14, borderTop: '1px solid #f3f4f6' }}>
                  <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8 }}>İstatistikler</div>
                  {[
                    { label: 'Min nöbet', value: Math.min(...data.people.map((p) => p.count)) },
                    { label: 'Max nöbet', value: Math.max(...data.people.map((p) => p.count)) },
                    { label: 'Ort. saat', value: data.people.length ? (data.totalHours / data.people.length).toFixed(1) + 'h' : '—' },
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
                  <CheckCircle2 size={14} /> Dağılım adil görünüyor
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {loading && !data && (
        <div style={{ textAlign: 'center', color: '#9ca3af', padding: 60, fontSize: 14 }}>Yükleniyor…</div>
      )}

      <style>{`@keyframes spin { from { transform:rotate(0) } to { transform:rotate(360deg) } }`}</style>
    </div>
  );
}
