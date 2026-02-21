// src/reports/TopluIzinCizelgesi.jsx
import React, { useMemo, useState } from "react";
import { ROLE } from "../constants/enums.js";
import { cn } from "../utils/classnames.js";
import CalendarBlock from "../components/CalendarBlock.jsx";
import ServiceGrid from "../components/ServiceGrid.jsx";
import MonthlyLeavesMatrixGeneric from "../tabs/MonthlyLeavesMatrixGeneric.jsx";

export default function TopluIzinCizelgesi({ peopleAll = [] }) {
  const today = new Date();
  // Varsayılanı Planlama’dakiyle uyumlu (0-baz ay)
  const [year, setYear] = useState(
    Number(localStorage.getItem("plannerYear")) || today.getFullYear()
  );
  const [month, setMonth] = useState(
    Number(localStorage.getItem("plannerMonth")) || today.getMonth()
  );
  const [selectedService, setSelectedService] = useState(
    localStorage.getItem("activeServiceId") || null
  );
  const [selectedRole, setSelectedRole] = useState(
    localStorage.getItem("activeRole") || (ROLE?.Nurse ?? "NURSE")
  );

  const roleLabel = selectedRole === (ROLE?.Nurse ?? "NURSE") ? "Hemşireler" : "Doktorlar";

  const staff = useMemo(
    () =>
      (Array.isArray(peopleAll) ? peopleAll : []).filter(
        (p) => p?.role === selectedRole && (!selectedService || p?.service === selectedService)
      ),
    [peopleAll, selectedRole, selectedService]
  );

  // Üst gezinme okları (Planlama ile aynı davranış)
  const goPrevMonth = () => {
    const nm = (month + 11) % 12;
    const ny = nm === 11 ? year - 1 : year;
    setMonth(nm);
    setYear(ny);
  };
  const goNextMonth = () => {
    const nm = (month + 1) % 12;
    const ny = nm === 0 ? year + 1 : year;
    setMonth(nm);
    setYear(ny);
  };

  return (
    <div className="space-y-4">
      {/* Başlık ve ay gezgini */}
      <div className="bg-white rounded-2xl shadow-sm p-4 flex items-center justify-between">
        <div className="font-semibold">Çizelgeler — Toplu İzin Çizelgesi</div>
        <div className="flex items-center gap-2 text-sm">
          <button onClick={goPrevMonth} className="px-2 py-1 rounded bg-slate-100">
            Önceki Ay
          </button>
          <div className="text-slate-500">{month + 1}.{year}</div>
          <button onClick={goNextMonth} className="px-2 py-1 rounded bg-slate-100">
            Sonraki Ay
          </button>
        </div>
      </div>

      {/* Servis seçici (kişilerden türetir) */}
      <ServiceGrid
        onSelect={(sid) => setSelectedService(sid)}
        peopleAll={Array.isArray(peopleAll) ? peopleAll : []}
      />

      {/* Rol butonları */}
      <div className="flex items-center gap-1 text-sm bg-white rounded-xl border p-1">
        <button
          className={cn(
            "px-3 py-1.5 rounded-lg",
            selectedRole === (ROLE?.Nurse ?? "NURSE") ? "bg-slate-900 text-white" : "bg-transparent"
          )}
          onClick={() => setSelectedRole(ROLE?.Nurse ?? "NURSE")}
          type="button"
          title="Hemşire"
        >
          Hemşire
        </button>
        <button
          className={cn(
            "px-3 py-1.5 rounded-lg",
            selectedRole === (ROLE?.Doctor ?? "DOCTOR") ? "bg-slate-900 text-white" : "bg-transparent"
          )}
          onClick={() => setSelectedRole(ROLE?.Doctor ?? "DOCTOR")}
          type="button"
          title="Doktor"
        >
          Doktor
        </button>
      </div>

      {/* Ay görünümü (sadece görsel referans; istersen kaldırılabilir) */}
      <CalendarBlock month={month} year={year} />

      {/* 🔶 Asıl tablo: MonthlyLeavesMatrixGeneric
          - showExport: raporlarda butonu göstermek istersen true yap.
          - personLeaves prop'u vermiyoruz; bileşen ortak depodan okuyor ve canlı dinliyor. */}
      <MonthlyLeavesMatrixGeneric
        title={`Toplu İzin Çizelgesi — ${roleLabel}`}
        people={staff}
        year={year}
        month={month}
        selectedService={selectedService}
        showExport={true}
      />
    </div>
  );
}
