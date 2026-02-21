// src/constants/roles.js

/* ==== ROLLER ==== */
export const ROLE = {
  ADMIN: "ADMIN",
  AUTHORIZED: "AUTHORIZED",
  STANDARD: "STANDARD",
};

/* ==== İZİN ANAHTARLARI ==== */
export const PERMISSIONS = {
  USERS_READ: "USERS_READ",
  USERS_WRITE: "USERS_WRITE",

  SERVICES_READ: "SERVICES_READ",
  SERVICES_WRITE: "SERVICES_WRITE",

  SCHEDULE_READ: "SCHEDULE_READ",
  SCHEDULE_WRITE: "SCHEDULE_WRITE",

  LEAVES_READ: "LEAVES_READ",
  LEAVES_WRITE: "LEAVES_WRITE",

  PARAMETERS_READ: "PARAMETERS_READ",
  PARAMETERS_WRITE: "PARAMETERS_WRITE",

  EXPORT_IMPORT: "EXPORT_IMPORT",
};

/* Kolaylık: tüm izinlerin düz listesi */
export const ALL_PERMISSIONS = Object.values(PERMISSIONS);

/* ==== ROL → İZİN HARİTASI ==== */
export const ROLE_PERMISSIONS = {
  [ROLE.ADMIN]: [...ALL_PERMISSIONS],

  [ROLE.AUTHORIZED]: [
    PERMISSIONS.SERVICES_READ,
    PERMISSIONS.SCHEDULE_READ,
    PERMISSIONS.SCHEDULE_WRITE,
    PERMISSIONS.LEAVES_READ,
    PERMISSIONS.LEAVES_WRITE,
    PERMISSIONS.PARAMETERS_READ,
    PERMISSIONS.EXPORT_IMPORT,
  ],

  [ROLE.STANDARD]: [
    PERMISSIONS.SERVICES_READ,
    PERMISSIONS.SCHEDULE_READ,
    PERMISSIONS.LEAVES_READ,
  ],
};

/* (Opsiyonel) Kullanışlı yardımcılar — kullanmak zorunda değilsin */
export function normalizeRole(raw) {
  if (!raw) return ROLE.STANDARD;
  const v = String(raw).toUpperCase();
  if (v === ROLE.ADMIN) return ROLE.ADMIN;
  if (v === ROLE.AUTHORIZED) return ROLE.AUTHORIZED;
  return ROLE.STANDARD;
}

export function resolvePermissions({ role, permissions = [] } = {}) {
  const base = ROLE_PERMISSIONS[normalizeRole(role)] || [];
  // explicit + rolden gelenleri birleştir, tekrarı kaldır
  return Array.from(new Set([...(permissions || []), ...base]));
}
