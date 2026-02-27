// src/hooks/useServicesModel.js
// Backend /api/services endpoint'inden servisleri çeker.
// Backend erişilemezse localStorage fallback kullanır.

import { useState, useEffect, useCallback } from "react";
import { API, getToken } from "../lib/api.js";

const LS_KEY = "services:model:v1";

function readLS() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : { items: [] };
  } catch {
    return { items: [] };
  }
}
function writeLS(items) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ items }));
  } catch {}
}

async function apiFetch(path, opts = {}) {
  const token = getToken();
  const res = await fetch(`${API}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

// React hook — bileşenlerde kullan
export function useServices() {
  const [items, setItems] = useState(() => readLS().items || []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch("/api/services");
      const list = data?.data || [];
      setItems(list);
      writeLS(list);
    } catch (e) {
      setError(e.message);
      // Fallback: localStorage'daki eski liste kalsın
      setItems(readLS().items || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const add = useCallback(async (payload) => {
    const data = await apiFetch("/api/services", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    await refresh();
    return data?.data;
  }, [refresh]);

  const update = useCallback(async (id, patch) => {
    await apiFetch(`/api/services/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    await refresh();
  }, [refresh]);

  const remove = useCallback(async (id) => {
    await apiFetch(`/api/services/${id}`, { method: "DELETE" });
    await refresh();
  }, [refresh]);

  return { items, loading, error, refresh, add, update, remove };
}

// Eski senkron model API'si (ServicesTab.jsx geriye dönük uyum için)
export default function useServicesModel() {
  const list = () => readLS().items || [];

  const add = async (payload) => {
    try {
      const data = await apiFetch("/api/services", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const item = data?.data;
      if (item) {
        const current = readLS().items || [];
        writeLS([...current, item]);
      }
      return item;
    } catch {
      // Fallback: localStorage
      const current = readLS().items || [];
      const item = {
        id: "local_" + Math.random().toString(36).slice(2),
        name: payload.name ?? "Yeni Servis",
        code: (payload.code ?? "YENI_SERVIS").toUpperCase(),
        active: payload.active !== false,
      };
      writeLS([...current, item]);
      return item;
    }
  };

  const update = async (id, patch) => {
    try {
      await apiFetch(`/api/services/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
    } catch {}
    // localStorage'ı da güncelle
    const st = readLS();
    const i = st.items.findIndex((x) => x.id === id || x._id === id);
    if (i !== -1) {
      st.items[i] = { ...st.items[i], ...patch, code: (patch.code ?? st.items[i].code)?.toUpperCase() };
      writeLS(st.items);
    }
  };

  const remove = async (id) => {
    try {
      await apiFetch(`/api/services/${id}`, { method: "DELETE" });
    } catch {}
    const st = readLS();
    writeLS(st.items.filter((x) => x.id !== id && x._id !== id));
  };

  const importItems = (newItems) => {
    writeLS(newItems.map((x) => ({ ...x, code: (x.code || "").toUpperCase() })));
  };

  return { list, add, update, remove, importItems };
}
