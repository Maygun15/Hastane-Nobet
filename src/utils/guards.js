// src/utils/guards.js
export function isAdmin(user) {
  return String(user?.role || '').toUpperCase() === 'ADMIN';
}

export function hasServiceScope(user) {
  return Array.isArray(user?.serviceIds) && user.serviceIds.length > 0;
}

/** Belirli bir modül için basit kural:
 *  - Admin: her zaman erişir
 *  - Diğerleri: en az bir servis atanmış olmalı
 */
export function canViewModule(user) {
  return isAdmin(user) || hasServiceScope(user);
}
