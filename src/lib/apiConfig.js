// src/lib/apiConfig.js

const DEFAULT_PROD_BASE = "https://hastane-backend-production.up.railway.app";
const RAW_PROD_BASE =
  import.meta.env?.VITE_API_BASE ||
  import.meta.env?.VITE_API_URL ||
  DEFAULT_PROD_BASE;
const RAW_STAGING_BASE =
  import.meta.env?.VITE_API_BASE_STAGING ||
  import.meta.env?.VITE_API_URL_STAGING ||
  "";
const ENV_PROD_BASE = String(RAW_PROD_BASE || DEFAULT_PROD_BASE).replace(/\/+$/, "");
const ENV_STAGING_BASE = String(RAW_STAGING_BASE || "").replace(/\/+$/, "");
const ENV_DEFAULT = String(import.meta.env?.VITE_API_ENV || "prod").toLowerCase();
const ENV_ONLINE_ONLY = String(import.meta.env?.VITE_ONLINE_ONLY || "true").toLowerCase() === "true";
const ENV_PROD_WRITE_ROLES = String(import.meta.env?.VITE_PROD_WRITE_ROLES || "ADMIN");

const API_ENV_KEY = "apiEnv";

export function isOnlineOnly() {
  return ENV_ONLINE_ONLY;
}

export function getApiEnv() {
  // URL param overrides (e.g. ?env=staging)
  if (typeof window !== "undefined") {
    try {
      const q = new URLSearchParams(window.location.search).get("env");
      if (q === "staging" && ENV_STAGING_BASE) return "staging";
      if (q === "prod") return "prod";
    } catch {}
  }

  // LocalStorage override
  if (typeof window !== "undefined") {
    try {
      const ls = localStorage.getItem(API_ENV_KEY);
      if (ls === "staging" && ENV_STAGING_BASE) return "staging";
      if (ls === "prod") return "prod";
    } catch {}
  }

  // Env default
  if (ENV_DEFAULT === "staging" && ENV_STAGING_BASE) return "staging";
  return "prod";
}

export function setApiEnv(env) {
  if (typeof window === "undefined") return;
  try {
    if (env === "staging" || env === "prod") {
      localStorage.setItem(API_ENV_KEY, env);
    } else {
      localStorage.removeItem(API_ENV_KEY);
    }
  } catch {}
}

export function getApiBase() {
  return getApiEnv() === "staging" && ENV_STAGING_BASE
    ? ENV_STAGING_BASE
    : ENV_PROD_BASE;
}

export function isProdApi() {
  return getApiEnv() === "prod";
}

export function getCachedUser() {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("authUser");
    const parsed = raw ? JSON.parse(raw) : null;
    // bazı client'lar { user: {...} } saklamış olabilir
    if (parsed && parsed.user && !parsed.role) return parsed.user;
    return parsed;
  } catch {
    return null;
  }
}

export function getProdWriteRoles() {
  return ENV_PROD_WRITE_ROLES
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

export function canWriteToProd(user) {
  const role = String(
    user?.role ||
    user?.roleKey ||
    user?.type ||
    user?.user?.role ||
    user?.user?.roleKey ||
    user?.user?.type ||
    ""
  ).toUpperCase();
  return getProdWriteRoles().includes(role);
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const WRITE_ALLOWLIST = [
  /^\/health$/,
  /^\/api\/auth\//,
  /^\/auth\//,
  /^\/api\/admin\/accept-invite/,
  /^\/admin\/accept-invite/,
  /^\/api\/staff\/accept-invite/,
  /^\/staff\/accept-invite/,
];

export function assertProdWriteAllowed(path, method) {
  const m = String(method || "GET").toUpperCase();
  if (!WRITE_METHODS.has(m)) return;
  if (!isProdApi()) return;
  if (WRITE_ALLOWLIST.some((rx) => rx.test(path || ""))) return;
  const user = getCachedUser();
  if (!canWriteToProd(user)) {
    throw new Error("Prod veriye yazma yetkiniz yok.");
  }
}
