// src/utils/serviceScope.js
import { ROLE } from "../constants/roles.js";

/** allServices: [{id, ...}] — user.serviceIds ile kesişim */
export function visibleServicesFor(user, allServices = []) {
  if (!user) return [];
  if (user.role === ROLE.ADMIN) return allServices;
  const allowed = new Set(user.serviceIds || []);
  return allServices.filter(s => allowed.has(s.id));
}
