// src/hooks/useDebouncedSetting.js
import { useEffect, useRef } from "react";
import { API } from "../lib/api.js";

/**
 * Backend ayarını debounced + retry ile kaydeder.
 *
 * @param {string}  key              /api/settings/<key> path'i
 * @param {*}       value            Kaydedilecek değer (JSON serialize edilir)
 * @param {object}  opts
 * @param {boolean} opts.enabled     false ise hiç kayıt yapmaz (isAdmin kontrolü için)
 * @param {object}  opts.gateRef     useRef — .current false iken kayıt ertelenir (settingsLoaded gibi)
 * @param {object}  opts.lastSavedRef  Dışarıdan yönetilen ref; backend fetch sonrası seed'lenebilir
 * @param {number}  opts.debounceMs  Bekleme süresi (ms), varsayılan 600
 * @param {number}  opts.retryMs     Hata sonrası yeniden deneme gecikmesi (ms), varsayılan 5000
 */
export function useDebouncedSetting(key, value, {
  enabled = true,
  gateRef = null,
  lastSavedRef: externalRef = null,
  debounceMs = 600,
  retryMs = 5_000,
} = {}) {
  const ownRef       = useRef(null);
  const lastSavedRef = externalRef ?? ownRef;
  const timerRef     = useRef(null);

  useEffect(() => {
    if (!enabled) return;
    if (gateRef && !gateRef.current) return;

    const serialized = JSON.stringify(value ?? []);
    if (lastSavedRef.current === serialized) return;

    const save = () =>
      API.http.req(`/api/settings/${key}`, {
        method: "PUT",
        body: { value, serviceId: "" },
        retries: 0,
      });

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      save()
        .then(() => { lastSavedRef.current = serialized; })
        .catch((err) => {
          console.warn(`[useDebouncedSetting] "${key}" kayıt başarısız, ${retryMs}ms sonra yeniden deneniyor:`, err?.message || err);
          timerRef.current = setTimeout(() => {
            save()
              .then(() => { lastSavedRef.current = serialized; })
              .catch((e) => console.warn(`[useDebouncedSetting] "${key}" retry başarısız:`, e?.message || e));
          }, retryMs);
        });
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  // value obje/dizi olduğu için JSON string üzerinden karşılaştırıyoruz, direkt dep olarak koymuyoruz.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, JSON.stringify(value), enabled, gateRef, debounceMs, retryMs]);
}
