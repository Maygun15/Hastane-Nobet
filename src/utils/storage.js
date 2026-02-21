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
      localStorage.setItem(key, JSON.stringify(val));
    } catch {
      /* no-op */
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
