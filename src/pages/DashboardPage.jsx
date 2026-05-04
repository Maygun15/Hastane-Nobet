// src/pages/DashboardPage.jsx
// Dashboard: yaklaşan nöbetler, özet istatistikler, son talepler, AI önerileri
import React, { useEffect, useState, useCallback } from 'react';
import {
  Activity, AlertTriangle, Calendar, CheckCircle2,
  ClipboardList, Sparkles, Users, TrendingUp,
} from 'lucide-react';
import { http } from '../lib/api.js';
import { useAuth } from '../auth/AuthContext.jsx';

const TR_MONTHS = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];

function fmt(d) {
  const dt = new Date(d);
  return `${dt.getDate()} ${TR_MONTHS[dt.getMonth()]}`;
}

function StatCard({ icon: Icon, label, value, sub, color = '#6366f1', loading }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 16, padding: '20px 24px',
      border: '1px solid #e5e7eb',
      boxShadow: '0 4px 24px -12px rgba(15,23,42,0.1)',
      display: 'flex', alignItems: 'flex-start', gap: 16,
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 12,
        background: color + '18', display: 'flex',
        alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Icon size={22} color={color} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: 26, fontWeight: 700, color: '#111827', lineHeight: 1 }}>
          {loading ? <span style={{ display: 'inline-block', width: 48, height: 26, background: '#f3f4f6', borderRadius: 6 }} /> : value}
        </div>
        {sub && <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>{sub}</div>}
      </div>
    </div>
  );
}

function ShiftRow({ date, shiftId, serviceName, personName }) {
  const d = new Date(date + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysLeft = Math.round((d - today) / 86400000);
  const badge = daysLeft === 0 ? { label: 'Bugün', color: '#ef4444' }
    : daysLeft === 1 ? { label: 'Yarın', color: '#f59e0b' }
    : { label: `${daysLeft}g`, color: '#6366f1' };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 0', borderBottom: '1px solid #f3f4f6',
    }}>
      <div style={{
        width: 48, textAlign: 'center', flexShrink: 0,
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#111827' }}>{d.getDate()}</div>
        <div style={{ fontSize: 11, color: '#9ca3af' }}>{TR_MONTHS[d.getMonth()].slice(0,3)}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 2 }}>
          {shiftId} {serviceName ? `— ${serviceName}` : ''}
        </div>
        {personName && <div style={{ fontSize: 12, color: '#6b7280' }}>{personName}</div>}
      </div>
      <span style={{
        background: badge.color + '18', color: badge.color,
        fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 20,
      }}>{badge.label}</span>
    </div>
  );
}

function QualityGauge({ score }) {
  const color = score >= 80 ? '#10b981' : score >= 55 ? '#f59e0b' : '#ef4444';
  const label = score >= 80 ? 'Mükemmel' : score >= 55 ? 'Orta' : 'Düşük';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <div style={{
        position: 'relative', width: 72, height: 72,
      }}>
        <svg viewBox="0 0 36 36" style={{ width: 72, height: 72, transform: 'rotate(-90deg)' }}>
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="#f3f4f6" strokeWidth="3" />
          <circle
            cx="18" cy="18" r="15.9" fill="none"
            stroke={color} strokeWidth="3"
            strokeDasharray={`${score} 100`}
            strokeLinecap="round"
          />
        </svg>
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 700, color: '#111827',
        }}>{score}</div>
      </div>
      <div>
        <div style={{ fontWeight: 600, fontSize: 15, color: '#111827' }}>{label}</div>
        <div style={{ fontSize: 12, color: '#6b7280' }}>Çizelge kalite puanı</div>
      </div>
    </div>
  );
}

export default function DashboardPage({ activeYM, peopleAll = [], onGoSchedules, onGoAI }) {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [upcomingShifts, setUpcomingShifts] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [lastQuality, setLastQuality] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);

  const [year, month] = activeYM ? activeYM.split('-').map(Number) : [new Date().getFullYear(), new Date().getMonth() + 1];
  const monthLabel = `${TR_MONTHS[(month || 1) - 1]} ${year}`;

  const loadDashboard = useCallback(async () => {
    setLoadingStats(true);
    try {
      const [schedRes, reqRes] = await Promise.allSettled([
        http.get(`/api/schedules?year=${year}&month=${month}&size=1`),
        http.get(`/api/requests?status=pending&size=5`),
      ]);

      // Stats
      const schedData = schedRes.status === 'fulfilled' ? schedRes.value : null;
      const assignments = schedData?.data?.assignments || schedData?.assignments || [];
      const issues = schedData?.data?.issues || schedData?.issues || [];
      const totalStaff = new Set(assignments.map((a) => String(a.personId || a.personName))).size;
      const totalShifts = assignments.length;
      const unfilledSlots = issues.filter((i) => Number(i?.missing || 0) > 0).reduce((s, i) => s + Number(i.missing), 0);

      setStats({ totalStaff, totalShifts, unfilledSlots });

      // Quality from last generated schedule
      if (schedData?.quality) setLastQuality(schedData.quality);

      // Upcoming shifts for current user (next 7 days)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const cutoff = new Date(today);
      cutoff.setDate(cutoff.getDate() + 14);
      const myId = String(user?._id || user?.id || '');
      const myName = String(user?.name || user?.email || '').toLowerCase();
      const upcoming = assignments
        .filter((a) => {
          const d = new Date((a.date || a.day || '') + 'T00:00:00');
          if (isNaN(d.getTime()) || d < today || d > cutoff) return false;
          return String(a.personId || '').includes(myId) || String(a.personName || '').toLowerCase().includes(myName);
        })
        .sort((a, b) => (a.date || a.day || '') < (b.date || b.day || '') ? -1 : 1)
        .slice(0, 6);
      setUpcomingShifts(upcoming);

      // Pending requests
      const reqData = reqRes.status === 'fulfilled' ? reqRes.value : null;
      const reqs = reqData?.items || reqData?.data || [];
      setPendingRequests(reqs.slice(0, 5));
    } catch (err) {
      console.warn('Dashboard load error:', err?.message || err);
    } finally {
      setLoadingStats(false);
    }
  }, [year, month, user]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', marginBottom: 4 }}>
          Gösterge Paneli
        </h1>
        <p style={{ fontSize: 14, color: '#6b7280' }}>{monthLabel} · {peopleAll.length} kişi</p>
      </div>

      {/* Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 16, marginBottom: 28 }}>
        <StatCard icon={Users} label="Aktif Personel" value={peopleAll.length || '—'} sub="Bu ay" color="#6366f1" loading={loadingStats} />
        <StatCard icon={Calendar} label="Toplam Atama" value={stats?.totalShifts ?? '—'} sub={monthLabel} color="#10b981" loading={loadingStats} />
        <StatCard icon={AlertTriangle} label="Eksik Slot" value={stats?.unfilledSlots ?? '—'} sub="Doldurulmayan" color={stats?.unfilledSlots > 0 ? '#ef4444' : '#10b981'} loading={loadingStats} />
        <StatCard icon={Activity} label="Çizelge" value={loadingStats ? '—' : (stats?.totalShifts > 0 ? 'Hazır' : 'Boş')} sub="Bu ay" color="#f59e0b" loading={loadingStats} />
      </div>

      {/* Main grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

        {/* Upcoming shifts */}
        <div style={{
          background: '#fff', borderRadius: 16, border: '1px solid #e5e7eb',
          boxShadow: '0 4px 24px -12px rgba(15,23,42,0.08)', padding: '20px 24px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: '#111827', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Calendar size={16} color="#6366f1" /> Yaklaşan Nöbetlerim
            </h2>
            <button onClick={onGoSchedules} style={{ fontSize: 12, color: '#6366f1', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
              Tümünü gör →
            </button>
          </div>
          {upcomingShifts.length === 0 ? (
            <div style={{ color: '#9ca3af', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
              {loadingStats ? 'Yükleniyor…' : 'Yaklaşan nöbet bulunamadı'}
            </div>
          ) : upcomingShifts.map((a, i) => (
            <ShiftRow
              key={i}
              date={a.date || a.day}
              shiftId={a.shiftId || a.shiftCode || '—'}
              serviceName={a.serviceName || ''}
              personName={a.personName || ''}
            />
          ))}
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Quality score */}
          {lastQuality && (
            <div style={{
              background: '#fff', borderRadius: 16, border: '1px solid #e5e7eb',
              boxShadow: '0 4px 24px -12px rgba(15,23,42,0.08)', padding: '20px 24px',
            }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: '#111827', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <TrendingUp size={16} color="#10b981" /> Çizelge Kalitesi
              </h2>
              <QualityGauge score={lastQuality.score || 0} />
              <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12, color: '#6b7280' }}>
                <span>Doluluk: <b style={{ color: '#111827' }}>{lastQuality.coverage}%</b></span>
                <span>Adalet: <b style={{ color: '#111827' }}>{lastQuality.fairness}%</b></span>
              </div>
            </div>
          )}

          {/* AI quick actions */}
          <div style={{
            background: 'linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%)',
            borderRadius: 16, padding: '20px 24px', color: '#fff',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Sparkles size={18} />
              <span style={{ fontWeight: 700, fontSize: 15 }}>AI Asistan</span>
            </div>
            <p style={{ fontSize: 13, opacity: 0.85, marginBottom: 16, lineHeight: 1.5 }}>
              Türkçe komutla nöbet atayın, izin ekleyin veya çizelge sorgulayın.
            </p>
            <button
              onClick={onGoAI}
              style={{
                background: '#fff', color: '#6366f1', border: 'none',
                borderRadius: 10, padding: '8px 18px', fontWeight: 700,
                fontSize: 13, cursor: 'pointer',
              }}
            >
              Asistanı Aç →
            </button>
          </div>

          {/* Pending requests */}
          {pendingRequests.length > 0 && (
            <div style={{
              background: '#fff', borderRadius: 16, border: '1px solid #e5e7eb',
              boxShadow: '0 4px 24px -12px rgba(15,23,42,0.08)', padding: '20px 24px',
            }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: '#111827', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <ClipboardList size={16} color="#f59e0b" /> Bekleyen Talepler
              </h2>
              {pendingRequests.map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
                  <CheckCircle2 size={14} color="#f59e0b" />
                  <span style={{ fontSize: 13, color: '#374151', flex: 1 }}>
                    {r.personName || r.requesterName || 'Bilinmiyor'} · {r.type || r.requestType || '—'}
                  </span>
                  <span style={{ fontSize: 11, color: '#9ca3af' }}>
                    {r.createdAt ? fmt(r.createdAt) : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
