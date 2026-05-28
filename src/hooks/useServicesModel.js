// src/hooks/useServicesModel.js
import { useState, useCallback, useEffect } from "react";
import { getApiBase } from "../lib/apiConfig.js";

const BASE = "/api/services";
const API_BASE = getApiBase().replace(/\/+$/, "");
const makeUrl = (path) => `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;

function getToken() {
  return localStorage.getItem("authToken") || localStorage.getItem("token") || "";
}

function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getToken()}`,
  };
}

let _cache = [];
let _listeners = new Set();
let _loaded = false;
function notifyAll() {
  _listeners.forEach((fn) => fn());
}

function stableJson(value) {
  return JSON.stringify(value, (key, val) => {
    void key;
    if (!val || typeof val !== "object" || Array.isArray(val)) return val;
    return Object.keys(val).sort().reduce((acc, k) => {
      acc[k] = val[k];
      return acc;
    }, {});
  });
}

function setCache(next) {
  const normalized = Array.isArray(next) ? next : [];
  const changed = stableJson(_cache) !== stableJson(normalized);
  _cache = normalized;
  _loaded = true;
  if (changed) notifyAll();
}

export function useServices() {
  const [, tick] = useState(0);

  useEffect(() => {
    const fn = () => tick((v) => v + 1);
    _listeners.add(fn);
    return () => _listeners.delete(fn);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const url = makeUrl(BASE);
      const res = await fetch(url, { headers: authHeaders() });
      const json = await res.json();
      if (json?.ok) {
        setCache(json.data);
      }
    } catch (e) {
      console.error("Servisler yüklenemedi:", e);
    }
  }, []);

  useEffect(() => {
    if (!_loaded) refresh();
  }, [refresh]);

  return { items: _cache, refresh };
}

export default function useServicesModel() {
  const [, tick] = useState(0);

  useEffect(() => {
    const fn = () => tick((v) => v + 1);
    _listeners.add(fn);
    return () => _listeners.delete(fn);
  }, []);

  const list = useCallback(() => Array.isArray(_cache) ? _cache : [], []);

  const refresh = useCallback(async () => {
    try {
      const url = makeUrl(BASE);
      const res = await fetch(url, { headers: authHeaders() });
      const json = await res.json();
      if (json?.ok) {
        setCache(json.data);
      }
    } catch (e) {
      console.error("Servisler yüklenemedi:", e);
    }
  }, []);

  useEffect(() => {
    if (!_loaded) refresh();
  }, [refresh]);

  const add = useCallback(async (payload) => {
    try {
      const url = makeUrl(BASE);
      const res = await fetch(url, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json?.ok) {
        _cache = [..._cache, json.data];
        _loaded = true;
        notifyAll();
        return json.data;
      }
      alert("Hata: " + (json?.error || "Servis eklenemedi"));
    } catch (e) {
      alert("Bağlantı hatası: " + e.message);
    }
  }, []);

  const update = useCallback(async (id, patch) => {
    try {
      const url = makeUrl(`${BASE}/${id}`);
      const res = await fetch(url, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify(patch),
      });
      const json = await res.json();
      if (json?.ok) {
        _cache = _cache.map((s) => (s._id === id || s.id === id ? json.data : s));
        _loaded = true;
        notifyAll();
      } else {
        alert("Hata: " + (json?.error || "Güncellenemedi"));
      }
    } catch (e) {
      alert("Bağlantı hatası: " + e.message);
    }
  }, []);

  const remove = useCallback(async (id) => {
    try {
      const url = makeUrl(`${BASE}/${id}`);
      const res = await fetch(url, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const json = await res.json();
      if (json?.ok) {
        _cache = _cache.filter((s) => s._id !== id && s.id !== id);
        _loaded = true;
        notifyAll();
      } else {
        alert("Hata: " + (json?.error || "Silinemedi"));
      }
    } catch (e) {
      alert("Bağlantı hatası: " + e.message);
    }
  }, []);

  const toggle = useCallback(async (id) => {
    const item = _cache.find((s) => s._id === id || s.id === id);
    if (!item) return;
    await update(id, { active: !item.active });
  }, [update]);

  return { list, refresh, add, update, remove, toggle };
}
