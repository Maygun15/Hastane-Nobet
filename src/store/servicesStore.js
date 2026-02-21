// Basit LS store (backend gelene kadar)
export const SERVICES_LS_KEY = "services:v1";

export const DEFAULT_CATEGORIES = [
  "Dahili Branşlar",
  "Cerrahi Branşlar",
  "Yoğun Bakım / Acil",
  "Poliklinikler",
  "Laboratuvar / Görüntüleme",
  "Destek Birimleri",
];

export const DEFAULT_SERVICES_SEED = [
  // ——— Dahili (örnekler) ———
  { id: crypto.randomUUID(), name: "Kardiyoloji", category: "Dahili Branşlar", active: true, description: "" },
  { id: crypto.randomUUID(), name: "Nefroloji", category: "Dahili Branşlar", active: true, description: "" },
  { id: crypto.randomUUID(), name: "Endokrinoloji", category: "Dahili Branşlar", active: true, description: "" },
  { id: crypto.randomUUID(), name: "Gastroenteroloji", category: "Dahili Branşlar", active: true, description: "" },
  { id: crypto.randomUUID(), name: "Psikiyatri", category: "Dahili Branşlar", active: true, description: "" },
  // ——— Cerrahi ———
  { id: crypto.randomUUID(), name: "Genel Cerrahi", category: "Cerrahi Branşlar", active: true, description: "" },
  { id: crypto.randomUUID(), name: "Beyin Cerrahisi", category: "Cerrahi Branşlar", active: true, description: "" },
  { id: crypto.randomUUID(), name: "Ortopedi", category: "Cerrahi Branşlar", active: true, description: "" },
  { id: crypto.randomUUID(), name: "Üroloji", category: "Cerrahi Branşlar", active: true, description: "" },
  { id: crypto.randomUUID(), name: "KBB", category: "Cerrahi Branşlar", active: true, description: "" },
  // ——— Acil/Yoğun ———
  { id: crypto.randomUUID(), name: "Acil Servis", category: "Yoğun Bakım / Acil", active: true, description: "" },
  { id: crypto.randomUUID(), name: "Erişkin Yoğun Bakım", category: "Yoğun Bakım / Acil", active: true, description: "" },
  { id: crypto.randomUUID(), name: "KVC Yoğun Bakım", category: "Yoğun Bakım / Acil", active: false, description: "" },
  // ——— Poliklinik ———
  { id: crypto.randomUUID(), name: "Dahiliye Polikliniği", category: "Poliklinikler", active: true, description: "" },
  { id: crypto.randomUUID(), name: "Göz Polikliniği", category: "Poliklinikler", active: true, description: "" },
  // ——— Lab/Görüntüleme ———
  { id: crypto.randomUUID(), name: "Biyokimya Laboratuvarı", category: "Laboratuvar / Görüntüleme", active: true, description: "" },
  { id: crypto.randomUUID(), name: "Radyoloji", category: "Laboratuvar / Görüntüleme", active: true, description: "" },
  // ——— Destek ———
  { id: crypto.randomUUID(), name: "Sterilizasyon Ünitesi", category: "Destek Birimleri", active: true, description: "" },
];

function readLS() {
  try {
    const raw = localStorage.getItem(SERVICES_LS_KEY);
    if (!raw) {
      const seed = { categories: DEFAULT_CATEGORIES, services: DEFAULT_SERVICES_SEED, updatedAt: Date.now() };
      localStorage.setItem(SERVICES_LS_KEY, JSON.stringify(seed));
      return seed;
    }
    return JSON.parse(raw);
  } catch {
    return { categories: DEFAULT_CATEGORIES, services: [], updatedAt: Date.now() };
  }
}
function writeLS(data) {
  localStorage.setItem(SERVICES_LS_KEY, JSON.stringify({ ...data, updatedAt: Date.now() }));
}

export function getServicesState() {
  return readLS();
}
export function setServicesState(next) {
  writeLS(next);
}

export function upsertService(svc) {
  const st = readLS();
  const idx = st.services.findIndex(s => s.id === svc.id);
  if (idx >= 0) st.services[idx] = { ...st.services[idx], ...svc };
  else st.services.push({ id: crypto.randomUUID(), active: true, ...svc });
  writeLS(st);
  return st;
}
export function deleteService(id) {
  const st = readLS();
  st.services = st.services.filter(s => s.id !== id);
  writeLS(st);
  return st;
}
export function addCategory(name) {
  const st = readLS();
  if (!st.categories.includes(name)) st.categories.push(name);
  writeLS(st);
  return st;
}
export function importJson(obj) {
  if (!obj || !Array.isArray(obj.services)) throw new Error("Geçersiz veri");
  const cats = Array.isArray(obj.categories) && obj.categories.length ? obj.categories : DEFAULT_CATEGORIES;
  writeLS({ categories: cats, services: obj.services, updatedAt: Date.now() });
  return readLS();
}
export function exportJson() {
  return readLS();
}
