// src/hooks/useSSENotifications.js — SSE bağlantısı + exponential backoff
import { useEffect, useRef } from 'react';
import { getToken } from '../lib/api.js';
import { getApiBase } from '../lib/apiConfig.js';

const MIN_RETRY_MS = 5_000;
const MAX_RETRY_MS = 60_000;

export default function useSSENotifications(onNotification) {
  const cbRef = useRef(onNotification);
  cbRef.current = onNotification;

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    let es = null;
    let retryTimer = null;
    let retryDelay = MIN_RETRY_MS;
    let alive = true;

    function connect() {
      if (!alive) return;
      const path = `/api/notifications/stream?token=${encodeURIComponent(token)}`;
      const apiBase = String(getApiBase?.() || '').replace(/\/+$/, '');
      const url = apiBase ? `${apiBase}${path}` : path;
      try {
        es = new EventSource(url);
      } catch {
        return;
      }

      es.addEventListener('connected', () => {
        retryDelay = MIN_RETRY_MS; // bağlantı kurulunca delay'i sıfırla
      });

      es.addEventListener('notification', (e) => {
        try {
          const data = JSON.parse(e.data || '{}');
          cbRef.current?.(data);
        } catch {}
      });

      es.onerror = () => {
        if (!alive) return;
        try { es.close(); } catch {}
        es = null;
        // Tarayıcının kendi retry mekanizması yerine bizim backoff'umuz devreye girer
        retryTimer = setTimeout(() => {
          retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
          connect();
        }, retryDelay);
      };
    }

    connect();

    return () => {
      alive = false;
      if (retryTimer) clearTimeout(retryTimer);
      try { es?.close(); } catch {}
    };
  }, []); // mount once per session
}
