import React, { useMemo, useState, useCallback } from "react";
import useUsersModel from "../hooks/useUsersModel.js";
import ServiceAssigner from "../components/ServiceAssigner.jsx";
import { useAuth } from "../auth/AuthContext.jsx";
import { can } from "../utils/acl.js";
import { PERMISSIONS } from "../constants/roles.js";

export default function UsersAdminTab() {
  /* ---- HOOKLAR: her zaman, sabit sırayla ---- */
  const { user: me } = useAuth();
  const users = useUsersModel();

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignFor, setAssignFor] = useState(null);

  // Bu hook'u da daima çağır: (daha önce bazı renderlarda çağrılmıyorduysa hata yapar)
  const list = useMemo(() => users.list(), [users]);
  const canManage = useMemo(() => can(me, PERMISSIONS.SERVICE_MANAGE), [me]);

  const openAssign = useCallback((uid) => {
    setAssignFor(uid);
    setAssignOpen(true);
  }, []);

  const closeAssign = useCallback(() => {
    setAssignOpen(false);
    setTimeout(() => setAssignFor(null), 0);
  }, []);

  /* ---- RENDER ---- */
  return (
    <div className="p-4 space-y-4">
      <div className="text-lg font-semibold">Kullanıcılar</div>

      {!canManage && (
        <div className="p-4 text-sm text-slate-600 border rounded">
          Bu sayfa yalnızca admin içindir.
        </div>
      )}

      {canManage && (
        <>
          {list.length === 0 ? (
            <div className="text-sm text-slate-500">
              Henüz kayıtlı kullanıcı yok. (Liste LS'den okunur: <code>hastane:users</code>)
            </div>
          ) : (
            <div className="space-y-2">
              {list.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center justify-between border rounded px-3 py-2"
                >
                  <div className="text-sm">
                    <div className="font-medium">{u.name || u.email || u.id}</div>
                    <div className="text-xs text-slate-500">
                      Rol: <b>{u.role}</b>
                    </div>
                    <div className="text-xs text-slate-500">
                      Servis sayısı: {(u.serviceIds || []).length}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      className="border rounded px-2 py-1 text-sm"
                      value={u.role}
                      onChange={(e) => users.setRole(u.id, e.target.value)}
                    >
                      <option value="STANDARD">STANDARD</option>
                      <option value="AUTHORIZED">AUTHORIZED</option>
                      <option value="ADMIN">ADMIN</option>
                    </select>

                    <button
                      className="px-2 py-1 border rounded"
                      onClick={() => openAssign(u.id)}
                    >
                      Servis Ata
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Modal hep render edilir, görünürlük open ile kontrol edilir */}
      <ServiceAssigner open={assignOpen} userId={assignFor} onClose={closeAssign} />
    </div>
  );
}
