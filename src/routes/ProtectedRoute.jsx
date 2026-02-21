// src/routes/ProtectedRoute.jsx
import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.jsx";
import { canViewModule } from "../utils/guards.js";

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) return null; // veya küçük bir spinner
  if (!user) return <Navigate to="/login" replace />;

  if (!canViewModule(user)) {
    return (
      <div className="m-6 p-4 rounded-lg bg-amber-50 text-amber-800 text-sm">
        Bu sayfayı görüntülemek için servis ataması gereklidir. Lütfen yöneticinizle iletişime geçin.
      </div>
    );
  }
  return children;
}
