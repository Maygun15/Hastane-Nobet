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
        aria-label={open ? "AI Asistanı kapat" : "AI Asistanı aç"}
        title={open ? "Kapat" : "AI Asistan"}
        className="fixed bottom-7 right-7 z-[9998] w-14 h-14 rounded-full border-none cursor-pointer flex items-center justify-center text-[26px] transition-all duration-200"
        style={{
          background: open ? '#4f46e5' : '#6366f1',
          boxShadow: '0 8px 32px -8px rgba(99,102,241,0.65)',
          transform: open ? 'rotate(10deg) scale(1.05)' : pulse ? 'scale(1.12)' : 'scale(1)',
          outline: pulse && !open ? '3px solid rgba(99,102,241,0.35)' : 'none',
        }}
      >
        {open ? '✕' : '🤖'}
      </button>

      {/* Slide-out panel */}
      <div
        ref={panelRef}
        className="fixed right-0 bottom-0 top-0 z-[9999] w-full md:w-[400px] max-w-[95vw] flex flex-col bg-white"
        style={{
          transform: open ? 'translateX(0)' : 'translateX(110%)',
          transition: 'transform 0.28s cubic-bezier(0.32,0,0,1)',
          boxShadow: '-8px 0 48px -16px rgba(15,23,42,0.22)',
        }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2">
            <span className="text-[20px]">🤖</span>
            <span className="font-bold text-[15px] text-slate-900">AI Nöbet Asistanı</span>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="bg-transparent border-none cursor-pointer text-[18px] text-slate-500 px-2 py-1 rounded-lg hover:bg-slate-100"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-hidden">
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
          className="fixed inset-0 z-[9997] bg-slate-900/25 sm:hidden"
        />
      )}
    </>
  );
}
