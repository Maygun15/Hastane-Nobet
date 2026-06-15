// src/utils/serviceScope.js
import { ROLE } from "../constants/roles.js";

export const OPERATIONAL_SERVICE_WARNING =
  "Please select a specific service before editing or generating schedules. 'All Services' is read-only and cannot be used for operational schedule actions.";

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
