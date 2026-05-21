// shared/constants/roles.js
// Rol sabitleri — frontend ve backend farklı değer setleri kullanır;
// bu dosya her iki tarafın canonical kaynak değerlerini belgeler.

/** Backend MongoDB'de saklanan değerler */
export const DB_ROLE = {
  USER:       "user",
  STAFF:      "staff",
  ADMIN:      "admin",
  SUPERADMIN: "superadmin",
};

/** Frontend RBAC ve API yanıtlarında kullanılan değerler */
export const UI_ROLE = {
  ADMIN:      "ADMIN",
  STAFF:      "STAFF",
  AUTHORIZED: "AUTHORIZED",
  STANDARD:   "STANDARD",
  MANAGER:    "MANAGER",
};

/** DB_ROLE → UI_ROLE eşlemesi */
export const DB_TO_UI_ROLE = {
  [DB_ROLE.USER]:       UI_ROLE.STANDARD,
  [DB_ROLE.STAFF]:      UI_ROLE.STAFF,
  [DB_ROLE.ADMIN]:      UI_ROLE.ADMIN,
  [DB_ROLE.SUPERADMIN]: UI_ROLE.ADMIN,
};
