// src/components/TopBar.jsx
import React from "react";
import { useAuth } from "../auth/AuthContext.jsx";

function Badge({ children, tone="slate" }) {
  const cls = {
    slate: "bg-slate-100 text-slate-700",
    blue:  "bg-sky-100 text-sky-700",
    red:   "bg-rose-100 text-rose-700",
    green: "bg-emerald-100 text-emerald-700",
  }[tone] || "bg-slate-100 text-slate-700";
  return <span className={`px-2 py-0.5 rounded-full text-[11px] ${cls}`}>{children}</span>;
}

export default function TopBar() {
  const { user, logout } = useAuth();
  if (!user) return null;

  const roleTone = user.role === "ADMIN" ? "red" : user.role === "AUTHORIZED" ? "blue" : "slate";

  return (
    <header className="w-full h-14 bg-white border-b flex items-center justify-between px-4">
      <div className="flex items-center gap-3">
        <div className="font-semibold">🏥 Hastane Nöbet Sistemi</div>
        <Badge tone="blue">v1</Badge>
      </div>

      <div className="flex items-center gap-3">
        {/* Kullanıcı */}
        <div className="text-right">
          <div className="text-sm font-medium leading-4">
            {user.name || user.email || "Kullanıcı"}
          </div>
          <div className="leading-4 mt-0.5">
            <Badge tone={roleTone}>{user.role}</Badge>
          </div>
        </div>

        {/* Çıkış */}
        <button
          onClick={logout}
          className="ml-2 h-9 px-3 rounded-md border bg-white hover:bg-slate-50"
          title="Çıkış"
        >
          Çıkış
        </button>
      </div>
    </header>
  );
}
