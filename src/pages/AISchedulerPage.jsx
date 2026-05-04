// src/pages/AISchedulerPage.jsx
// AI ile Çizelge Oluştur: service + month seç → generate → poll → preview → onayla
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Calendar, CheckCircle2, ChevronRight, Clock, Loader2,
  RefreshCw, Sparkles, TrendingUp, Users,
} from 'lucide-react';
import { http } from '../lib/api.js';
import { useAuth } from '../auth/AuthContext.jsx';

const TR_MONTHS = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];

const STATUS_META = {
  queued:  { label: 'Kuyrukta', color: '#f59e0b', icon: Clock },
  running: { label: 'Oluşturuluyor…', color: '#6366f1', icon: Loader2 },
  done:    { label: 'Tamamlandı', color: '#10b981', icon: CheckCircle2 },
  failed:  { label: 'Hata', color: '#ef4444', icon: AlertTriangle },
};

function QualityBadge({ quality }) {
  if (!quality) return null;
  const { score, coverage, fairness } = quality;
  const color = score >= 80 ? '#10b981' : score >= 55 ? '#f59e0b' : '#ef4444';
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 12,
      background: color + '12', border: `1px solid ${color}30`,
      borderRadius: 12, padding: '10px 16px',
    }}>
      <TrendingUp size={18} color={color} />
      <div>
        <div style={{ fontSize: 20, fontWeight: 800, color }}>{score}<span style={{ fontSize: 13, fontWeight: 500, color: '#6b7280' }}>/100</span></div>
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
          Doluluk {coverage}% · Adalet {fairness}%
        </div>
      </div>
    </div>
  );
}

function AssignmentTable({ assignments = [] }) {
  const byDate = {};
  for (const a of assignments) {
    const d = a.date || a.day || '?';
    (byDate[d] ??= []).push(a);
  }
  const dates = Object.keys(byDate).sort();
  if (!dates.length) return <div style={{ color: '#9ca3af', textAlign: 'center', padding: 32 }}>Atama yok</div>;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#f9fafb' }}>
            <th style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280', fontWeight: 600, borderBottom: '1px solid #e5e7eb' }}>Tarih</th>
            <th style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280', fontWeight: 600, borderBottom: '1px solid #e5e7eb' }}>Vardiya</th>
            <th style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280', fontWeight: 600, borderBottom: '1px solid #e5e7eb' }}>Kişi</th>
            <th style={{ padding: '8px 12px', textAlign: 'right', color: '#6b7280', fontWeight: 600, borderBottom: '1px solid #e5e7eb' }}>Saat</th>
          </tr>
        </thead>
        <tbody>
          {dates.slice(0, 31).map((date) =>
            byDate[date].map((a, i) => (
              <tr key={`${date}-${i}`} style={{ borderBottom: '1px solid #f3f4f6' }}>
                {i === 0 && (
                  <td rowSpan={byDate[date].length} style={{ padding: '7px 12px', fontWeight: 600, color: '#374151', verticalAlign: 'top' }}>
                    {date.slice(8)} {TR_MONTHS[(parseInt(date.slice(5,7)) - 1)]}
                  </td>
                )}
                <td style={{ padding: '7px 12px', color: '#6366f1', fontWeight: 600 }}>{a.shiftId || a.shiftCode || '—'}</td>
                <td style={{ padding: '7px 12px', color: '#111827' }}>{a.personName || a.personId || '—'}</td>
                <td style={{ padding: '7px 12px', textAlign: 'right', color: '#9ca3af' }}>{a.hours ? `${a.hours}s` : '—'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      {assignments.length > 31 * 5 && (
        <div style={{ textAlign: 'center', padding: '10px', color: '#9ca3af', fontSize: 12 }}>
          + {assignments.length} atama (ilk 31 gün gösteriliyor)
        </div>
      )}
    </div>
  );
}

function IssueList({ issues = [] }) {
  const real = issues.filter((i) => Number(i?.missing || 0) > 0);
  if (!real.length) return null;
  return (
    <div style={{ background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
      <div style={{ fontWeight: 600, color: '#92400e', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <AlertTriangle size={14} /> {real.length} eksik slot
      </div>
      {real.slice(0, 5).map((i, idx) => (
        <div key={idx} style={{ fontSize: 12, color: '#78350f', marginBottom: 4 }}>
          {i.date} / {i.shiftId} — {i.missing} eksik
          {i.topBlockers?.length > 0 && ` (${i.topBlockers.map((b) => b.code).join(', ')})`}
        </div>
      ))}
    </div>
  );
}

export default function AISchedulerPage({ activeYM }) {
  const { user } = useAuth();
  const isAdmin = ['admin', 'authorized', 'manager'].includes(String(user?.role || '').toLowerCase());

  const now = new Date();
  const [year, setYear] = useState(activeYM ? parseInt(activeYM.slice(0, 4)) : now.getFullYear());
  const [month, setMonth] = useState(activeYM ? parseInt(activeYM.slice(5, 7)) : now.getMonth() + 1);
  const [services, setServices] = useState([]);
  const [selectedService, setSelectedService] = useState('');
  const [dryRun, setDryRun] = useState(false);

  // Job state
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null); // { status, result, quality, error, durationMs }
  const [submitting, setSubmitting] = useState(false);
  const pollRef = useRef(null);

  // Load services
  useEffect(() => {
    http.get('/api/services?size=100')
      .then((d) => {
        const items = d?.items || d?.data || (Array.isArray(d) ? d : []);
        setServices(items);
        if (items.length === 1) setSelectedService(String(items[0]._id || items[0].id || ''));
      })
      .catch(() => {});
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const pollJob = useCallback(async (jId) => {
    try {
      const data = await http.get(`/api/scheduler/jobs/${jId}`);
      setJobStatus(data);
      if (data.status === 'done' || data.status === 'failed') stopPolling();
    } catch (err) {
      setJobStatus((prev) => ({ ...(prev || {}), status: 'failed', error: err?.message || 'Polling hatası' }));
      stopPolling();
    }
  }, [stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const startGeneration = useCallback(async () => {
    if (!selectedService && services.length > 0) {
      alert('Lütfen bir servis seçin.');
      return;
    }
    setSubmitting(true);
    setJobId(null);
    setJobStatus(null);
    stopPolling();

    try {
      const service = services.find((s) => String(s._id || s.id || '') === selectedService);
      const sectionId = service?.sectionId || service?._id || service?.id || selectedService || 'default';
      const serviceId = service?._id || service?.id || selectedService || '';

      const data = await http.post('/api/scheduler/generate', {
        sectionId,
        serviceId,
        year,
        month,
        dryRun,
      });

      if (data.jobId) {
        setJobId(data.jobId);
        setJobStatus({ status: 'queued' });
        pollRef.current = setInterval(() => pollJob(data.jobId), 2500);
      } else if (data.ok && data.data) {
        // Sync fallback
        setJobStatus({ status: 'done', result: data, quality: data.quality });
      }
    } catch (err) {
      setJobStatus({ status: 'failed', error: err?.data?.message || err?.message || 'Bilinmeyen hata' });
    } finally {
      setSubmitting(false);
    }
  }, [selectedService, services, year, month, dryRun, pollJob, stopPolling]);

  const reset = () => {
    stopPolling();
    setJobId(null);
    setJobStatus(null);
  };

  const running = jobStatus?.status === 'queued' || jobStatus?.status === 'running' || submitting;
  const statusMeta = STATUS_META[jobStatus?.status] || null;
  const result = jobStatus?.result;
  const assignments = result?.data?.assignments || [];
  const issues = result?.data?.issues || [];
  const quality = jobStatus?.quality || result?.quality || null;

  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Sparkles size={22} color="#6366f1" />
          AI ile Çizelge Oluştur
        </h1>
        <p style={{ fontSize: 14, color: '#6b7280', marginTop: 4 }}>
          Servis ve ayı seçin, AI atamaları otomatik olarak oluşturup kaydetsin.
        </p>
      </div>

      {/* Config card */}
      <div style={{
        background: '#fff', borderRadius: 16, border: '1px solid #e5e7eb',
        boxShadow: '0 4px 24px -12px rgba(15,23,42,0.08)',
        padding: '24px 28px', marginBottom: 20,
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 16, marginBottom: 20 }}>
          {/* Service */}
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
              <Users size={13} style={{ display: 'inline', marginRight: 4 }} />Servis
            </label>
            <select
              value={selectedService}
              onChange={(e) => setSelectedService(e.target.value)}
              disabled={running}
              style={{
                width: '100%', padding: '9px 12px', borderRadius: 10,
                border: '1px solid #d1d5db', fontSize: 14,
                background: running ? '#f9fafb' : '#fff',
              }}
            >
              <option value="">— Seçin —</option>
              {services.map((s) => (
                <option key={s._id || s.id} value={String(s._id || s.id || '')}>
                  {s.name || s.label || s._id}
                </option>
              ))}
            </select>
          </div>

          {/* Month */}
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
              <Calendar size={13} style={{ display: 'inline', marginRight: 4 }} />Ay
            </label>
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              disabled={running}
              style={{
                width: '100%', padding: '9px 12px', borderRadius: 10,
                border: '1px solid #d1d5db', fontSize: 14,
                background: running ? '#f9fafb' : '#fff',
              }}
            >
              {TR_MONTHS.map((n, i) => <option key={i} value={i + 1}>{n}</option>)}
            </select>
          </div>

          {/* Year */}
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Yıl</label>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              disabled={running}
              style={{
                width: '100%', padding: '9px 12px', borderRadius: 10,
                border: '1px solid #d1d5db', fontSize: 14,
                background: running ? '#f9fafb' : '#fff',
              }}
            >
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        {/* Dry-run toggle */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 20, width: 'fit-content' }}>
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
            disabled={running}
            style={{ width: 16, height: 16, cursor: 'pointer' }}
          />
          <span style={{ fontSize: 13, color: '#374151' }}>
            <b>Önizleme modu</b> — kaydetmeden sonucu gör
          </span>
        </label>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={startGeneration}
            disabled={running}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 24px', borderRadius: 12, border: 'none',
              background: running ? '#e5e7eb' : 'linear-gradient(135deg,#6366f1,#8b5cf6)',
              color: running ? '#9ca3af' : '#fff',
              fontWeight: 700, fontSize: 14, cursor: running ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {running ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Sparkles size={16} />}
            {running ? 'Oluşturuluyor…' : 'AI ile Oluştur'}
          </button>

          {jobStatus && !running && (
            <button
              onClick={reset}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '10px 18px', borderRadius: 12,
                border: '1px solid #d1d5db', background: '#fff',
                color: '#374151', fontWeight: 600, fontSize: 14, cursor: 'pointer',
              }}
            >
              <RefreshCw size={14} /> Sıfırla
            </button>
          )}
        </div>
      </div>

      {/* Status bar */}
      {jobStatus && statusMeta && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 20px', borderRadius: 12,
          background: statusMeta.color + '12', border: `1px solid ${statusMeta.color}30`,
          marginBottom: 20,
        }}>
          {running
            ? <Loader2 size={18} color={statusMeta.color} style={{ animation: 'spin 1s linear infinite' }} />
            : <statusMeta.icon size={18} color={statusMeta.color} />
          }
          <span style={{ fontWeight: 600, color: statusMeta.color }}>{statusMeta.label}</span>
          {jobId && <span style={{ fontSize: 12, color: '#9ca3af', fontFamily: 'monospace' }}>#{jobId.slice(-8)}</span>}
          {jobStatus.durationMs && <span style={{ fontSize: 12, color: '#9ca3af' }}>{(jobStatus.durationMs / 1000).toFixed(1)}s</span>}
          {running && <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 'auto' }}>Her 2.5sn güncelleniyor…</span>}
        </div>
      )}

      {/* Error */}
      {jobStatus?.status === 'failed' && jobStatus?.error && (
        <div style={{
          background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12,
          padding: '14px 18px', color: '#dc2626', fontSize: 14, marginBottom: 20,
        }}>
          <AlertTriangle size={14} style={{ display: 'inline', marginRight: 6 }} />
          {jobStatus.error}
        </div>
      )}

      {/* Result */}
      {jobStatus?.status === 'done' && result && (
        <div style={{
          background: '#fff', borderRadius: 16, border: '1px solid #e5e7eb',
          boxShadow: '0 4px 24px -12px rgba(15,23,42,0.08)',
          overflow: 'hidden',
        }}>
          {/* Result header */}
          <div style={{
            padding: '18px 24px', borderBottom: '1px solid #e5e7eb',
            background: '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
          }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#111827', display: 'flex', alignItems: 'center', gap: 8 }}>
                <CheckCircle2 size={18} color="#10b981" />
                {TR_MONTHS[month - 1]} {year} çizelgesi
                {dryRun && <span style={{ fontSize: 11, background: '#fef9c3', color: '#92400e', padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>ÖNİZLEME</span>}
              </div>
              <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
                {assignments.length} atama · {new Set(assignments.map((a) => a.personId)).size} kişi
                {result.generatedId && !dryRun && (
                  <span style={{ marginLeft: 8, color: '#10b981', fontWeight: 600 }}>✓ Kaydedildi</span>
                )}
              </div>
            </div>
            {quality && <QualityBadge quality={quality} />}
          </div>

          {/* Issues */}
          <div style={{ padding: '16px 24px' }}>
            <IssueList issues={issues} />
            <AssignmentTable assignments={assignments} />
          </div>

          {dryRun && (
            <div style={{ padding: '16px 24px', borderTop: '1px solid #e5e7eb', background: '#fafbff' }}>
              <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
                Bu bir önizlemedir. Gerçekten oluşturmak için önizleme modunu kapatın ve tekrar çalıştırın.
              </p>
              <button
                onClick={() => { setDryRun(false); reset(); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '9px 20px', borderRadius: 10, border: 'none',
                  background: '#6366f1', color: '#fff',
                  fontWeight: 700, fontSize: 13, cursor: 'pointer',
                }}
              >
                <ChevronRight size={14} /> Gerçek Oluşturmaya Geç
              </button>
            </div>
          )}
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
