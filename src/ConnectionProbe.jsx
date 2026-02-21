// src/ConnectionProbe.jsx
import React, { useState } from 'react';
import { apiHealth, API } from './lib/api';

export default function ConnectionProbe() {
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);

  async function handleTest() {
    setRes(null);
    setErr(null);
    try {
      const data = await apiHealth();
      setRes(data);
      console.log('[health]', data);
    } catch (e) {
      setErr(String(e));
      console.error('[health:error]', e);
    }
  }

  return (
    <div style={{
      padding: '12px',
      border: '1px solid #e5e7eb',
      borderRadius: 8,
      background: '#fff',
      maxWidth: 400
    }}>
      <div style={{ fontSize: 12, marginBottom: 8 }}>
        API_BASE: <b>{API.base}</b>
      </div>

      <button
        onClick={handleTest}
        style={{
          padding: '8px 12px',
          background: '#4f46e5',
          color: '#fff',
          borderRadius: 6,
          border: 'none',
          cursor: 'pointer'
        }}
      >
        Bağlantıyı Test Et
      </button>

      {res && (
        <pre style={{
          marginTop: 8,
          fontSize: 12,
          background: '#f8fafc',
          padding: 8,
          borderRadius: 6,
          overflowX: 'auto'
        }}>
          {JSON.stringify(res, null, 2)}
        </pre>
      )}

      {err && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#b91c1c' }}>
          Hata: {err}
        </div>
      )}
    </div>
  );
}
