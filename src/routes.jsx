// Legacy compatibility router. The active app shell still boots from src/main.jsx + src/App.jsx.
import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import AuthProvider, { useAuth } from "./auth/AuthContext.jsx";
import ErrorBoundary from "./app/ErrorBoundary.jsx";
import HospitalRosterApp from "./app/HospitalRosterApp.jsx";

// Sayfalar
import LoginPage from "./pages/Login.jsx";
import RosterPage from "./pages/RosterPage.jsx";
import StatsPage from "./pages/StatsPage.jsx";
import DutyRulesPage from "./pages/DutyRulesPage.jsx";
import HybridSchedulerPage from "./pages/HybridSchedulerPage.jsx";

function Protected({ children }) {
  const { user, token, loading } = useAuth();
  if (loading) return <div style={{ padding: 24 }}>Yükleniyor…</div>;
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

export default function AppRoutes() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/"
              element={
                <Protected>
                  <HospitalRosterApp />
                </Protected>
              }
            />
            <Route
              path="/roster"
              element={
                <Protected>
                  <RosterPage />
                </Protected>
              }
            />
            <Route
              path="/stats"
              element={
                <Protected>
                  <StatsPage />
                </Protected>
              }
            />
            <Route
              path="/duty-rules"
              element={
                <Protected>
                  <DutyRulesPage />
                </Protected>
              }
            />
            <Route
              path="/scheduler"
              element={
                <Protected>
                  <HybridSchedulerPage />
                </Protected>
              }
            />
            {/* bulunmayan rota → ana sayfa ya da login */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
