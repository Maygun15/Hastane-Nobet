import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import ScheduleToolbar from "../components/ScheduleToolbar.jsx";
import { getMonthlySchedule, fetchPersonnel } from "../api/apiAdapter.js";
import { getPeople } from "../lib/dataResolver.js";
import { LS } from "../utils/storage.js";
import { ArrowLeft, Download } from "lucide-react";

export default function StatsPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [role, setRole] = useState(() => LS.get("activeRole", "Nurse"));
  const [loading, setLoading] = useState(false);
  const [peopleError, setPeopleError] = useState("");
  const [dataError, setDataError] = useState("");
  const [data, setData] = useState(null);
  const [people, setPeople] = useState([]);
  const navigate = useNavigate();

  const handleRoleChange = (newRole) => {
    setRole(newRole);
    LS.set("activeRole", newRole);
  };

  // Personel listesini çek
  useEffect(() => {
    let active = true;
    async function loadPeople() {
      try {
        const res = await fetchPersonnel({ active: true });
        if (!active) return;
        if (Array.isArray(res)) setPeople(res);
        else setPeople(getPeople(role) || []);
        setPeopleError("");
      } catch (err) {
        if (!active) return;
        setPeople(getPeople(role) || []);
        setPeopleError("Personel listesi alınamadı. Yerel veri kullanılıyor.");
      }
    }
    loadPeople();
    return () => { active = false; };
  }, [role]);

  // Çizelge verisini çek
  useEffect(() => {
    let active = true;
    setLoading(true);
    setDataError("");
    getMonthlySchedule({ sectionId: "calisma-cizelgesi", role, year, month })
      .then(res => {
        if (!active) return;
        setData(res?.data);
      })
      .catch(() => {
        if (!active) return;
        setDataError("Çizelge verisi alınamadı. Lütfen tekrar deneyin.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [year, month, role]);

  // İstatistikleri hesapla
  const stats = useMemo(() => {
    const personStats = {};
    
    // Başlangıç değerleri (0) ile tüm personeli ekle
    people.filter(p => !role || p.role === role || p.title === role).forEach(p => {
        personStats[String(p.id)] = { 
            id: String(p.id), 
            name: p.fullName || p.name, 
            shifts: 0, 
            hours: 0, 
            weekends: 0,
            nights: 0 
        };
    });

    if (data?.roster?.assignments) {
        const assignments = data.roster.assignments;
        const rows = data.defs || [];
        const rowMap = new Map(rows.map(r => [String(r.id), r]));

        Object.entries(assignments).forEach(([dayStr, rowObj]) => {
            const day = Number(dayStr);
            const date = new Date(year, month - 1, day);
            const isWeekend = date.getDay() === 0 || date.getDay() === 6;

            Object.entries(rowObj).forEach(([rowId, pids]) => {
                const row = rowMap.get(String(rowId));
                if (!row) return;
                
                // Vardiya özellikleri
                const shiftCode = (row.shiftCode || "").toUpperCase();
                const isNight = ["N", "V1", "V2", "GECE"].includes(shiftCode);
                
                // Saat tahmini (eğer kayıtlı değilse)
                let hours = Number(row.hours) || 0;
                if (!hours) {
                    if (shiftCode === "V1") hours = 16;
                    else if (shiftCode === "V2") hours = 24;
                    else if (shiftCode === "M4") hours = 8;
                    else hours = 8; // Varsayılan
                }
                
                (pids || []).forEach(pid => {
                    const pidStr = String(pid);
                    if (!personStats[pidStr]) {
                        // Listede olmayan (örn: silinmiş) personel
                        personStats[pidStr] = { 
                            id: pidStr, 
                            name: "Bilinmeyen", 
                            shifts: 0, hours: 0, weekends: 0, nights: 0 
                        };
                    }
                    
                    const s = personStats[pidStr];
                    s.shifts += 1;
                    s.hours += hours;
                    if (isWeekend) s.weekends += 1;
                    if (isNight) s.nights += 1;
                });
            });
        });
    }

    return Object.values(personStats).sort((a, b) => b.hours - a.hours);
  }, [data, people, year, month, role]);

  const handleExport = () => {
    if (!stats.length) return;
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(stats.map(s => ({
      "Personel": s.name,
      "Toplam Nöbet": s.shifts,
      "Toplam Saat": s.hours,
      "Hafta Sonu": s.weekends,
      "Gece": s.nights,
      "Ort. Süre": s.shifts > 0 ? (s.hours / s.shifts).toFixed(1) : "0"
    })));
    ws['!cols'] = [{wch:25}, {wch:12}, {wch:12}, {wch:12}, {wch:10}, {wch:10}];
    XLSX.utils.book_append_sheet(wb, ws, "Rapor");
    XLSX.writeFile(wb, `Rapor_${year}-${String(month).padStart(2, '0')}.xlsx`);
  };

  return (
      <div className="p-2 md:p-4 max-w-[1400px] mx-auto space-y-4">
        <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
                <button onClick={() => navigate("/roster")} className="p-2 hover:bg-slate-100 rounded-full transition-colors" title="Listeye Dön">
                    <ArrowLeft size={20} className="text-slate-600" />
                </button>
                <h1 className="text-xl font-bold text-slate-800">Detaylı Rapor</h1>
            </div>
            <button onClick={handleExport} className="flex items-center gap-2 px-3 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 transition-colors shadow-sm">
                <Download size={16} />
                <span className="hidden sm:inline">Excel İndir</span>
            </button>
        </div>

        <ScheduleToolbar 
            title="Dönem Seçimi"
            year={year} month={month} setYear={setYear} setMonth={setMonth}
            role={role} onRoleChange={handleRoleChange}
        />

        {(peopleError || dataError) && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
            {peopleError && <div>{peopleError}</div>}
            {dataError && <div>{dataError}</div>}
          </div>
        )}
        
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div className="p-4 border-b bg-slate-50 flex justify-between items-center">
                <h3 className="font-semibold text-slate-700">Personel Performans Özeti</h3>
                <span className="text-xs text-slate-500 bg-white px-2 py-1 rounded border">{stats.length} Personel</span>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-slate-600 font-semibold border-b">
                        <tr>
                            <th className="p-3 pl-4">Personel</th>
                            <th className="p-3 text-center">Toplam Nöbet</th>
                            <th className="p-3 text-center">Toplam Saat</th>
                            <th className="p-3 text-center">Hafta Sonu</th>
                            <th className="p-3 text-center">Gece</th>
                            <th className="p-3 text-center">Ort. Süre</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {loading ? (
                            <tr><td colSpan={6} className="p-8 text-center text-slate-500">Hesaplanıyor...</td></tr>
                        ) : stats.length === 0 ? (
                            <tr><td colSpan={6} className="p-8 text-center text-slate-500">Veri bulunamadı.</td></tr>
                        ) : (
                            stats.map(s => (
                                <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                                    <td className="p-3 pl-4 font-medium text-slate-900">{s.name}</td>
                                    <td className="p-3 text-center">
                                        <span className="inline-block min-w-[2rem] py-0.5 rounded bg-slate-100 font-medium">{s.shifts}</span>
                                    </td>
                                    <td className="p-3 text-center font-bold text-sky-700">{s.hours}</td>
                                    <td className="p-3 text-center">
                                        {s.weekends > 0 ? <span className="text-amber-600 font-medium">{s.weekends}</span> : <span className="text-slate-300">-</span>}
                                    </td>
                                    <td className="p-3 text-center">
                                        {s.nights > 0 ? <span className="text-indigo-600 font-medium">{s.nights}</span> : <span className="text-slate-300">-</span>}
                                    </td>
                                    <td className="p-3 text-center text-slate-500 text-xs">
                                        {s.shifts > 0 ? (s.hours / s.shifts).toFixed(1) : "-"} sa
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
      </div>
  );
}
