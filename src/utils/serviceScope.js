// src/utils/serviceScope.js
import { ROLE } from "../constants/roles.js";

export const OPERATIONAL_SERVICE_WARNING =
  "Çizelge oluşturmak veya düzenlemek için önce bir servis seçin. \"Tümü\" seçiliyken çizelge sadece görüntülenebilir.";

export function isSpecificServiceSelected(serviceId) {
  const normalized = String(serviceId ?? "")
    .trim()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/g, " ");

  return ![
    "",
    "all",
    "all services",
    "tum",
    "tumu",
    "tum servisler",
  ].includes(normalized);
}

/** allServices: [{id, ...}] — user.serviceIds ile kesişim */
export function visibleServicesFor(user, allServices = []) {
  if (!user) return [];
  if (user.role === ROLE.ADMIN) return allServices;
  const allowed = new Set(user.serviceIds || []);
  return allServices.filter(s => allowed.has(s.id));
}
