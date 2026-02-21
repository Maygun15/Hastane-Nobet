// src/auth/userAuth.js
import {
  newUser,
  upsertUser,
  findByIdentifier,
  getUsers,
  saveUsers,
} from "../models/userModel.js";
import { apiChangePassword, getToken, REQUIRE_BACKEND } from "../lib/api.js";

/* ---------- Normalize helpers ---------- */
const onlyDigits = (s = "") => (s + "").replace(/\D+/g, "");
const normEmail = (s = "") => (s + "").trim().toLowerCase();
const normTc    = (s = "") => (s + "").trim();

const ALLOWED_ROLES = new Set(["ADMIN", "AUTHORIZED", "STANDARD"]);
function normalizeRole(r) {
  const v = String(r || "").toUpperCase();
  return ALLOWED_ROLES.has(v) ? v : "STANDARD";
}
const ALLOWED_STATUS = new Set(["pending", "active", "rejected"]);
function normalizeStatus(s) {
  const v = String(s || "").toLowerCase();
  return ALLOWED_STATUS.has(v) ? v : "pending";
}

/* ---------- SHA-256 (dev için fallback'lı) ---------- */
async function sha256Hex(text) {
  try {
    const buf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(text || "")
    );
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    // Fallback (yalnızca dev/test içindir)
    let h = 0;
    const str = String(text || "");
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h.toString(16).padStart(8, "0");
  }
}

/* ---------- Duplicate guard ---------- */
function ensureUnique({ tc, email, phone }) {
  const L = getUsers();
  const e = normEmail(email);
  const t = normTc(tc);
  const p = onlyDigits(phone);

  const clash = L.find((u) =>
    (t && u.tc && normTc(u.tc) === t) ||
    (e && u.email && normEmail(u.email) === e) ||
    (p && u.phone && onlyDigits(u.phone) === p)
  );

  if (clash) {
    if (t && clash.tc && normTc(clash.tc) === t) throw new Error("Bu TC ile kayıt mevcut.");
    if (e && clash.email && normEmail(clash.email) === e) throw new Error("Bu e-posta ile kayıt mevcut.");
    if (p && clash.phone && onlyDigits(clash.phone) === p) throw new Error("Bu telefon ile kayıt mevcut.");
    throw new Error("Kullanıcı zaten mevcut.");
  }
}

/* ---------- Public API ---------- */

/** Kayıt — ilk kullanıcı otomatik ADMIN + active, diğerleri pending */
export async function registerUser({
  name,
  tc,
  phone,
  email,
  role,
  services,
  password,
}) {
  const list = getUsers();
  const isFirstUser = list.length === 0;

  ensureUnique({ tc, email, phone });

  const passwordHash = await sha256Hex(password || "");
  const user = newUser({
    name,
    tc: normTc(tc),
    phone: onlyDigits(phone),
    email: normEmail(email),
    role: isFirstUser ? "ADMIN" : normalizeRole(role),
    services: Array.isArray(services) ? services : [],
    passwordHash,
    status: isFirstUser ? "active" : "pending",
  });

  user.createdAt = Date.now();

  upsertUser(user);
  return user;
}

/** Giriş — tek tanımlayıcı (tc | email | phone | ad-soyad) + parola */
export async function loginWithIdentifier(identifier, password) {
  const u = findByIdentifier(identifier);
  if (!u) throw new Error("Kullanıcı bulunamadı.");
  if (normalizeStatus(u.status) !== "active") throw new Error("Hesap henüz aktif değil.");
  const hash = await sha256Hex(password || "");
  if (u.passwordHash !== hash) throw new Error("Parola hatalı.");
  u.lastLoginAt = Date.now();
  upsertUser(u);
  return u;
}

/** Kullanıcı durumunu güncelle (pending/active/rejected) */
export function setUserStatus(id, status) {
  const L = getUsers();
  const i = L.findIndex((u) => u.id === id);
  if (i < 0) return;
  L[i].status = normalizeStatus(status);
  saveUsers(L);
}

/** Rol güncelle (ADMIN | AUTHORIZED | STANDARD) */
export function setUserRole(id, role) {
  const L = getUsers();
  const i = L.findIndex((u) => u.id === id);
  if (i < 0) return;
  L[i].role = normalizeRole(role || L[i].role);
  saveUsers(L);
}

/** Servis atamaları (id listesi) */
export function setUserServices(id, services = []) {
  const L = getUsers();
  const i = L.findIndex((u) => u.id === id);
  if (i < 0) return;
  L[i].services = Array.isArray(services) ? services.map(String) : [];
  saveUsers(L);
}

/** Parola değiştir (eski parola doğrulaması ile) */
export async function changePassword(id, oldPassword, newPassword) {
  // Backend mode: sadece MongoDB
  const t = getToken();
  if (REQUIRE_BACKEND) {
    if (!t) throw new Error("Backend oturumu gerekli.");
    await apiChangePassword(oldPassword, newPassword);
    return true;
  }

  // Backend token varsa önce MongoDB'de güncelle
  try {
    if (t) {
      await apiChangePassword(oldPassword, newPassword);
      // Local cache varsa senkronize et
      const L = getUsers();
      const i = L.findIndex((u) => u.id === id);
      if (i >= 0) {
        L[i].passwordHash = await sha256Hex(newPassword || "");
        saveUsers(L);
      }
      return true;
    }
  } catch (e) {
    // Backend başarısızsa local fallback'a düş
    console.warn("Backend password change failed, falling back to local:", e?.message || e);
  }

  const L = getUsers();
  const i = L.findIndex((u) => u.id === id);
  if (i < 0) throw new Error("Kullanıcı yok.");
  const oldHash = await sha256Hex(oldPassword || "");
  if (L[i].passwordHash !== oldHash) throw new Error("Eski parola yanlış.");
  L[i].passwordHash = await sha256Hex(newPassword || "");
  saveUsers(L);
  return true;
}

/** Hızlı aktivasyon: kimlik ile bul → active yap */
export function activateByIdentifier(identifier) {
  const u = findByIdentifier(identifier);
  if (!u) throw new Error("Kullanıcı bulunamadı.");
  u.status = "active";
  upsertUser(u);
  return u;
}

/** Dev bootstrap: hiç kullanıcı yoksa tek adımda admin aç */
export async function ensureDevBootstrapAdmin() {
  if (localStorage.getItem("dev:bootstrap") !== "1") return;
  const L = getUsers();
  if (L.length > 0) return;

  await registerUser({
    name: "Dev Admin",
    email: "admin@local",
    phone: "5550000000",
    tc: "00000000000",
    role: "ADMIN",
    services: [],
    password: "admin123",
  });

  localStorage.removeItem("dev:bootstrap");
}
