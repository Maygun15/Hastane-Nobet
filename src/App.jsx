// src/App.jsx
import React, { Suspense } from "react";
import { useAuth } from "./auth/AuthContext.jsx";
import HospitalRosterApp from "./app/HospitalRosterApp.jsx";
import AuthDemo from "./pages/AuthDemo.jsx";
import useActiveYM from "./hooks/useActiveYM.js";
import ResetPasswordPage from "./pages/ResetPassword.jsx"; // ← yeni: token’lı parola sıfırlama
import OfflineIndicator from "./components/OfflineIndicator.jsx";

/* Görünmez köprü: legacy plannerYear/plannerMonth varsa store'a ilk aşamada uygular,
   store değişince de eski anahtarları günceller (useActiveYM bu işi yapıyor). */
function YMBridge() {
  useActiveYM({ syncLegacyLS: true });
  return null;
}

/* Basit ErrorBoundary: beklenmedik hatalarda kullanıcı dostu mesaj. */
class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMsg: "" };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, errorMsg: error?.message || "Bilinmeyen hata" };
  }
  componentDidCatch(error, info) {
    // İstersen burada loglama yapabilirsin
    // console.error(error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 16, fontFamily: "system-ui", color: "#7f1d1d", background: "#fff1f2", borderRadius: 12, margin: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Bir şeyler ters gitti.</div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>{this.state.errorMsg}</div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ padding: 16, fontFamily: "system-ui" }}>
        Uygulama yükleniyor...
      </div>
    );
  }

  // Giriş yoksa ve rota /reset ise ResetPasswordPage'i göster
  const wantsReset =
    (!user) &&
    (
      (typeof location !== "undefined" && location.pathname.startsWith("/reset")) ||
      (typeof location !== "undefined" && (location.hash || "").startsWith("#/reset"))
    );

  return (
    <Suspense fallback={<div style={{ padding: 16 }}>Ekran yükleniyor…</div>}>
      <YMBridge />
      <OfflineIndicator />
      <AppErrorBoundary>
        {user ? (
          <HospitalRosterApp />
        ) : wantsReset ? (
          <ResetPasswordPage />
        ) : (
          <AuthDemo />
        )}
      </AppErrorBoundary>
    </Suspense>
  );
}
