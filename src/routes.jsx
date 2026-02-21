// src/routes.jsx
import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import AuthProvider, { useAuth } from "./auth/AuthContext.jsx";

// Sayfalar
import LoginPage from "./pages/auth/Login.jsx";
// Örnek ana sayfa (senin mevcut ana bileşenin neyse onu içe aktar)
import AppHome from "./pages/Home.jsx"; // yoksa geçici bir component oluştur

function Protected({ children }) {
  const { user, token, loading } = useAuth();
  if (loading) return <div style={{ padding: 24 }}>Yükleniyor…</div>;
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

export default function AppRoutes() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <Protected>
                <AppHome />
              </Protected>
            }
          />
          {/* bulunmayan rota → ana sayfa ya da login */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
