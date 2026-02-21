// src/tabs/UsersAdminTab.jsx
import React from "react";
import useUsersModel from "../hooks/useUsersModel.js";
import ServiceAssigner from "../components/ServiceAssigner.jsx";
import { useAuth } from "../auth/AuthContext.jsx";
import { can } from "../utils/acl.js";
import { PERMISSIONS } from "../constants/roles.js";

export default function UsersAdminTab(){
  const { user: me } = useAuth();
  const users = useUsersModel();
  const [assignFor, setAssignFor] = React.useState(null); // userId

  if (!can(me, PERMISSIONS.SERVICE_MANAGE)) {
    return <div className="p-4 text-sm text-slate-600">Bu sayfa yalnızca admin içindir.</div>;
  }

  const list = users.list(); // [{id, name, email, role, serviceIds:[]}, ...]

  return (
    <div className="p-4 space-y-3">
      <div className="text-lg font-semibold">Kullanıcılar</div>

      {list.length === 0 && (
        <div className="text-sm text-slate-500">Henüz kayıtlı kullanıcı yok.</div>
      )}

      <div className="space-y-2">
        {list.map(u => (
          <div key={u.id} className="flex items-center justify-between border rounded px-3 py-2">
            <div className="text-sm">
              <div className="font-medium">{u.name || u.email}</div>
              <div className="text-xs text-slate-500">Rol: <b>{u.role}</b></div>
              <div className="text-xs text-slate-500">Servisler: {(u.serviceIds||[]).length} adet</div>
            </div>
            <div className="flex items-center gap-2">
              <select
                className="border rounded px-2 py-1 text-sm"
                value={u.role}
                onChange={(e)=>users.setRole(u.id, e.target.value)}
              >
                <option value="STANDARD">STANDARD</option>
                <option value="AUTHORIZED">AUTHORIZED</option>
                <option value="ADMIN">ADMIN</option>
              </select>
              <button className="px-2 py-1 border rounded" onClick={()=>setAssignFor(u.id)}>
                Servis Ata
              </button>
            </div>
          </div>
        ))}
      </div>

      {assignFor && (
        <ServiceAssigner userId={assignFor} onClose={()=>setAssignFor(null)} />
      )}
    </div>
  );
}
