// src/auth/AuthContext.jsx
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  apiLogin,
  apiLogout,
  apiMe,
  setToken,
  getToken,
} from "../lib/api.js";

/*
  Auth modelimiz:
  - token: localStorage('authToken') ile kalıcı
  - user: { _id, name, email, phone, tc, role, serviceIds, isActive, ... }  (backend /me döndürdüğü sürece)
  - status: 'idle' | 'loading' | 'authenticated' | 'unauthenticated'
*/

const AuthContext = createContext(null);

/* ============================
   Provider
============================ */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("idle"); // ilk yüklenme
  const isAuthenticated = !!user;

  // user bilgisini LS'de tut (prod yazma kısıtı için)
  useEffect(() => {
    try {
      if (user) localStorage.setItem("authUser", JSON.stringify(user));
      else localStorage.removeItem("authUser");
    } catch {}
  }, [user]);

  // /me ile kullanıcıyı yenile
  const refresh = useCallback(async () => {
    const t = getToken();
    if (!t) {
      setUser(null);
      setStatus("unauthenticated");
      return null;
    }
    try {
      setStatus((s) => (s === "idle" ? "loading" : s));
      const me = await apiMe();
      setUser(me);
      setStatus("authenticated");
      return me;
    } catch (err) {
      // token geçersizse burada temizle
      try { setToken(""); } catch {}
      setUser(null);
      setStatus("unauthenticated");
      return null;
    }
  }, []);

  // ilk açılışta /me
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Sekmeler arası token değişimini dinle
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === "authToken") {
        // başka sekmede login/logout oldu
        refresh();
      }
    };
    window.addEventListener("storage", onStorage);

    // api.js 401 durumunda yaydığı event'i de dinle
    const onForcedLogout = () => {
      setUser(null);
      setStatus("unauthenticated");
    };
    window.addEventListener("auth:logout", onForcedLogout);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("auth:logout", onForcedLogout);
    };
  }, [refresh]);

  // Login akışı
  const login = useCallback(async ({ identifier, password }) => {
    setStatus("loading");
    const data = await apiLogin({ identifier, password });
    // api.js token'ı zaten set ediyor; /me ile kesinleştir
    const me = await refresh();
    return me || data;
  }, [refresh]);

  // Manual token set (opsiyonel): davet kabul vs. sonrası kullanılabilir
  const loginWithToken = useCallback(async (token) => {
    setToken(token || "");
    return refresh();
  }, [refresh]);

  // Logout
  const logout = useCallback(async () => {
    try { await apiLogout(); } catch {}
    setToken("");
    setUser(null);
    setStatus("unauthenticated");
  }, []);

  // Kullanışlı yardımcılar
  const hasRole = useCallback(
    (roles) => {
      if (!user || !user.role) return false;
      const arr = Array.isArray(roles) ? roles : [roles];
      return arr.includes(user.role);
    },
    [user]
  );

  const value = useMemo(
    () => ({
      user,
      status,            // 'idle' | 'loading' | 'authenticated' | 'unauthenticated'
      isAuthenticated,   // boolean
      login,
      loginWithToken,
      logout,
      refresh,
      hasRole,
      token: getToken(), // gerektiğinde erişim
    }),
    [user, status, isAuthenticated, login, loginWithToken, logout, refresh, hasRole]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/* ============================
   Hook
============================ */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth, AuthProvider içinde kullanılmalı.");
  }
  return ctx;
}

/* ============================
   Basit Guard Bileşenleri
============================ */
export function RequireAuth({ fallback = null, children }) {
  const { status, isAuthenticated } = useAuth();
  if (status === "idle" || status === "loading") return null; // istersen loader koy
  if (!isAuthenticated) return fallback;
  return children;
}

export function RequireRole({ roles, fallback = null, children }) {
  const { status, isAuthenticated, hasRole } = useAuth();
  if (status === "idle" || status === "loading") return null;
  if (!isAuthenticated) return fallback;
  if (!hasRole(roles)) return fallback;
  return children;
}

// (opsiyonel) default export isterse:
export default AuthProvider;
