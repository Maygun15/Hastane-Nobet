// src/utils/acl.js
import { ROLE, ROLE_PERMISSIONS, PERMISSIONS } from "../constants/roles.js";

/* -------------------------------------------------
   Basit rol yardımcıları
------------------------------------------------- */
export const isAdmin = (user) => user?.role === ROLE.ADMIN;
export const isAuthorized = (user) => user?.role === ROLE.AUTHORIZED;  // servis sorumlusu
export const isStandard = (user) => user?.role === ROLE.STANDARD;

/* -------------------------------------------------
   İzin seti çıkarımları
------------------------------------------------- */
export function getRolePermissions(role) {
  return ROLE_PERMISSIONS?.[role] || [];
}

export function getUserPermissions(user) {
  if (!user) return [];
  const explicit = Array.isArray(user.permissions) ? user.permissions : [];
  const fromRole = getRolePermissions(user.role);
  // benzersizleştir
  return Array.from(new Set([...explicit, ...fromRole]));
}

/* -------------------------------------------------
   Servis kapsam yardımcıları
------------------------------------------------- */
function normalizeServiceIds(arr) {
  return Array.isArray(arr) ? new Set(arr) : new Set();
}

function withinOwnService(user, serviceId) {
  if (!serviceId) return false;
  const owned = normalizeServiceIds(user?.serviceIds);
  return owned.has(serviceId);
}

/* -------------------------------------------------
   Ana kontrol
   can(user, perm, { serviceId })
------------------------------------------------- */
export function can(user, perm, ctx = {}) {
  if (!user || !perm) return false;

  // 1) Admin her şeyi yapar
  if (isAdmin(user)) return true;

  const { serviceId } = ctx;
  const perms = getUserPermissions(user);

  // 2) İstediği izin, effektif setinde yoksa false
  if (!perms.includes(perm)) return false;

  // 3) İnce politika (servis kapsamlı davranışlar)
  switch (perm) {
    // Sadece Admin yönetir, yanlışlıkla explicit eklenmişse bile
    case PERMISSIONS.SERVICE_MANAGE:
      return false;

    // Servis atama/düzenleme: Yetkili yalnız kendi servisinde
    case PERMISSIONS.SERVICE_ASSIGN:
    case PERMISSIONS.ROSTER_EDIT:
    case PERMISSIONS.LEAVE_EDIT: {
      if (isAuthorized(user)) {
        return withinOwnService(user, serviceId);
      }
      // STANDARD bu izinlere zaten sahip değil; burada false
      return false;
    }

    // Görüntüleme izinleri (roster/leave/service):
    case PERMISSIONS.ROSTER_VIEW:
    case PERMISSIONS.LEAVE_VIEW:
    case PERMISSIONS.SERVICE_VIEW: {
      if (isAuthorized(user)) {
        // servisId verilmişse kendi servisi olmalı; verilmemişse genel sayfaları görebilir
        return serviceId ? withinOwnService(user, serviceId) : true;
      }
      if (isStandard(user)) {
        // STANDARD: servis kapsamlı ekranlar kapalı (örn. belirli servis sayfası)
        return !serviceId;
      }
      return false;
    }

    default:
      // Haritalanmayan özel izinler için (explicit verilmişse) servis kısıtı yok
      return true;
  }
}

/* -------------------------------------------------
   Toplu yardımcılar
------------------------------------------------- */
export function canAll(user, permissions, ctx = {}) {
  const list = Array.isArray(permissions) ? permissions : [permissions];
  return list.every((p) => can(user, p, ctx));
}

export function canAny(user, permissions, ctx = {}) {
  const list = Array.isArray(permissions) ? permissions : [permissions];
  return list.some((p) => can(user, p, ctx));
}

/* -------------------------------------------------
   Servis-odaklı kısayol
------------------------------------------------- */
export function canOnService(user, perm, serviceId) {
  return can(user, perm, { serviceId });
}
