// src/pages/AICostPage.jsx — AI Maliyet İzleme Dashboard (admin)
import React, { useEffect, useState, useCallback } from 'react';
import { Activity, AlertTriangle, Bot, Clock, RefreshCw, TrendingUp, Zap } from 'lucide-react';
import { http } from '../lib/api.js';

const USD_SIGN = '$';
const FMT_USD = (v) => v == null ? '—' : `${USD_SIGN}${Number(v).toFixed(4)}`;
const FMT_NUM = (v) => v == null ? '—' : Number(v).toLocaleString('tr-TR');

function StatCard({ icon: Icon, label, value, sub, color = '#6366f1' }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 14, padding: '18px 22px',
      border: '1px solid #e5e7eb', boxShadow: '0 2px 16px -8px rgba(15,23,42,.08)',
      display: 'flex', alignItems: 'flex-start', gap: 14,
    }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={20} color={color} />
      </div>
      <div>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 3 }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#111827', lineHeight: 1 }}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3 }}>{sub}</div>}
      </div>
    </div>
  );
}

// Mini bar chart — pure CSS/inline SVG
function BarChart({ data = [], valueKey, labelKey, color = '#6366f1', height = 120 }) {
  const max = Math.max(...data.map((d) => d[valueKey] || 0), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height, paddingTop: 8 }}>
      {data.map((d, i) => {
        const pct = ((d[valueKey] || 0) / max) * 100;
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div title={`${d[labelKey]}: ${d[valueKey]}`} style={{
              width: '100%', background: color, borderRadius: '4px 4px 0 0',
              height: `${Math.max(pct, 2)}%`, transition: 'height 0.3s',
              minHeight: 3,
            }} />
            <span style={{ fontSize: 9, color: '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: '100%', textOverflow: 'ellipsis' }}>
              {d[labelKey]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ModelRow({ model, calls, tokens, cost }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #f3f4f6' }}>
      <div style={{ flex: 2, fontSize: 13, fontWeight: 600, color: '#374151', fontFamily: 'monospace' }}>{model || 'bilinmiyor'}</div>
      <div style={{ flex: 1, fontSize: 13, color: '#6b7280', textAlign: 'right' }}>{FMT_NUM(calls)} istek</div>
      <div style={{ flex: 1, fontSize: 13, color: '#6b7280', textAlign: 'right' }}>{FMT_NUM(tokens)} token</div>
      <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: '#111827', textAlign: 'right' }}>{FMT_USD(cost)}</div>
    </div>
  );
}

export default function AICostPage() {
  const [summary, setSummary] = useState(null);
  const [byDay, setByDay] = useState([]);
  const [byModel, setByModel] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [period, setPeriod] = useState('30d');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, dailyRes] = await Promise.all([
        http.get('/api/ai/cost-summary'),
        http.get('/api/ai/cost-daily').catch(() => null),
      ]);

      if (summaryRes?.summary) {
        setSummary(summaryRes.summary);
      }
      if (Array.isArray(dailyRes?.data)) {
        setByDay(dailyRes.data);
      }
      if (Array.isArray(summaryRes?.byModel)) {
        setByModel(summaryRes.byModel);
      } else if (summaryRes?.summary) {
        // Tek model varsa tek row göster
        const s = summaryRes.summary;
        if (s.calls) setByModel([{ model: '—', calls: s.calls, totalTokens: s.totalTokens, costUsd: s.costUsd }]);
      }
    } catch (e) {
      setError(e?.data?.message || e?.message || 'Veri yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const s = summary || {};

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Bot size={20} color="#6366f1" /> AI Maliyet İzleme
          </h1>
          <p style={{ fontSize: 13, color: '#6b7280' }}>Son 30 gün · Token kullanımı ve USD maliyeti</p>
        </div>
        <button onClick={load} disabled={loading} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
          borderRadius: 10, border: '1px solid #d1d5db', background: '#fff',
          color: '#374151', fontSize: 13, fontWeight: 600, cursor: 'pointer',
        }}>
          <RefreshCw size={14} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
          Yenile
        </button>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 16px', color: '#dc2626', fontSize: 13, marginBottom: 20, display: 'flex', gap: 8 }}>
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14, marginBottom: 24 }}>
        <StatCard icon={Activity} label="Toplam İstek" value={loading ? '…' : FMT_NUM(s.calls)} sub="30 gün" color="#6366f1" />
        <StatCard icon={Zap} label="Toplam Token" value={loading ? '…' : FMT_NUM(s.totalTokens)} sub={`${FMT_NUM(s.promptTokens)} prompt + ${FMT_NUM(s.completionTokens)} completion`} color="#8b5cf6" />
        <StatCard icon={TrendingUp} label="Toplam Maliyet" value={loading ? '…' : FMT_USD(s.costUsd)} sub="USD" color="#10b981" />
        <StatCard icon={Clock} label="Hata Oranı" value={loading ? '…' : s.calls ? `${((s.errors || 0) / s.calls * 100).toFixed(1)}%` : '—'} sub={`${FMT_NUM(s.errors)} hata`} color={s.errors > 0 ? '#ef4444' : '#10b981'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 20 }}>
        {/* Günlük trend */}
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e5e7eb', padding: '18px 22px', boxShadow: '0 2px 16px -8px rgba(15,23,42,.08)' }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 4 }}>Günlük Token Trendi</h3>
          <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: 12 }}>Son 30 gün</p>
          {byDay.length > 0 ? (
            <BarChart data={byDay} valueKey="totalTokens" labelKey="date" color="#6366f1" height={130} />
          ) : (
            <div style={{ height: 130, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#d1d5db', fontSize: 13 }}>
              {loading ? 'Yükleniyor…' : 'Günlük veri yok (endpoint mevcut değil)'}
            </div>
          )}
        </div>

        {/* Günlük maliyet */}
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e5e7eb', padding: '18px 22px', boxShadow: '0 2px 16px -8px rgba(15,23,42,.08)' }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 4 }}>Günlük Maliyet Trendi</h3>
          <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: 12 }}>USD · Son 30 gün</p>
          {byDay.length > 0 ? (
            <BarChart data={byDay} valueKey="costUsd" labelKey="date" color="#10b981" height={130} />
          ) : (
            <div style={{ height: 130, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#d1d5db', fontSize: 13 }}>
              {loading ? 'Yükleniyor…' : 'Günlük veri yok'}
            </div>
          )}
        </div>
      </div>

      {/* Model breakdown */}
      <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e5e7eb', padding: '18px 22px', boxShadow: '0 2px 16px -8px rgba(15,23,42,.08)' }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 14 }}>Model Bazlı Dağılım</h3>
        {byModel.length === 0 ? (
          <div style={{ color: '#9ca3af', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
            {loading ? 'Yükleniyor…' : 'Veri yok'}
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', padding: '0 0 6px', borderBottom: '1px solid #e5e7eb', fontSize: 11, color: '#9ca3af', fontWeight: 600 }}>
              <span style={{ flex: 2 }}>MODEL</span>
              <span style={{ flex: 1, textAlign: 'right' }}>İSTEK</span>
              <span style={{ flex: 1, textAlign: 'right' }}>TOKEN</span>
              <span style={{ flex: 1, textAlign: 'right' }}>MALİYET</span>
            </div>
            {byModel.map((m, i) => (
              <ModelRow key={i} model={m.model} calls={m.calls} tokens={m.totalTokens} cost={m.costUsd} />
            ))}
          </>
        )}
      </div>

      <style>{`@keyframes spin { from { transform:rotate(0) } to { transform:rotate(360deg) } }`}</style>
    </div>
  );
}
