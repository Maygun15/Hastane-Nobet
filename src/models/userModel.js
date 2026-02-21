// src/models/userModel.js
export const USERS_LS_KEY = "hastane:users";

export function newUser({
  id, name, tc = "", phone = "", email = "", role = "personel",
  services = [], passwordHash = "", status = "pending", active = true
}) {
  return {
    id: id || (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now())),
    name: (name || "").trim(),
    tc: (tc || "").trim(),
    phone: (phone || "").trim(),
    email: (email || "").trim().toLowerCase(),
    role,
    services,
    passwordHash,
    status,   // "pending" | "active" | "rejected"
    active,   // eski kontroller için bırakıldı
    createdAt: Date.now(),
  };
}

export function getUsers() {
  try { return JSON.parse(localStorage.getItem(USERS_LS_KEY) || "[]"); }
  catch { return []; }
}

export function saveUsers(list) {
  localStorage.setItem(USERS_LS_KEY, JSON.stringify(list || []));
}

export function upsertUser(user) {
  const list = getUsers();
  const i = list.findIndex(u => u.id === user.id);
  if (i >= 0) list[i] = user; else list.push(user);
  saveUsers(list);
  return user;
}

export function removeUser(id) {
  saveUsers(getUsers().filter(u => u.id !== id));
}

const norm = s => (s || "").toString().trim().toLowerCase().replace(/\s+/g, " ");

export function findByIdentifier(identifier) {
  const x = norm(identifier);
  return getUsers().find(u =>
    norm(u.tc) === x ||
    norm(u.email) === x ||
    norm(u.phone) === x ||
    norm(u.name) === x
  );
}
