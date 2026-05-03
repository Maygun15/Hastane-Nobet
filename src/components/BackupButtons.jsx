// src/components/BackupButtons.jsx
import React, { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { downloadBackup, restoreFromFile } from '../lib/backup.js';

export default function BackupButtons({ compact = false }) {
  const fileRef = useRef(null);
  const [msg, setMsg] = useState('');

  async function handleExport() {
    try {
      downloadBackup('hns_yedek');
      setMsg('Yedek indirildi');
      setTimeout(() => setMsg(''), 2000);
    } catch (e) {
      setMsg('Yedek indirilemedi: ' + e.message);
    }
  }

  async function handleFileChange(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const keys = await restoreFromFile(f);
      setMsg(`Yedekten yüklendi (${keys.length} anahtar). Sayfa yenileniyor…`);
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      setMsg('Yükleme başarısız: ' + e.message);
    } finally {
      e.target.value = ''; // aynı dosyayı tekrar seçebilmek için
    }
  }

  function triggerImport() {
    fileRef.current?.click();
  }

  const btnCls = compact
    ? 'inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-100 transition-colors'
    : 'inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 transition-colors';

  return (
    <div className={`flex flex-wrap items-center gap-2 ${compact ? "justify-end" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <button className={btnCls} onClick={handleExport}>
          <Download className="h-4 w-4" />
          Yedeği İndir
        </button>
        <button className={btnCls} onClick={triggerImport}>
          <Upload className="h-4 w-4" />
          Yedekten Yükle
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>
      {msg && <div className="text-xs text-slate-500">{msg}</div>}
    </div>
  );
}
