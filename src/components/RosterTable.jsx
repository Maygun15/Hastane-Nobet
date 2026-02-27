import React, { useMemo, useState, useEffect, forwardRef, useImperativeHandle } from "react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import "jspdf-autotable";
import { X, Download, FileText, Copy, Info, Phone, Mail, Clock, Calendar, Hash, Trash2 } from "lucide-react";

/**
 * Nöbet çizelgesini tablo olarak gösteren bileşen.
 * 
 * @param {number} year - Yıl (örn: 2025)
 * @param {number} month - Ay (1-12)
 * @param {Array} assignments - Solver'dan dönen atama listesi [{ day, roleLabel, shiftCode, personId }, ...]
 * @param {Array} taskLines - Görev tanımları [{ label, shiftCode, defaultCount, counts }, ...]
 * @param {Array} people - Personel listesi [{ id, name }, ...]
 * @param {Object} allLeaves - İzin verileri { [personId]: { "YYYY-MM": { [day]: {code, note} } } }
 * @param {boolean} compact - Tabloyu sıkışık modda gösterir
 * @param {string} dayFilter - 'all' | 'weekday' | 'weekend'
 * @param {function} onAssignmentDelete - (cellData) => void
 * @param {function} onAssignmentUpdate - ({ date, personId, oldRole, oldShift, newRole, newShift }) => Promise<void>
 * @param {Array} workAreas - çalışma alanları (string[] veya {name}[])
 * @param {Array} workingHours - vardiya saatleri (örn: [{code,start,end}])
 */
const RosterTable = forwardRef(function RosterTable({
  year,
  month,
  assignments = [],
  taskLines = [],
  people = [],
  allLeaves = {},
  compact = false,
  dayFilter = "all",
  onAssignmentDelete,
  onAssignmentUpdate,
  workAreas = [],
  workingHours = [],
}, ref) {
  const [selectedCell, setSelectedCell] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [editRole, setEditRole] = useState("");
  const [editShift, setEditShift] = useState("");
  const [editError, setEditError] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, []);

  useEffect(() => {
    if (!selectedCell) return;
    setEditRole(selectedCell.role || "");
    setEditShift(selectedCell.shift || "");
    setEditError("");
  }, [selectedCell]);

  const handleContextMenu = (e, cellData) => {
    e.preventDefault();
    if (!cellData.personName) return;
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      data: cellData,
    });
  };

  const handleSaveEdit = async () => {
    if (!selectedCell || !onAssignmentUpdate) return;
    const newRole = String(editRole || "").trim();
    const newShift = String(editShift || "").trim();
    if (!newRole || !newShift) {
      setEditError("Alan ve vardiya seçmelisiniz.");
      return;
    }
    setEditSaving(true);
    setEditError("");
    try {
      await onAssignmentUpdate({
        date: selectedCell.date,
        personId: selectedCell.personId,
        oldRole: selectedCell.role,
        oldShift: selectedCell.shift,
        newRole,
        newShift,
      });
      setSelectedCell(null);
    } catch (err) {
      setEditError(err?.message || "Güncelleme başarısız.");
    } finally {
      setEditSaving(false);
    }
  };

  const handleExport = () => {
    if (!days.length) return;

    const wb = XLSX.utils.book_new();
    
    // Başlık satırı
    const header = ["Görev", "Vardiya"];
    days.forEach(d => {
      header.push(`${d.d} ${d.dayName}`);
    });
    
    const data = [header];

    renderRows.forEach(row => {
      const { taskLine, slotIndex } = row;
      const rowData = [
        taskLine.label,
        taskLine.shiftCode + (slotIndex > 0 ? ` (${slotIndex + 1})` : "")
      ];

      days.forEach(d => {
        const key = `${d.ymd}|${taskLine.label}|${taskLine.shiftCode}`;
        const assignedIds = assignmentsMap.get(key) || [];
        const pid = assignedIds[slotIndex];
        const name = pid ? personMap.get(String(pid)) : "";
        rowData.push(name);
      });
      data.push(rowData);
    });

    const ws = XLSX.utils.aoa_to_sheet(data);
    
    // Sütun genişlikleri
    const wscols = [{wch: 25}, {wch: 15}];
    days.forEach(() => wscols.push({wch: 12}));
    ws['!cols'] = wscols;

    XLSX.utils.book_append_sheet(wb, ws, "Nöbet Listesi");
    XLSX.writeFile(wb, `Nobet_Listesi_${year}-${String(month).padStart(2, '0')}.xlsx`);
  };

  const handleExportPDF = () => {
    if (!days.length) return;

    const doc = new jsPDF({ orientation: "landscape" });

    // Başlık
    doc.setFontSize(12);
    doc.text(`Nöbet Listesi - ${year}/${String(month).padStart(2, '0')}`, 14, 10);

    // Tablo Başlıkları
    const tableHead = [
      ["Görev", "Vardiya", ...days.map((d) => `${d.d}\n${d.dayName}`)]
    ];

    // Tablo Gövdesi
    const tableBody = renderRows.map((row) => {
      const { taskLine, slotIndex } = row;
      const rowData = [
        taskLine.label,
        taskLine.shiftCode + (slotIndex > 0 ? ` (${slotIndex + 1})` : "")
      ];

      days.forEach((d) => {
        const key = `${d.ymd}|${taskLine.label}|${taskLine.shiftCode}`;
        const assignedIds = assignmentsMap.get(key) || [];
        const pid = assignedIds[slotIndex];
        const name = pid ? personMap.get(String(pid)) : "";
        rowData.push(name);
      });
      return rowData;
    });

    doc.autoTable({
      startY: 15,
      head: tableHead,
      body: tableBody,
      theme: 'grid',
      styles: { fontSize: compact ? 5 : 6, cellPadding: compact ? 0.5 : 1, overflow: 'linebreak' },
      headStyles: { fillColor: [50, 50, 50], textColor: 255, fontSize: compact ? 5 : 6, halign: 'center', valign: 'middle' },
      columnStyles: { 0: { cellWidth: compact ? 15 : 20 }, 1: { cellWidth: compact ? 10 : 12 } },
      didParseCell: (data) => {
        // Hafta sonlarını renklendir
        if (data.section === 'body' && data.column.index >= 2) {
           const dayIndex = data.column.index - 2;
           if (days[dayIndex]?.isWeekend) {
             data.cell.styles.fillColor = [255, 229, 200]; // Daha belirgin turuncu
           }
        }
      }
    });

    doc.save(`Nobet_Listesi_${year}-${String(month).padStart(2, '0')}.pdf`);
  };

  // Dışarıdan erişilebilir metodlar
  useImperativeHandle(ref, () => ({
    scrollToDate: (ymd) => {
      const el = document.getElementById(`day-col-${ymd}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
        // Görsel vurgu efekti (opsiyonel)
        el.style.transition = "background-color 0.5s";
        const originalBg = el.style.backgroundColor;
        el.style.backgroundColor = "#bae6fd"; // blue-200
        setTimeout(() => { el.style.backgroundColor = originalBg; }, 1000);
      }
    }
  }));

  // 1. Günleri oluştur
  const days = useMemo(() => {
    if (!year || !month) return [];
    const all = buildMonthDaysLocal(year, month);
    if (dayFilter === "weekday") return all.filter(d => !d.isWeekend);
    if (dayFilter === "weekend") return all.filter(d => d.isWeekend);
    return all;
  }, [year, month, dayFilter]);

  // 2. Kişi lookup (id -> person object)
  const personMap = useMemo(() => {
    const map = new Map();
    people.forEach((p) => map.set(String(p.id), p));
    return map;
  }, [people]);

  const roleOptions = useMemo(() => {
    const set = new Set();
    (Array.isArray(workAreas) ? workAreas : []).forEach((item) => {
      if (item == null) return;
      if (typeof item === "string") {
        const v = item.trim();
        if (v) set.add(v);
        return;
      }
      if (typeof item === "object") {
        const v = String(item.name ?? item.label ?? item.title ?? item.code ?? "").trim();
        if (v) set.add(v);
      }
    });
    if (set.size) {
      return Array.from(set.values()).sort((a, b) => a.localeCompare(b, "tr", { sensitivity: "base" }));
    }
    // fallback: taskLines etiketleri
    const fallback = new Set();
    taskLines.forEach((t) => {
      const label = String(t.label || "").trim();
      if (label) fallback.add(label);
    });
    return Array.from(fallback.values()).sort((a, b) => a.localeCompare(b, "tr", { sensitivity: "base" }));
  }, [workAreas, taskLines]);

  const shiftOptions = useMemo(() => {
    const map = new Map();
    (Array.isArray(workingHours) ? workingHours : []).forEach((item) => {
      if (!item) return;
      const code = String(item.code ?? item.id ?? "").trim();
      if (!code) return;
      const start = String(item.start ?? "").trim();
      const end = String(item.end ?? "").trim();
      const labelRaw = String(item.label ?? item.name ?? "").trim();
      const time = start && end ? `${start}-${end}` : "";
      const label = labelRaw || (time ? `${code} (${time})` : code);
      map.set(code, { code, label });
    });
    if (map.size) {
      return Array.from(map.values()).sort((a, b) =>
        String(a.label || a.code).localeCompare(String(b.label || b.code), "tr", { sensitivity: "base" })
      );
    }
    // fallback: taskLines vardiya kodları
    const fallback = new Set();
    taskLines.forEach((t) => {
      const code = String(t.shiftCode || "").trim();
      if (code) fallback.add(code);
    });
    return Array.from(fallback.values())
      .sort((a, b) => a.localeCompare(b, "tr", { sensitivity: "base" }))
      .map((code) => ({ code, label: code }));
  }, [workingHours, taskLines]);

  // 3. Atamaları hızlı erişim için grupla: key = "YYYY-MM-DD|Role|Shift" -> [pid, pid, ...]
  const assignmentsMap = useMemo(() => {
    const map = new Map();
    for (const a of assignments) {
      const key = `${a.day}|${a.roleLabel}|${a.shiftCode}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(a.personId);
    }
    return map;
  }, [assignments]);

  // 4. Personel istatistiklerini hesapla (toplam saat/nöbet)
  const personStats = useMemo(() => {
    const visible = new Map();
    const monthly = new Map();
    const visibleDays = new Set(days.map(d => d.ymd));

    for (const a of assignments) {
      const pid = String(a.personId);
      const hrs = Number(a.hours) || 0;
      
      const dObj = new Date(a.day);
      const isWeekend = dObj.getDay() === 0 || dObj.getDay() === 6;

      // Aylık Toplam
      if (!monthly.has(pid)) monthly.set(pid, { hours: 0, shifts: 0, weekendShifts: 0 });
      const m = monthly.get(pid);
      m.hours += hrs;
      m.shifts += 1;
      if (isWeekend) m.weekendShifts += 1;

      // Görüntülenen (Filtreli) Toplam
      if (visibleDays.has(a.day)) {
        if (!visible.has(pid)) visible.set(pid, { hours: 0, shifts: 0 });
        const v = visible.get(pid);
        v.hours += hrs;
        v.shifts += 1;
      }
    }
    return { visible, monthly };
  }, [assignments, days]);

  // Modal için takvim gridi
  const calendarGrid = useMemo(() => {
    if (!year || !month) return [];
    const firstDay = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const startDay = (firstDay.getDay() + 6) % 7; // Pzt=0
    
    const grid = [];
    for (let i = 0; i < startDay; i++) grid.push(null);
    for (let i = 1; i <= daysInMonth; i++) grid.push(i);
    return grid;
  }, [year, month]);

  // 4. Satırları hazırla (TaskLine -> Slots)
  // Her görev satırı için, ay boyunca en fazla kaç kişi gerektiğini bul (maxSlots)
  const renderRows = useMemo(() => {
    const rows = [];
    
    for (const tl of taskLines) {
      // Bu görev için GÖRÜNTÜLENEN GÜNLERDE en fazla kaç kişi lazım?
      // (Eskiden tüm ayı tarıyorduk, şimdi sadece filtrelenen günlere bakıyoruz)
      let maxSlots = 0;
      
      if (days.length === 0) {
         maxSlots = tl.defaultCount || 0;
      } else {
         for (const d of days) {
            let req = tl.defaultCount || 0;
            if (tl.counts && tl.counts[d.d] !== undefined) req = tl.counts[d.d];
            if (tl.weekendOff && d.isWeekend) req = 0; // Hafta sonu kapalıysa 0
            maxSlots = Math.max(maxSlots, req);
         }
      }

      if (maxSlots < 1) maxSlots = 1; // En az 1 satır göster

      for (let s = 0; s < maxSlots; s++) {
        rows.push({
          taskLine: tl,
          slotIndex: s,
          key: `${tl.label}-${tl.shiftCode}-${s}`,
        });
      }
    }
    return rows;
  }, [taskLines, days]); // days değişince (filtre) satır sayısı da yeniden hesaplansın

  if (!year || !month) return <div className="p-4 text-gray-500 text-sm">Tarih bilgisi eksik.</div>;
  if (!days.length) return null;

  return (
    <div className="space-y-2">
      <div className="flex justify-end gap-2 no-print">
        <button 
          onClick={handleExportPDF}
          className="flex items-center gap-2 px-3 py-2 bg-rose-600 text-white rounded-lg text-sm hover:bg-rose-700 transition-colors shadow-sm"
        >
          <FileText size={16} />
          PDF İndir
        </button>
        <button 
          onClick={handleExport}
          className="flex items-center gap-2 px-3 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 transition-colors shadow-sm"
        >
          <Download size={16} />
          Excel'e İndir
        </button>
      </div>

      <div className="overflow-x-auto border rounded-lg shadow-sm bg-white max-h-[80vh]">
      <table className="w-full border-collapse text-sm text-left relative">
        <thead className="bg-slate-50 text-slate-700 sticky top-0 z-20 shadow-sm">
          <tr>
            <th className={`${compact ? "p-2 min-w-[100px] text-xs" : "p-2 md:p-3 min-w-[100px] md:min-w-[160px] text-xs md:text-sm"} border-b border-r font-semibold sticky left-0 bg-slate-50 z-30 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]`}>
              Görev / Vardiya
            </th>
            {days.map((d) => (
              <th
                key={d.ymd}
                id={`day-col-${d.ymd}`}
                className={`${compact ? "p-0.5 min-w-[32px]" : "p-1 min-w-[36px] md:min-w-[44px]"} border-b border-r text-center ${
                  d.isWeekend ? "bg-orange-100 text-orange-900" : "text-slate-600"
                }`}
              >
                <div className="text-xs font-bold">{d.d}</div>
                <div className="text-[10px] font-normal opacity-75">
                  {d.dayName}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {renderRows.map((row) => {
            const { taskLine, slotIndex } = row;
            const label = `${taskLine.label} (${taskLine.shiftCode})`;
            
            return (
              <tr key={row.key} className="border-b hover:bg-blue-50 transition-colors group">
                <td className={`${compact ? "p-1.5 max-w-[100px] text-xs" : "p-2 max-w-[100px] md:max-w-[160px] text-xs md:text-sm"} border-r font-medium text-slate-700 sticky left-0 bg-white group-hover:bg-blue-50 z-10 truncate shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] transition-colors`} title={label}>
                  <div className="flex items-center justify-between">
                    <span>{taskLine.label}</span>
                    <span className="text-[10px] bg-slate-100 px-1 rounded text-slate-500">{taskLine.shiftCode}</span>
                  </div>
                  {slotIndex > 0 && <div className="text-[10px] text-slate-400 text-right">#{slotIndex + 1}</div>}
                </td>
                {days.map((d) => {
                  const key = `${d.ymd}|${taskLine.label}|${taskLine.shiftCode}`;
                  const assignedIds = assignmentsMap.get(key) || [];
                  const pid = assignedIds[slotIndex]; // Bu slota düşen kişi
          const person = pid ? personMap.get(String(pid)) : null;
          const name = person ? (person.name || person.fullName || "Bilinmeyen") : null;

                  const cellData = {
                    date: d.ymd,
                    role: taskLine.label,
                    shift: taskLine.shiftCode,
                    personName: name,
                    personId: pid,
            person, // Tüm personel nesnesini taşı
                  };

          // Personelin toplam saati ve nöbet sayısı (Modal için)
          if (person) {
            const vStats = personStats.visible.get(String(pid));
            const mStats = personStats.monthly.get(String(pid));
            if (vStats) {
              cellData.totalHours = vStats.hours;
              cellData.totalShifts = vStats.shifts;
            }
            if (mStats) {
              cellData.monthlyHours = mStats.hours;
              cellData.monthlyShifts = mStats.shifts;
              cellData.weekendShifts = mStats.weekendShifts;
            }
          }

          // Personelin o ayki izinleri (Modal için)
          if (person && !cellData.leaves) {
            const pidStr = String(pid);
            const ym = `${year}-${String(month).padStart(2, "0")}`;
            const monthLeaves = allLeaves[pidStr]?.[ym];
            if (monthLeaves) {
              cellData.leaves = Object.entries(monthLeaves)
                .map(([dayStr, val]) => ({
                  day: Number(dayStr),
                  code: val.code,
                  note: val.note
                }))
                .sort((a, b) => a.day - b.day);
            }
          }

                  // İhtiyaç analizi: O gün kaç kişi lazım?
                  const neededCount = (taskLine.counts && taskLine.counts[d.d] !== undefined)
                    ? taskLine.counts[d.d]
                    : (taskLine.defaultCount || 0);
                  
                  // Hafta sonu kapalıysa ihtiyaç 0
                  const isWeekendOff = taskLine.weekendOff && d.isWeekend;
                  const effectiveNeeded = isWeekendOff ? 0 : neededCount;

                  // Gerekli olduğu halde boş mu?
                  const isMissing = !name && slotIndex < effectiveNeeded;

                  // Hücre stili
                  let cellClass = `${compact ? "p-0.5 h-8" : "p-1 h-10"} border-r text-center text-xs whitespace-nowrap overflow-hidden text-ellipsis transition-colors`;
                  
                  if (name) {
                    if (d.isWeekend) cellClass += " bg-orange-50";
                    cellClass += " cursor-pointer hover:bg-sky-50";
                  } else if (isMissing) {
                    cellClass += " bg-red-100 hover:bg-red-200"; // Boş ve gerekli -> Kırmızı
                  } else {
                    if (d.isWeekend) cellClass += " bg-orange-50";
                  }
                  
                  return (
                    <td 
                      key={`${row.key}-${d.ymd}`} 
                      className={cellClass} 
                      title={name || (isMissing ? "Atama Bekliyor" : "")}
                      onClick={() => name && setSelectedCell(cellData)}
                      onContextMenu={(e) => handleContextMenu(e, cellData)}
                    >
                      {name ? (
                        <span className={`inline-block w-full ${compact ? "px-0.5 py-0 text-[10px]" : "px-1 py-1 text-[11px]"} rounded bg-sky-100 text-sky-700 font-medium truncate`}>
                          {name}
                        </span>
                      ) : (
                        <span className={isMissing ? "text-red-400 font-bold" : "text-slate-200 text-[10px]"}>
                          {isMissing ? "!" : "•"}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {!renderRows.length && (
            <tr>
              <td colSpan={days.length + 1} className="p-8 text-center text-slate-400">
                Gösterilecek görev satırı bulunamadı.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Detay Modalı */}
      {selectedCell && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setSelectedCell(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200" onClick={e => e.stopPropagation()}>
            <div className="bg-slate-50 px-4 py-3 border-b flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">Vardiya Detayı</h3>
              <button onClick={() => setSelectedCell(null)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">Tarih</span>
                <span className="text-sm font-medium text-slate-800">{selectedCell.date}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">Görev</span>
                <span className="text-sm font-medium text-slate-800">{selectedCell.role}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">Vardiya</span>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">
                  {selectedCell.shift}
                </span>
              </div>
              {onAssignmentUpdate && (
                <div className="mt-3 pt-3 border-t border-dashed border-slate-200 space-y-2">
                  <div className="text-xs text-slate-500 font-medium">Atama Düzenle</div>
                  <label className="flex flex-col gap-1 text-xs">
                    Alan
                    <select
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value)}
                      className="h-8 rounded border px-2 text-xs"
                    >
                      <option value="">Seç...</option>
                      {roleOptions.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs">
                    Vardiya
                    <select
                      value={editShift}
                      onChange={(e) => setEditShift(e.target.value)}
                      className="h-8 rounded border px-2 text-xs"
                    >
                      <option value="">Seç...</option>
                      {shiftOptions.map((opt) => (
                        <option key={opt.code} value={opt.code}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {editError && <div className="text-xs text-rose-600">{editError}</div>}
                </div>
              )}
              <div className="pt-2 border-t mt-2">
                <div className="text-xs text-slate-500 mb-1">Personel</div>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-sky-100 flex items-center justify-center text-sky-700 font-bold text-xs">
                    {selectedCell.personName?.charAt(0)}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-800">{selectedCell.personName}</div>
                    {selectedCell.personId && <div className="text-[10px] text-slate-400">ID: {selectedCell.personId}</div>}
                  </div>
                </div>

                {/* Toplam Saat ve Nöbet Bilgisi */}
                {(selectedCell.totalHours !== undefined || selectedCell.totalShifts !== undefined) && (
                  <div className="mt-3 flex flex-col gap-1 text-sm text-slate-700 bg-slate-50 p-2 rounded-lg border border-slate-100">
                    <div className="flex items-center gap-2">
                      <Clock size={16} className="text-slate-400" />
                      <span>
                        {dayFilter === 'all' ? 'Bu ay toplam' : 'Görüntülenen'}: <strong>{selectedCell.totalHours}</strong> saat.
                        {dayFilter !== 'all' && selectedCell.monthlyHours !== undefined && <span className="text-xs text-slate-500 ml-1">(Ay: {selectedCell.monthlyHours})</span>}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Hash size={16} className="text-slate-400" />
                      <span>
                        {dayFilter === 'all' ? 'Bu ay toplam' : 'Görüntülenen'}: <strong>{selectedCell.totalShifts}</strong> nöbet.
                        {dayFilter !== 'all' && selectedCell.monthlyShifts !== undefined && <span className="text-xs text-slate-500 ml-1">(Ay: {selectedCell.monthlyShifts})</span>}
                      </span>
                    </div>
                    {selectedCell.weekendShifts !== undefined && (
                      <div className="flex items-center gap-2 text-xs text-slate-500 pl-6">
                        <span>• Hafta Sonu: <strong>{selectedCell.weekendShifts}</strong> nöbet</span>
                      </div>
                    )}
                  </div>
                )}

                {/* İzin Bilgileri */}
                {selectedCell.leaves && selectedCell.leaves.length > 0 && (
                  <div className="mt-3 pt-2 border-t border-dashed border-slate-200">
                    <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
                      <Calendar size={12} />
                      <span className="font-medium">Bu Ayki İzinler</span>
                    </div>
                    <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                      <div className="grid grid-cols-7 gap-1 text-center mb-1">
                        {["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"].map(d => (
                          <div key={d} className="text-[9px] text-slate-400 font-medium">{d}</div>
                        ))}
                      </div>
                      <div className="grid grid-cols-7 gap-1">
                        {calendarGrid.map((day, idx) => {
                          if (!day) return <div key={idx} />;
                          const leave = selectedCell.leaves.find(l => l.day === day);
                          const date = new Date(year, month - 1, day);
                          const isWeekend = date.getDay() === 0 || date.getDay() === 6;

                          let cellClass = "h-7 flex items-center justify-center rounded text-[10px] relative transition-colors border";
                          if (leave) cellClass += " bg-rose-100 text-rose-700 font-bold cursor-help border-rose-200";
                          else if (isWeekend) cellClass += " bg-slate-100 text-slate-400 border-transparent";
                          else cellClass += " bg-white text-slate-600 border-slate-100";

                          return (
                            <div key={idx} className={cellClass} title={leave ? `${leave.code}${leave.note ? ': ' + leave.note : ''}` : ''}>
                              {day}
                              {leave && <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-rose-500 text-white text-[9px] flex items-center justify-center rounded-full shadow-sm z-10 border border-white">{leave.code}</span>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* İletişim Bilgileri */}
                {selectedCell.person && (selectedCell.person.phone || selectedCell.person.email) && (
                  <div className="mt-3 pt-2 border-t border-dashed border-slate-200 space-y-1.5">
                    {selectedCell.person.phone && (
                      <div className="flex items-center gap-2 text-xs text-slate-600">
                        <Phone size={12} className="text-slate-400" />
                        <span>{selectedCell.person.phone}</span>
                      </div>
                    )}
                    {selectedCell.person.email && (
                      <div className="flex items-center gap-2 text-xs text-slate-600">
                        <Mail size={12} className="text-slate-400" />
                        <a href={`mailto:${selectedCell.person.email}`} className="hover:text-sky-600 transition-colors">
                          {selectedCell.person.email}
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="bg-slate-50 px-4 py-3 border-t flex justify-end gap-2">
              {onAssignmentUpdate && (
                <button
                  onClick={handleSaveEdit}
                  disabled={editSaving}
                  className="px-4 py-2 bg-sky-600 text-white rounded-lg text-sm font-medium hover:bg-sky-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  Kaydet
                </button>
              )}
              <button 
                onClick={() => setSelectedCell(null)}
                className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-white border border-slate-200 rounded-lg shadow-xl py-1 text-sm text-slate-700 min-w-[160px] animate-in fade-in zoom-in duration-100 origin-top-left"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2 text-xs font-semibold text-slate-500 border-b mb-1 bg-slate-50 truncate max-w-[200px]">
            {contextMenu.data.personName}
          </div>
          <button
            className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 transition-colors"
            onClick={() => {
              setSelectedCell(contextMenu.data);
              setContextMenu(null);
            }}
          >
            <Info size={14} className="text-sky-600" />
            <span>Detay Göster</span>
          </button>
          <button
            className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 transition-colors"
            onClick={() => {
              navigator.clipboard.writeText(contextMenu.data.personName);
              setContextMenu(null);
            }}
          >
            <Copy size={14} className="text-slate-500" />
            <span>Adı Kopyala</span>
          </button>
          {onAssignmentDelete && (
            <button
              className="w-full text-left px-3 py-2 hover:bg-rose-50 text-rose-600 flex items-center gap-2 transition-colors border-t border-slate-100"
              onClick={() => {
                onAssignmentDelete(contextMenu.data);
                setContextMenu(null);
              }}
            >
              <Trash2 size={14} />
              <span>Atamayı Sil</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
});

export default RosterTable;

// Yardımcı fonksiyon: Ayın günlerini oluşturur
function buildMonthDaysLocal(year, month) {
  const days = [];
  const date = new Date(year, month - 1, 1);
  const dayNames = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
  while (date.getMonth() === month - 1) {
    const ymd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const dow = date.getDay();
    days.push({
      d: date.getDate(),
      ymd,
      isWeekend: dow === 0 || dow === 6,
      dayName: dayNames[dow]
    });
    date.setDate(date.getDate() + 1);
  }
  return days;
}
