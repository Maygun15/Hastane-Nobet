// src/components/BackupButtons.jsx
import React, { useRef, useState } from 'react';
import { downloadBackup, restoreFromFile } from '../lib/backup.js';

export default function BackupButtons({ compact = false }) {
  const fileRef = useRef(null);
  const [msg, setMsg] = useState('');

  async function handleExport() {
    try {
      downloadBackup('hns_yedek');
      setMsg('✅ Yedek indirildi');
      setTimeout(() => setMsg(''), 2000);
    } catch (e) {
      setMsg('❌ Yedek indirilemedi: ' + e.message);
    }
  }

  async function handleFileChange(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const keys = await restoreFromFile(f);
      setMsg(`✅ Yedekten yüklendi (${keys.length} anahtar) — sayfa yenileniyor…`);
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      setMsg('❌ Yükleme başarısız: ' + e.message);
    } finally {
      e.target.value = ''; // aynı dosyayı tekrar seçebilmek için
    }
  }

  function triggerImport() {
    fileRef.current?.click();
  }

  const btnCls = compact
    ? 'px-2 py-1 text-sm rounded bg-slate-100 hover:bg-slate-200'
    : 'px-3 py-2 text-sm rounded bg-slate-100 hover:bg-slate-200';

  return (
    <div className="flex items-center gap-8">
      <div className="flex items-center gap-8">
        <button className={btnCls} onClick={handleExport}>⬇️ Yedeği İndir</button>
        <button className={btnCls} onClick={triggerImport}>⬆️ Yedekten Yükle</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>
      {msg && <div className="text-xs text-slate-600">{msg}</div>}
    </div>
  );
}
