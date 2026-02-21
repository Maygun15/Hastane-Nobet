import React from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.jsx";
import { isAdmin, hasServiceScope } from "../utils/guards.js";

export default function Sidebar() {
  const { user } = useAuth();
  const admin = isAdmin(user);
  const svcOK = hasServiceScope(user);

  return (
    <aside className="...">
      {/* Herkese açık linkler */}
      <NavLink to="/dashboard" className="...">Gösterge Paneli</NavLink>

      {/* Servis/Personel/Çizelgeler — yalnızca admin veya servis ataması olan */}
      {(admin || svcOK) && (
        <>
          <NavLink to="/services"  className="...">Servisler</NavLink>
          <NavLink to="/personnel" className="...">Personel</NavLink>
          <NavLink to="/schedules" className="...">Çizelgeler</NavLink>
        </>
      )}

      {/* Yalnızca admin */}
      {admin && (
        <NavLink to="/admin" className="...">Yönetim</NavLink>
      )}
    </aside>
  );
}
