// src/hooks/useServiceScope.js
import { useMemo } from "react";
import { useAuth } from "../auth/AuthContext.jsx";
import useServicesModel from "./useServicesModel.js";

export default function useServiceScope() {
  const { user } = useAuth();
  const servicesModel = useServicesModel();

  const isAdmin = String(user?.role || "").toUpperCase() === "ADMIN";

  const allowedIds = useMemo(() => {
    if (isAdmin) {
      return (servicesModel.list?.() || []).map(
        s => String(s.id ?? s._id ?? s.code ?? s.name)
      );
    }
    return (user?.serviceIds || []).map(String);
  }, [isAdmin, servicesModel, user]);

  const servicesById = useMemo(() => {
    const map = new Map();
    (servicesModel.list?.() || []).forEach(s => {
      const id = String(s.id ?? s._id ?? s.code ?? s.name);
      map.set(id, s);
    });
    return map;
  }, [servicesModel]);

  const defaultServiceId = useMemo(() => {
    if (isAdmin) return ""; // admin: Tümü
    return allowedIds[0] || "";
  }, [isAdmin, allowedIds]);

  // Kayıt -> servisId çıkarıcı yardımcı
  const getServiceId = (row) =>
    String(
      row?.serviceId ??
      row?.service ??
      row?.serviceCode ??
      row?.service_id ??
      row?.departmentId ??
      row?.sectionId ??
      ""
    );

  // Listeyi scope’a göre daralt
  function filterByScope(rows) {
    if (isAdmin) return rows || [];
    const allow = new Set(allowedIds);
    return (rows || []).filter(r => allow.has(getServiceId(r)));
  }

  return {
    isAdmin,
    allowedIds,
    defaultServiceId,
    servicesById,
    getServiceId,
    filterByScope,
  };
}
