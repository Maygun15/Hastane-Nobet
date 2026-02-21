// src/hooks/useActiveYM.js
import { useEffect, useCallback } from "react";
import { useAppStore } from "../state/appStore";

/**
 * Tek AY/YIL kaynağı (Zustand) + GERİYE DÖNÜK UYUMLULUK KÖPRÜSÜ
 *
 * - Store: { ym: {year, month} }  => month: 1..12 (KESİN)
 * - Legacy LS'te iki anahtar yazıyoruz:
 *     - "plannerMonth"  : 0-baz AY   (0..11)  ← Eski ekranlar bunu bekliyor olabilir
 *     - "plannerMonth1" : 1-baz AY   (1..12)  ← Açık/sezgisel yeni anahtar
 *   Ayrıca:
 *     - "plannerYear"   : yıl
 *     - "activeYM.year" / "activeYM.month" : açık yeni anahtarlar
 *
 * - Mount'ta okuma sırası:
 *     1) activeYM.*  (1..12)
 *     2) plannerMonth1 (1..12)
 *     3) plannerMonth  (0..11 ise +1; 1..12 ise direkt al)
 *     4) bugün
 *
 * - Her YM değişiminde hepsini yazar + event yayınlar.
 */

const NEW_YEAR  = "activeYM.year";
const NEW_MONTH = "activeYM.month";
const LEG_Y     = "plannerYear";
const LEG_M0    = "plannerMonth";   // 0-baz (0..11) — eskiler
const LEG_M1    = "plannerMonth1";  // 1-baz (1..12) — açıklayıcı

function clampMonth1(m) {
  const n = Number(m);
  if (!Number.isFinite(n)) return null;
  if (n >= 1 && n <= 12) return Math.trunc(n);
  return null;
}
function fromLegacyMonth(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return null;
  // 0..11 geldiyse 1-baz'a çevir
  if (n >= 0 && n <= 11) return n + 1;
  if (n >= 1 && n <= 12) return n; // bazı projeler 1-baz da yazmış olabilir
  return null;
}
function todayYM() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 }; // 1..12
}

export default function useActiveYM(options = { syncLegacyLS: true }) {
  const ym       = useAppStore((s) => s.ym);
  const setYM    = useAppStore((s) => s.setYM);
  const gotoPrev = useAppStore((s) => s.gotoPrev);
  const gotoNext = useAppStore((s) => s.gotoNext);
  const gotoToday= useAppStore((s) => s.gotoToday);

  const setYear = useCallback(
    (year) => {
      const curr = useAppStore.getState().ym;
      setYM({ year: Number(year), month: curr.month });
    },
    [setYM]
  );
  const setMonth = useCallback(
    (month) => {
      const curr = useAppStore.getState().ym;
      setYM({ year: curr.year, month: Number(month) });
    },
    [setYM]
  );

  // 1) İlk mount: mevcut LS’ten oku (yeni→eski öncelik sırasıyla), store'a UYGULA
  useEffect(() => {
    if (!options?.syncLegacyLS) return;

    try {
      // A) yeni anahtarlar
      const ny = Number(localStorage.getItem(NEW_YEAR));
      const nm = clampMonth1(localStorage.getItem(NEW_MONTH));

      // B) 1-baz eski açık anahtar
      const ly = Number.isFinite(ny) ? ny : Number(localStorage.getItem(LEG_Y));
      const lm1 = clampMonth1(localStorage.getItem(LEG_M1));

      // C) 0-baz eski anahtar
      const lm = fromLegacyMonth(localStorage.getItem(LEG_M0));

      let year  = Number.isFinite(ly) ? ly : todayYM().year;
      let month = nm ?? lm1 ?? lm ?? todayYM().month;

      // store ile aynıysa dokunma
      if (year !== ym.year || month !== ym.month) {
        setYM({ year, month });
      }
    } catch {
      // no-op
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2) YM değiştikçe tüm legacy + yeni anahtarları GÜNCELLE ve event yayınla
  useEffect(() => {
    if (!options?.syncLegacyLS) return;

    try {
      const { year, month } = ym;
      // Yeni ve açıklayıcı anahtarlar (1-baz)
      localStorage.setItem(NEW_YEAR,  String(year));
      localStorage.setItem(NEW_MONTH, String(month));
      // Legacy
      localStorage.setItem(LEG_Y,  String(year));
      localStorage.setItem(LEG_M1, String(month));      // 1-baz açık anahtar
      localStorage.setItem(LEG_M0, String(month - 1));  // 0-baz GERİYE DÖNÜK

      // Birkaç ekran doğrudan window’dan da bakıyor olabilir:
      window.__activeYM = { year, month, month0: month - 1 };

      // Eski bileşenleri uyandır:
      window.dispatchEvent(new Event("storage"));
      window.dispatchEvent(new CustomEvent("activeYM:changed", { detail: { year, month, month0: month - 1 } }));
    } catch {
      // no-op
    }
  }, [ym.year, ym.month, options?.syncLegacyLS]);

  return { ym, setYM, setYear, setMonth, gotoPrev, gotoNext, gotoToday };
}
