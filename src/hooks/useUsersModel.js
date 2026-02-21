// src/hooks/useUsersModel.js
import { useEffect, useMemo, useState } from "react";
import { LS_KEYS } from "../utils/lsKeys.js";

function readLS(key, fallback){
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function writeLS(key, val){ localStorage.setItem(key, JSON.stringify(val)); }

export default function useUsersModel(){
  const [items, setItems] = useState(() => readLS(LS_KEYS.USERS, []));
  useEffect(() => { writeLS(LS_KEYS.USERS, items); }, [items]);

  const api = useMemo(() => ({
    list(){ return items; },

    // Var olan user’ı günceller; yoksa ekler.
    upsert(user){ // {id, name, email, role, serviceIds?}
      setItems(prev => {
        const i = prev.findIndex(x => x.id === user.id);
        if (i >= 0) {
          const next = [...prev];
          next[i] = { ...next[i], ...user, serviceIds: user.serviceIds ?? next[i].serviceIds ?? [] };
          return next;
        }
        return [...prev, { ...user, serviceIds: user.serviceIds ?? [] }];
      });
    },

    assignServices(userId, serviceIds){
      setItems(prev => prev.map(x => x.id === userId ? { ...x, serviceIds: [...new Set(serviceIds)] } : x));
    },

    setRole(userId, role){
      setItems(prev => prev.map(x => x.id === userId ? { ...x, role } : x));
    },
  }), [items]);

  return api;
}
