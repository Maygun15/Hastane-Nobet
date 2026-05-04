// src/components/FloatingAIChat.jsx
// Floating AI Chat button + slide-out panel — accessible from any tab
import React, { useState, useEffect, useRef } from 'react';
import AIChatPanel from './AIChatPanel.jsx';

export default function FloatingAIChat({ activeYM, serviceName }) {
  const [open, setOpen] = useState(false);
  const [pulse, setPulse] = useState(false);
  const panelRef = useRef(null);

  // Pulse once on mount to draw attention
  useEffect(() => {
    const t = setTimeout(() => setPulse(true), 2000);
    const t2 = setTimeout(() => setPulse(false), 4000);
    return () => { clearTimeout(t); clearTimeout(t2); };
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target) &&
          !e.target.closest('[data-ai-toggle]')) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <>
      {/* Floating Button */}
      <button
        data-ai-toggle
        onClick={() => setOpen((v) => !v)}
        title="AI Nöbet Asistanı"
        style={{
          position: 'fixed',
          bottom: 28,
          right: 28,
          zIndex: 9999,
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: open ? '#4f46e5' : '#6366f1',
          border: 'none',
          boxShadow: '0 8px 32px -8px rgba(99,102,241,0.65)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 26,
          transition: 'all 0.2s',
          transform: open ? 'rotate(10deg) scale(1.05)' : pulse ? 'scale(1.12)' : 'scale(1)',
          outline: pulse && !open ? '3px solid rgba(99,102,241,0.35)' : 'none',
        }}
      >
        {open ? '✕' : '🤖'}
      </button>

      {/* Slide-out panel */}
      <div
        ref={panelRef}
        style={{
          position: 'fixed',
          right: 0,
          bottom: 0,
          top: 0,
          width: 400,
          maxWidth: '92vw',
          zIndex: 9998,
          transform: open ? 'translateX(0)' : 'translateX(110%)',
          transition: 'transform 0.28s cubic-bezier(0.32,0,0,1)',
          boxShadow: '-8px 0 48px -16px rgba(15,23,42,0.22)',
          background: '#fff',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#f9fafb',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>🤖</span>
            <span style={{ fontWeight: 700, fontSize: 15, color: '#111827' }}>AI Nöbet Asistanı</span>
          </div>
          <button
            onClick={() => setOpen(false)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 18, color: '#6b7280', padding: '4px 8px', borderRadius: 8,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'hidden' }}>
          <AIChatPanel
            activeYM={activeYM}
            serviceName={serviceName}
            style={{ height: '100%', borderRadius: 0, border: 'none' }}
          />
        </div>
      </div>

      {/* Backdrop for mobile */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9997,
            background: 'rgba(15,23,42,0.25)',
            display: window.innerWidth < 640 ? 'block' : 'none',
          }}
        />
      )}
    </>
  );
}
