// src/utils/storage.js

/** Küçük yardımcılar */
export const pad2 = (n) => String(n).padStart(2, "0");

/** YYYY-MM anahtar üretimi (month: 1..12) */
export const ymKey = (y, m) => `${Number(y)}-${pad2(Number(m))}`;

/* Aktif yıl/ay için LS anahtarı — tek doğruluk kaynağı */
const LS_YM = "activeYM:v1";

/** LocalStorage'tan aktif yıl/ay okur. Yoksa null döner. */
export function readActiveYM() {
  try {
    const raw = localStorage.getItem(LS_YM);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !obj.year || !obj.month) return null;
    return { year: Number(obj.year), month: Number(obj.month) };
  } catch {
    return null;
  }
}

/** Aktif yıl/ayı LocalStorage'a yazar (ay 1..12 aralığına sıkıştırılır). */
export function writeActiveYM(year, month) {
  try {
    const y = Number(year);
    const m = Math.min(12, Math.max(1, Number(month)));
    localStorage.setItem(LS_YM, JSON.stringify({ year: y, month: m }));
  } catch {
    /* no-op */
  }
}

/**
 * 3 aydan eski monthlyHoursSheet verilerini localStorage'dan temizler.
 * Uygulama başlangıcında bir kez çağrılır.
 */
export function pruneOldMonthlySheets(keepMonths = 3) {
  try {
    const now = new Date();
    const cutoff = new Date(now.getFullYear(), now.getMonth() - keepMonths, 1);
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const match = key.match(/^monthlyHoursSheet\/(\d{4})-(\d{2})$/);
      if (!match) continue;
      const keyDate = new Date(Number(match[1]), Number(match[2]) - 1, 1);
      if (keyDate < cutoff) toRemove.push(key);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
  } catch { /* no-op */ }
}

// 512 KB üzerindeki tek bir değer için uyarı logu atar; 2 MB üzerinde yazmayı engeller.
const LS_WARN_BYTES  = 512 * 1024;
const LS_BLOCK_BYTES = 2 * 1024 * 1024;

/* İsteğe bağlı: proje genelinde kullanışlı tek bir LS wrapper */
export const LS = {
  get(key, def = null) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? def : JSON.parse(v);
    } catch {
      return def;
    }
  },
  set(key, val) {
    try {
      const serialized = JSON.stringify(val);
      if (serialized.length > LS_BLOCK_BYTES) {
        console.warn(`[LS] "${key}" için veri çok büyük (${(serialized.length / 1024).toFixed(0)} KB) — yazılmadı.`);
        return false;
      }
      if (serialized.length > LS_WARN_BYTES) {
        console.warn(`[LS] "${key}" büyük veri: ${(serialized.length / 1024).toFixed(0)} KB`);
      }
      localStorage.setItem(key, serialized);
      return true;
    } catch (e) {
      if (e?.name === "QuotaExceededError" || e?.code === 22) {
        console.warn(`[LS] localStorage dolu — "${key}" yazılamadı. pruneOldMonthlySheets() çalıştırılıyor.`);
        try { pruneOldMonthlySheets(1); } catch {}
      }
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* no-op */
    }
  },
};
