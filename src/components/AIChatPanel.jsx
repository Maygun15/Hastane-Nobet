// src/components/AIChatPanel.jsx
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { http } from '../lib/api.js';

const SESSION_KEY = 'ai_chat_session';

function genSessionId() {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getSessionId() {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) { id = genSessionId(); sessionStorage.setItem(SESSION_KEY, id); }
    return id;
  } catch { return genSessionId(); }
}

const INTENT_LABELS = {
  assign_shift:      'Vardiya Ata',
  remove_shift:      'Vardiya Kaldır',
  add_leave:         'İzin Ekle',
  remove_leave:      'İzin Sil',
  query_schedule:    'Çizelge Sorgula',
  query_person:      'Kişi Sorgula',
  swap_shifts:       'Vardiya Takas',
  generate_schedule: 'Çizelge Oluştur',
  unknown:           'Anlaşılamadı',
};

const INTENT_COLOR = {
  assign_shift:      '#3b82f6',
  remove_shift:      '#ef4444',
  add_leave:         '#f59e0b',
  remove_leave:      '#f97316',
  query_schedule:    '#10b981',
  query_person:      '#10b981',
  swap_shifts:       '#8b5cf6',
  generate_schedule: '#6366f1',
  unknown:           '#9ca3af',
};

/* ── Küçük yardımcı bileşenler ── */

function Bubble({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 8,
    }}>
      {!isUser && (
        <div style={{
          width: 28, height: 28, borderRadius: '50%', background: '#6366f1',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, color: '#fff', marginRight: 8, flexShrink: 0, alignSelf: 'flex-end',
        }}>🤖</div>
      )}
      <div style={{
        maxWidth: '78%',
        background: isUser ? '#6366f1' : '#f3f4f6',
        color: isUser ? '#fff' : '#1f2937',
        borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
        padding: '10px 14px',
        fontSize: 14,
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        {msg.content}
        {msg.meta && (
          <div style={{ marginTop: 6, fontSize: 11, opacity: 0.6 }}>
            {msg.meta.model} · {msg.meta.durationMs}ms
            {msg.meta.tokens && ` · ${msg.meta.tokens.total} token`}
          </div>
        )}
      </div>
    </div>
  );
}

function ConfirmCard({ parsed, onConfirm, onCancel, loading }) {
  const color  = INTENT_COLOR[parsed.intent] || '#6366f1';
  const label  = INTENT_LABELS[parsed.intent] || parsed.intent;
  const ents   = parsed.entities || {};

  return (
    <div style={{
      background: '#fff', border: `2px solid ${color}`,
      borderRadius: 12, padding: 16, margin: '8px 0',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{
          background: color, color: '#fff', borderRadius: 6,
          padding: '2px 8px', fontSize: 12, fontWeight: 600,
        }}>{label}</span>
        <span style={{ fontSize: 12, color: '#6b7280' }}>
          Güven: {Math.round((parsed.confidence || 0) * 100)}%
        </span>
      </div>

      <p style={{ margin: '0 0 10px', fontSize: 14, color: '#111827', fontWeight: 500 }}>
        {parsed.humanReadable}
      </p>

      {Object.entries(ents).filter(([, v]) => v).length > 0 && (
        <div style={{
          background: '#f9fafb', borderRadius: 8, padding: '8px 12px',
          marginBottom: 12, fontSize: 13,
        }}>
          {ents.person     && <div><b>Kişi:</b> {ents.person}</div>}
          {ents.date       && <div><b>Tarih:</b> {ents.date}</div>}
          {ents.dateStart  && <div><b>Başlangıç:</b> {ents.dateStart}</div>}
          {ents.dateEnd    && <div><b>Bitiş:</b> {ents.dateEnd}</div>}
          {ents.shiftCode  && <div><b>Vardiya:</b> {ents.shiftCode}{ents.shiftLabel ? ` (${ents.shiftLabel})` : ''}</div>}
          {ents.leaveType  && <div><b>İzin türü:</b> {ents.leaveType}</div>}
          {ents.serviceName && <div><b>Servis:</b> {ents.serviceName}</div>}
        </div>
      )}

      {Array.isArray(parsed.missingInfo) && parsed.missingInfo.length > 0 && (
        <div style={{
          background: '#fef9c3', borderRadius: 8, padding: '6px 12px',
          marginBottom: 10, fontSize: 12, color: '#92400e',
        }}>
          ⚠️ Eksik bilgi: {parsed.missingInfo.join(', ')}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onConfirm}
          disabled={loading || !parsed.canExecute}
          style={{
            flex: 1, padding: '8px 0', borderRadius: 8, border: 'none',
            background: parsed.canExecute ? color : '#d1d5db',
            color: '#fff', fontWeight: 600, fontSize: 14, cursor: parsed.canExecute ? 'pointer' : 'not-allowed',
          }}
        >
          {loading ? '⏳ İşleniyor…' : '✓ Onayla'}
        </button>
        <button
          onClick={onCancel}
          disabled={loading}
          style={{
            flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid #d1d5db',
            background: '#fff', color: '#374151', fontWeight: 500, fontSize: 14, cursor: 'pointer',
          }}
        >
          İptal
        </button>
      </div>
    </div>
  );
}

/* ── Ana bileşen ── */
export default function AIChatPanel({ activeYM, serviceName, style }) {
  const [messages, setMessages] = useState([
    {
      id: 0,
      role: 'assistant',
      content: 'Merhaba! Türkçe yazarak nöbet çizelgesini yönetebilirsiniz.\n\nÖrnek: "Ayşe Hanım\'ı 15 Mayıs gece nöbetinden çıkar" veya "Mehmet için 20-22 Mayıs yıllık izin ekle"',
    },
  ]);
  const [input, setInput]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [pending, setPending]     = useState(null); // { parsed, msgId }
  const [confirmLoading, setConfirmLoading] = useState(false);

  const bottomRef  = useRef(null);
  const inputRef   = useRef(null);
  const sessionId  = useRef(getSessionId());
  const msgCounter = useRef(1);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const addMsg = useCallback((role, content, extra = {}) => {
    const id = ++msgCounter.current;
    setMessages((prev) => [...prev, { id, role, content, ...extra }]);
    return id;
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setLoading(true);
    setPending(null);

    addMsg('user', text);

    try {
      const data = await http.post('/api/ai/parse-command', {
        text,
        sessionId: sessionId.current,
        context: { activeYM, serviceName },
      });

      const parsed = data?.data;
      if (!parsed) throw new Error('Geçersiz AI yanıtı');

      const msgId = addMsg('assistant', parsed.humanReadable || 'Komut analiz edildi.', {
        meta: parsed._meta,
      });

      if (parsed.intent !== 'unknown' && parsed.confidence >= 0.6) {
        setPending({ parsed, msgId });
      } else if (parsed.intent === 'unknown' || parsed.confidence < 0.6) {
        addMsg('assistant', 'Komutu anlayamadım. Lütfen daha açık yazın.\nÖrnek: "Ahmet\'i 10 Haziran gece nöbetinden çıkar"');
      }
    } catch (err) {
      const msg = err?.data?.message || err?.message || 'AI servisi yanıt vermedi.';
      addMsg('assistant', `⚠️ ${msg}\n\nLütfen manuel olarak işlem yapın veya tekrar deneyin.`);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, loading, addMsg, activeYM, serviceName]);

  const handleConfirm = useCallback(async () => {
    if (!pending) return;
    setConfirmLoading(true);
    try {
      const result = await http.post('/api/ai/confirm-action', {
        intent:    pending.parsed.intent,
        entities:  pending.parsed.entities,
        sessionId: sessionId.current,
      });

      const r = result?.result;
      if (r?.ok) {
        addMsg('assistant', `✅ ${r.humanReadable || 'İşlem tamamlandı.'}`);
        if (r.data?.length >= 0) {
          const lines = (r.data || []).slice(0, 5).map((a) =>
            `• ${a.personName || a.person || '?'} — ${a.date || a.day || ''} ${a.shiftId || a.shiftCode || ''}`
          ).join('\n');
          if (lines) addMsg('assistant', lines);
        }
      } else if (r?.requiresManual) {
        addMsg('assistant', `ℹ️ ${r.message}\n\nİpucu: Çizelge ekranından manuel atama yapabilirsiniz.`);
      } else {
        addMsg('assistant', `❌ ${r?.message || 'İşlem başarısız.'}`);
      }
    } catch (err) {
      addMsg('assistant', `⚠️ İşlem sırasında hata: ${err?.message || 'Bilinmeyen hata'}`);
    } finally {
      setConfirmLoading(false);
      setPending(null);
    }
  }, [pending, addMsg]);

  const handleCancel = useCallback(() => {
    setPending(null);
    addMsg('assistant', 'İşlem iptal edildi.');
  }, [addMsg]);

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100%', minHeight: 400,
      background: '#fff', borderRadius: 12,
      border: '1px solid #e5e7eb',
      overflow: 'hidden',
      ...style,
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid #e5e7eb',
        background: '#f9fafb', display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%', background: '#6366f1',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
        }}>🤖</div>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, color: '#111827' }}>AI Nöbet Asistanı</div>
          <div style={{ fontSize: 11, color: '#6b7280' }}>Türkçe komutla çizelge yönetimi</div>
        </div>
      </div>

      {/* Mesajlar */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '16px 12px',
        display: 'flex', flexDirection: 'column',
      }}>
        {messages.map((msg) => (
          <React.Fragment key={msg.id}>
            <Bubble msg={msg} />
            {pending?.msgId === msg.id && (
              <ConfirmCard
                parsed={pending.parsed}
                onConfirm={handleConfirm}
                onCancel={handleCancel}
                loading={confirmLoading}
              />
            )}
          </React.Fragment>
        ))}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', background: '#6366f1',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#fff',
            }}>🤖</div>
            <div style={{
              background: '#f3f4f6', borderRadius: '18px 18px 18px 4px',
              padding: '10px 16px', fontSize: 20, color: '#6b7280',
            }}>
              <span className="ai-typing">···</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: '10px 12px', borderTop: '1px solid #e5e7eb',
        display: 'flex', gap: 8, background: '#fff',
      }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder='Türkçe komut yazın… ("Ayşe\'yi 15 Mayıs gecesinden çıkar")'
          rows={2}
          disabled={loading}
          style={{
            flex: 1, resize: 'none', border: '1px solid #d1d5db',
            borderRadius: 10, padding: '8px 12px', fontSize: 14,
            fontFamily: 'inherit', outline: 'none', lineHeight: 1.5,
            background: loading ? '#f9fafb' : '#fff',
          }}
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          style={{
            padding: '0 18px', borderRadius: 10, border: 'none',
            background: loading || !input.trim() ? '#e5e7eb' : '#6366f1',
            color: '#fff', fontWeight: 600, fontSize: 14, cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
            alignSelf: 'stretch',
          }}
        >
          Gönder
        </button>
      </div>
    </div>
  );
}
