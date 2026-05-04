// src/hooks/useSSENotifications.js — SSE bağlantısı + callback
import { useEffect, useRef } from 'react';
import { getToken } from '../lib/api.js';

export default function useSSENotifications(onNotification) {
  const cbRef = useRef(onNotification);
  cbRef.current = onNotification;

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    // EventSource doesn't support Authorization header natively.
    // Backend auth uses cookie or query token fallback.
    const url = `/api/notifications/stream`;
    let es;
    try {
      es = new EventSource(url, { withCredentials: true });
    } catch {
      return;
    }

    es.addEventListener('notification', (e) => {
      try {
        const data = JSON.parse(e.data || '{}');
        cbRef.current?.(data);
      } catch {}
    });

    es.onerror = () => {
      // auto-reconnect handled by browser; suppress console noise
    };

    return () => { try { es.close(); } catch {} };
  }, []); // mount once per session
}
