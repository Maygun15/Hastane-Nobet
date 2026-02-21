// src/lib/backup.js
// Tek JSON'a export + JSON'dan import (LS tabanlı)

const APP_KEY = 'HNS'; // Hastane Nöbet Sistemi kısaltması

// Geriye dönük anahtarlar dahil — sende olanları listeledim, yoksa otomatik atlar.
export const LS_KEYS = [
  // kişiler & alanlar & vardiya şablonları
  'people', 'areas', 'shifts',

  // servisler
  'services',

  // kurallar
  'dutyRules',

  // izinler (v2 öncelikli, eski adlar fallback)
  'personLeavesV2', 'personLeaves', 'allLeaves',

  // aktif yıl/ay ve takvimle ilgili muhtemel anahtarlar
  'activeYM', 'plannerYear', 'plannerMonth',

  // çizelge/plan çıktıları veya cache'ler (varsa)
  'rosterCache', 'scheduleState', 'overtimeState'
];

// küçük yardımcılar
function nowIso() { return new Date().toISOString(); }
function safeParse(raw, fallback = null) { try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } }
function fmtFileDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

export function collectLocalStorage(keys = LS_KEYS) {
  const items = {};
  keys.forEach((k) => {
    const raw = localStorage.getItem(k);
    if (!raw) return;
    const val = safeParse(raw, null);
    if (val !== null && val !== undefined) items[k] = val;
  });
  return items;
}

export function makeBackupPayload() {
  const items = collectLocalStorage();
  return {
    schema: 'hns.backup.v1',
    createdAt: nowIso(),
    app: { name: 'Hastane Nöbet Sistemi', key: APP_KEY, version: '1.0' },
    items
  };
}

export function makeBackupBlob(payload) {
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}

export function downloadBackup(filenamePrefix = 'yedek') {
  const payload = makeBackupPayload();
  const blob = makeBackupBlob(payload);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const ts = fmtFileDate();
  a.href = url;
  a.download = `${filenamePrefix}_${ts}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return payload;
}

export async function restoreFromObject(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('Geçersiz yedek dosyası');
  const items = obj.items || obj; // obj.items yoksa düz obje kabul et
  if (!items || typeof items !== 'object') throw new Error('Yedekte items bulunamadı');

  // mevcut LS'yi temizlemek istersen uncomment:
  // localStorage.clear();

  for (const [k, v] of Object.entries(items)) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
  }

  // Değişimi dinleyen bileşenlere sinyal
  try { window.dispatchEvent(new Event('data:restored')); } catch {}

  return Object.keys(items);
}

export function restoreFromFile(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('Dosya okunamadı'));
    fr.onload = () => {
      try {
        const json = JSON.parse(String(fr.result));
        restoreFromObject(json).then(resolve).catch(reject);
      } catch (e) {
        reject(new Error('JSON parse edilemedi'));
      }
    };
    fr.readAsText(file, 'utf-8');
  });
}
