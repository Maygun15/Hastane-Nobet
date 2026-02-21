// LocalStorage tabanlı küçük model.
// İleri aşamada buradaki çağrıları API ile değiştirmen yeterli olacak.

const LS_KEY = "services:model:v1";

function readLS() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : { items: [] };
  } catch {
    return { items: [] };
  }
}
function writeLS(st) {
  localStorage.setItem(LS_KEY, JSON.stringify(st));
}
function uid() {
  // crypto.randomUUID varsa onu kullan
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "id_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function useServicesModel() {
  // Minimal bir proxy: her çağrıda LS’den okuyoruz ki başka sekmelerde de senkron kalsın.
  const list = () => readLS().items;

  const add = (payload) => {
    const st = readLS();
    const item = {
      id: uid(),
      name: payload.name ?? "Yeni Servis",
      code: (payload.code ?? "YENI_SERVIS").toUpperCase(),
      active: payload.active !== false,
    };
    st.items.push(item);
    writeLS(st);
    return item;
  };

  const update = (id, patch) => {
    const st = readLS();
    const i = st.items.findIndex(x => x.id === id);
    if (i === -1) return;
    st.items[i] = {
      ...st.items[i],
      ...patch,
      code: (patch.code ?? st.items[i].code)?.toUpperCase(),
    };
    writeLS(st);
  };

  const toggle = (id) => {
    const st = readLS();
    const it = st.items.find(x => x.id === id);
    if (!it) return;
    it.active = !it.active;
    writeLS(st);
  };

  const remove = (id) => {
    const st = readLS();
    st.items = st.items.filter(x => x.id !== id);
    writeLS(st);
  };

  const seed = () => {
    const st = readLS();
    if (st.items.length) return;
    st.items = [
      { id: uid(), name: "Kardiyoloji",     code: "KARDIYOLOJI",  active: true },
      { id: uid(), name: "Genel Cerrahi",   code: "GENEL_CERRAHI",active: true },
      { id: uid(), name: "Acil Servis",     code: "ACIL",         active: true },
      { id: uid(), name: "Radyoloji",       code: "RADYOLOJI",    active: true },
      { id: uid(), name: "Biyokimya Lab.",  code: "BIYOKIMYA",    active: true },
      { id: uid(), name: "Ortopedi",        code: "ORTOPEDI",     active: true },
    ];
    writeLS(st);
  };

  return { list, add, update, toggle, remove, seed };
}
