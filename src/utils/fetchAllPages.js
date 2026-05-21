// src/utils/fetchAllPages.js
import { API } from "../lib/api.js";

/**
 * Sayfalı bir endpoint'ten tüm kayıtları çeker.
 * Backend { items, total } döndürmelidir.
 *
 * @param {string} basePath   Örn: "/api/personnel"
 * @param {number} pageSize   Sayfa başına kayıt sayısı (varsayılan 500)
 * @returns {Promise<Array>}
 */
export async function fetchAllPages(basePath, pageSize = 500) {
  const sep = basePath.includes("?") ? "&" : "?";
  const first = await API.http.get(`${basePath}${sep}page=1&size=${pageSize}`);
  const total = Number(first?.total) || 0;
  const items = Array.isArray(first?.items) ? first.items : [];

  if (total <= pageSize || !items.length) return items;

  const totalPages = Math.ceil(total / pageSize);
  const rest = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, i) =>
      API.http.get(`${basePath}${sep}page=${i + 2}&size=${pageSize}`)
    )
  );

  return [...items, ...rest.flatMap((r) => (Array.isArray(r?.items) ? r.items : []))];
}
