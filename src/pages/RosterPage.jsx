import React, { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import RosterTable from "../components/RosterTable.jsx";
import ScheduleToolbar from "../components/ScheduleToolbar.jsx";
import { getMonthlySchedule, fetchPersonnel } from "../api/apiAdapter.js";
import { getPeople } from "../lib/dataResolver.js";
import { getAllLeaves } from "../lib/leaves.js";
import { LS } from "../utils/storage.js";
import { useAuth } from "../auth/AuthContext.jsx";

export default function RosterPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [loading, setLoading] = useState(false);
  const [peopleError, setPeopleError] = useState("");
  const [dataError, setDataError] = useState("");
  
  const [assignments, setAssignments] = useState([]);
  const [taskLines, setTaskLines] = useState([]);
  const [people, setPeople] = useState([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const tableRef = useRef(null);
  const { user } = useAuth();
  const [onlyMine, setOnlyMine] = useState(false);
  const [dayFilter, setDayFilter] = useState("all");
  const navigate = useNavigate();

  // İzinleri çek (yerel depolamadan)
  const allLeaves = useMemo(() => getAllLeaves(), []);

  // Aktif rolü LS'den al (DutyRowsEditor ile aynı mantık)
  const [role, setRole] = useState(() => LS.get("activeRole", "Nurse"));

  const handleRoleChange = (newRole) => {
    setRole(newRole);
    LS.set("activeRole", newRole);
  };

  useEffect(() => {
    let active = true;
    async function loadPeople() {
      try {
        // Backend'den güncel personel listesini çek
        const remoteList = await fetchPersonnel({ active: true });
        if (!active) return;
        
        if (remoteList && Array.isArray(remoteList)) {
          // Role uygun filtreleme (basit kontrol)
          const filtered = remoteList.filter(p => !role || p.role === role || p.title === role);
          setPeople(filtered);
        } else {
          setPeople(getPeople(role) || []);
        }
        setPeopleError("");
      } catch (err) {
        console.warn("Personel listesi sunucudan alınamadı, yerel veri kullanılıyor.", err);
        if (active) {
          setPeople(getPeople(role) || []);
          setPeopleError("Personel listesi alınamadı. Yerel veri kullanılıyor.");
        }
      }
    }
    loadPeople();
    return () => { active = false; };
  }, [role]);

  useEffect(() => {
    let active = true;
    async function fetchData() {
      setLoading(true);
      setDataError("");
      try {
        // Backend'den planı çek
        const res = await getMonthlySchedule({
          sectionId: "calisma-cizelgesi",
          serviceId: "", // Varsayılan servis
          role,
          year,
          month,
        });

        if (!active) return;

        if (res && res.data) {
          const { defs, roster } = res.data;
          
          // 1. Görev satırlarını (taskLines) ayarla
          setTaskLines(defs || []);

          // 2. Atamaları (assignments) düzleştir
          const flatAssignments = [];
          if (roster && roster.assignments) {
            // defs'i map'e çevir ki rowId -> label/shiftCode bulabilelim
            const defMap = new Map((defs || []).map(d => [String(d.id), d]));

            Object.entries(roster.assignments).forEach(([dayStr, rowObj]) => {
              const dayNum = Number(dayStr);
              if (!dayNum) return;
              const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;

              Object.entries(rowObj).forEach(([rowId, pids]) => {
                const def = defMap.get(String(rowId));
                if (def && Array.isArray(pids)) {
                  pids.forEach(pid => {
                    flatAssignments.push({
                      day: dateStr,
                      roleLabel: def.label,
                      shiftCode: def.shiftCode,
                      personId: pid,
                      hours: def.hours || 0, // Saat bilgisini ekle
                    });
                  });
                }
              });
            });
          }
          setAssignments(flatAssignments);
        } else {
          // Veri gelmezse hemen boşaltma, belki geçici bir ağ hatasıdır.
          // Sadece explicit null/boş array dönerse temizle.
          if (res && res.data === null) {
             setTaskLines([]);
             setAssignments([]);
          }
        }
      } catch (err) {
        console.error("RosterPage fetch error:", err);
        if (active) setDataError("Çizelge verisi alınamadı. Lütfen tekrar deneyin.");
      } finally {
        if (active) setLoading(false);
      }
    }

    fetchData();
    return () => { active = false; };
  }, [year, month, role]);

  const handlePrint = () => window.print();

  const handleEmail = () => {
    const subject = encodeURIComponent(`Nöbet Listesi - ${year}/${month}`);
    const body = encodeURIComponent(`Merhaba,\n\n${year}/${month} dönemi nöbet listesi hazırlanmıştır.\n\nİyi çalışmalar.`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(err => console.error(err));
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false));
    }
  };

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFsChange);
    };
  }, []);

  const handleToday = () => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const todayYmd = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    if (year !== currentYear || month !== currentMonth) {
      setYear(currentYear);
      setMonth(currentMonth);
      // Ay değişimi sonrası render'ı beklemek için kısa bir gecikme
      setTimeout(() => tableRef.current?.scrollToDate(todayYmd), 300);
    } else {
      tableRef.current?.scrollToDate(todayYmd);
    }
  };

  const handleAssignmentDelete = (cellData) => {
    if (!window.confirm(`${cellData.personName} için ${cellData.date} tarihindeki atamayı silmek istediğinize emin misiniz?`)) return;

    setAssignments((prev) => prev.filter((a) => {
      return !(
        a.day === cellData.date &&
        a.roleLabel === cellData.role &&
        a.shiftCode === cellData.shift &&
        String(a.personId) === String(cellData.personId)
      );
    }));
  };

  // Filtreleme Mantığı
  const filteredAssignments = useMemo(() => {
    if (!onlyMine || !user) return assignments;
    // Kullanıcı ID'si ile eşleşen atamaları filtrele
    const userId = String(user.id || user.personId || "");
    return assignments.filter((a) => String(a.personId) === userId);
  }, [assignments, onlyMine, user]);

  const filteredTaskLines = useMemo(() => {
    if (!onlyMine) return taskLines;
    // Sadece kullanıcının nöbeti olan satırları göster
    const activeKeys = new Set();
    filteredAssignments.forEach((a) => {
      activeKeys.add(`${a.roleLabel}|${a.shiftCode}`);
    });
    
    // Sadece benim nöbetlerim modunda, satır ayarlarını (kişi sayısı vb.) sadeleştir
    return taskLines
      .filter((tl) => activeKeys.has(`${tl.label}|${tl.shiftCode}`))
      .map(tl => onlyMine 
        ? { ...tl, defaultCount: 0, counts: {} } // Tek satır olsun, kırmızı uyarı vermesin
        : tl
      );
  }, [taskLines, filteredAssignments, onlyMine]);

  return (
    <div className="p-2 md:p-4 max-w-[1400px] mx-auto space-y-4">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: white; }
          @page { size: landscape; margin: 5mm; }
          .overflow-x-auto { overflow: visible !important; max-height: none !important; border: none !important; box-shadow: none !important; }
        }
      `}</style>

      <div className="no-print">
        <ScheduleToolbar
          title="Nöbet Listesi"
          year={year}
          month={month}
          setYear={setYear}
          setMonth={setMonth}
          onToday={handleToday}
          role={role}
          onRoleChange={handleRoleChange}
          onPrint={handlePrint}
          onEmail={handleEmail}
          onFullscreen={toggleFullscreen}
          isFullscreen={isFullscreen}
          onToggleMyShifts={user ? setOnlyMine : null}
          onlyMyShifts={onlyMine}
          dayFilter={dayFilter}
          onDayFilterChange={setDayFilter}
          onStats={() => navigate("/stats")}
        />
        {(peopleError || dataError) && (
          <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
            {peopleError && <div>{peopleError}</div>}
            {dataError && <div>{dataError}</div>}
          </div>
        )}
      </div>

      {loading ? (
        <div className="p-12 text-center text-slate-500 bg-white rounded-lg border shadow-sm">
          Yükleniyor...
        </div>
      ) : onlyMine && filteredAssignments.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 bg-white rounded-xl border border-dashed border-slate-300 shadow-sm text-center animate-in fade-in zoom-in duration-300">
          <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
            <span className="text-2xl">📅</span>
          </div>
          <h3 className="text-lg font-semibold text-slate-800">Bu ay nöbetiniz bulunmamaktadır</h3>
          <p className="text-slate-500 text-sm mt-1 max-w-xs mx-auto">
            {year} / {month} dönemi için size atanmış herhangi bir nöbet kaydı yok.
          </p>
          <button 
            onClick={() => setOnlyMine(false)}
            className="mt-6 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            Tüm Listeyi Göster
          </button>
        </div>
      ) : (
        <RosterTable
          ref={tableRef}
          year={year}
          month={month}
          assignments={filteredAssignments}
          taskLines={filteredTaskLines}
          people={people}
          allLeaves={allLeaves}
          compact={onlyMine}
          dayFilter={dayFilter}
          onAssignmentDelete={handleAssignmentDelete}
        />
      )}
    </div>
  );
}
