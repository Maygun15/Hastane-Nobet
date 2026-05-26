// src/components/PersonalShiftSummary.jsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { fetchMergedScheduleTruth } from "../utils/scheduleTruth.js";
import { fetchHolidayCalendar } from "../api/apiAdapter.js";
import { API } from "../lib/api.js";
import { useAppStore } from "../state/appStore.js";
import { resolvePersonId, resolvePersonRef, canonName } from "../utils/personIdentity.js";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { toast } from "sonner";

// ── Sabitler ──────────────────────────────────────────────────────────────────

const NIGHT_CODES = new Set(["N", "V1", "V2", "SV", "G", "GECE", "NIGHT"]);
const SHIFT_HOURS_FALLBACK = { N: 24, V2: 24, V1: 16, M: 8, M4: 8 };
const TR_MONTHS = ["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"];
const TR_DAYS   = ["Paz","Pzt","Sal","Çar","Per","Cum","Cmt"];

function dayName(ymd) {
  if (!ymd) return "";
  return TR_DAYS[new Date(String(ymd).slice(0, 10)).getDay()] || "";
}

// Türkçe → ASCII dönüşümü — jsPDF'in Helvetica (Latin-1) fontu için zorunlu.
// Önce Türkçeye özgü harfler (NFD öncesi), sonra kalan diakritikler NFD ile temizlenir.
function forPdf(s) {
  if (!s) return "";
  return String(s)
    .replace(/İ/g, "I").replace(/ı/g, "i")
    .replace(/Ş/g, "S").replace(/ş/g, "s")
    .replace(/Ğ/g, "G").replace(/ğ/g, "g")
    .replace(/Ü/g, "U").replace(/ü/g, "u")
    .replace(/Ö/g, "O").replace(/ö/g, "o")
    .replace(/Ç/g, "C").replace(/ç/g, "c")
    .replace(/[—–]/g, "-")
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/…/g, "...")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

// ── Yardımcı fonksiyonlar ──────────────────────────────────────────────────────

function resolveHours(a) {
  if (a.hours && typeof a.hours === "number" && a.hours > 0) return a.hours;
  const code = String(a.shiftCode || "").toUpperCase();
  return SHIFT_HOURS_FALLBACK[code] ?? 0;
}

function isWeekend(ymd) {
  if (!ymd) return false;
  const d = new Date(String(ymd).slice(0, 10));
  return d.getDay() === 0 || d.getDay() === 6;
}

function fmtTurkishDate(ymd) {
  if (!ymd) return "—";
  const parts = String(ymd).slice(0, 10).split("-").map(Number);
  return `${parts[2]} ${TR_MONTHS[(parts[1] - 1)] ?? ""}`;
}

function resolvePersonFromUser(me, people = []) {
  const found = resolvePersonRef(me, people);
  if (found) return resolvePersonId(found);

  const direct = resolvePersonId(me);
  if (direct) return direct;

  const meCanon = canonName(
    me?.fullName || me?.name || me?.displayName || me?.username || ""
  );
  if (!meCanon) return "";
  const match = people.find((p) => {
    const pCanon = p.canon || canonName(p.fullName || p.name || p.displayName || "");
    return pCanon && pCanon === meCanon;
  });
  return match ? resolvePersonId(match) : "";
}

function getThisWeekHours(mine) {
  const today = new Date();
  const mon = new Date(today);
  mon.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  mon.setHours(0, 0, 0, 0);
  const nextMon = new Date(mon);
  nextMon.setDate(mon.getDate() + 7);
  return mine
    .filter((a) => {
      const d = new Date(String(a.date || a.day || "").slice(0, 10));
      return d >= mon && d < nextMon;
    })
    .reduce((sum, a) => sum + resolveHours(a), 0);
}

function weekIntensityLabel(h) {
  if (h === 0) return "Nöbet yok";
  if (h <= 16) return "Hafif";
  if (h <= 32) return "Orta";
  return "Yoğun";
}

function monthIntensityLabel(h) {
  if (h <= 120) return "Hafif";
  if (h <= 180) return "Normal";
  if (h <= 240) return "Yoğun";
  return "Çok Yoğun";
}

function getNextShift(mine) {
  const todayYmd = new Date().toISOString().slice(0, 10);
  const future = mine
    .map((a) => ({ a, d: String(a.date || a.day || "").slice(0, 10) }))
    .filter(({ d }) => d > todayYmd)
    .sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : 0));
  if (!future.length) return null;
  return { dateStr: future[0].d, shiftCode: future[0].a.shiftCode || "" };
}

// Kayıt zenginlik puanı: saat > 0 → 4, shiftCode dolu → 2, roleLabel dolu → 1
function richScore(a) {
  return (resolveHours(a) > 0 ? 4 : 0)
    + (!!String(a.shiftCode || a.shiftId || a.shift || a.code || "").trim() ? 2 : 0)
    + (!!String(a.roleLabel || a.rowLabel || a.label || "").trim() ? 1 : 0);
}

// Birden fazla servis bucket'ından gelen atamaları birleştirip tekilleştirir.
// Key intentionally excludes roleLabel: aynı slot farklı etiketle gelirse duplicate sayılmaz.
// Aynı date|person|shift grubunda en zengin kayıt tercih edilir.
// Aynı gün|kişi için gerçek kayıt (saat>0 veya shift dolu) varsa placeholder kaldırılır.
function normalizeForSummary(assignments) {
  if (!Array.isArray(assignments)) return [];

  // Adım 1 — date|person|shift grubunda en zengin kaydı tut
  const groups = new Map();
  for (const a of assignments) {
    if (!a || typeof a !== "object") continue;
    const date = String(a.date || a.day || "").slice(0, 10);
    if (!date) continue;
    const person = String(a.personId || a.pid || a.staffId || "").trim()
      || canonName(a.personName || a.fullName || a.name || "");
    const shift = String(a.shiftCode || a.shiftId || a.shift || a.code || "").trim().toUpperCase();
    const key = `${date}|${person}|${shift}`;
    const prev = groups.get(key);
    if (!prev || richScore(a) > richScore(prev)) groups.set(key, a);
  }

  // Adım 2 — aynı date|person için gerçek kayıt varsa placeholder'ı çıkar
  const realExists = new Set();
  for (const a of groups.values()) {
    if (richScore(a) > 0) {
      const date = String(a.date || a.day || "").slice(0, 10);
      const person = String(a.personId || a.pid || a.staffId || "").trim()
        || canonName(a.personName || a.fullName || a.name || "");
      realExists.add(`${date}|${person}`);
    }
  }

  return Array.from(groups.values()).filter((a) => {
    if (richScore(a) > 0) return true;
    const date = String(a.date || a.day || "").slice(0, 10);
    const person = String(a.personId || a.pid || a.staffId || "").trim()
      || canonName(a.personName || a.fullName || a.name || "");
    return !realExists.has(`${date}|${person}`);
  });
}

// Mine filtresi sonrası dedup: tüm kayıtlar aynı kişiye ait.
// Günde en fazla 1 nöbet olduğundan date bazında gruplama yeterli.
// Aynı tarih için birden fazla kaynak (primary/fallback, farklı rol bucket'ları)
// farklı shiftCode/format ile aynı nöbeti döndürebilir — zengin olanı tut.
function normalizeMine(mine) {
  if (!Array.isArray(mine) || mine.length === 0) return mine;
  const byDate = new Map();
  for (const a of mine) {
    const date = String(a.date || a.day || "").slice(0, 10);
    if (!date) continue;
    const prev = byDate.get(date);
    if (!prev || richScore(a) > richScore(prev)) byDate.set(date, a);
  }
  return Array.from(byDate.values());
}

function dayDiff(fromYmd, toYmd) {
  const [fy, fm, fd] = fromYmd.split("-").map(Number);
  const [ty, tm, td] = toYmd.split("-").map(Number);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000
  );
}

function getUpcomingBanner(mine, nextShift) {
  if (!Array.isArray(mine)) return null;
  const todayYmd = new Date().toISOString().slice(0, 10);
  const hasToday = mine.some(
    (a) => String(a.date || a.day || "").slice(0, 10) === todayYmd
  );
  if (hasToday) return { type: "today" };
  if (nextShift?.dateStr) {
    const diff = dayDiff(todayYmd, nextShift.dateStr);
    if (diff >= 1 && diff <= 3)
      return { type: "soon", dateStr: nextShift.dateStr, shiftCode: nextShift.shiftCode || "" };
  }
  return null;
}

function getBusiestDay(mine) {
  const byDay = {};
  for (const a of mine) {
    const d = String(a.date || a.day || "").slice(0, 10);
    if (!d) continue;
    byDay[d] = (byDay[d] || 0) + resolveHours(a);
  }
  let maxH = 0;
  let maxDay = null;
  for (const [d, h] of Object.entries(byDay)) {
    if (h > maxH) { maxH = h; maxDay = d; }
  }
  return maxDay ? { dateStr: maxDay, hours: maxH } : null;
}

function computeStats(mine, holidays) {
  const holidaySet = new Set(
    (holidays || []).map((h) => String(h.date || "").slice(0, 10)).filter(Boolean)
  );
  let totalShifts = 0, nightShifts = 0, totalHours = 0, weekendShifts = 0, holidayShifts = 0;

  for (const a of mine) {
    totalShifts++;
    const code = String(a.shiftCode || "").toUpperCase();
    if (NIGHT_CODES.has(code)) nightShifts++;
    totalHours += resolveHours(a);
    const ymd = String(a.date || a.day || "").slice(0, 10);
    if (isWeekend(ymd)) weekendShifts++;
    if (holidaySet.has(ymd)) holidayShifts++;
  }

  return {
    totalShifts,
    nightShifts,
    totalHours,
    weekendShifts,
    holidayShifts,
    thisWeekHours: getThisWeekHours(mine),
    nextShift: getNextShift(mine),
    busiestDay: getBusiestDay(mine),
  };
}

// ── UI bileşenleri ─────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, colorClass }) {
  return (
    <div className={`rounded-xl p-3 flex flex-col gap-0.5 ${colorClass}`}>
      <div className="text-xs font-medium opacity-70 leading-tight">{label}</div>
      <div className="text-lg font-bold tabular-nums leading-snug">{value}</div>
      {sub && <div className="text-xs opacity-60 leading-tight">{sub}</div>}
    </div>
  );
}

function SkeletonRow({ count, cols }) {
  return (
    <div className={`grid ${cols} gap-3 mb-3`}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-xl bg-slate-100 animate-pulse h-16" />
      ))}
    </div>
  );
}

// ── Ana bileşen ────────────────────────────────────────────────────────────────

export default function PersonalShiftSummary({ me, people = [], year, month }) {
  const activeServiceId = useAppStore((s) => s.activeServiceId);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [gcal, setGcal] = useState({ loading: false, connected: false, lastSyncAt: null });
  const [mineCache, setMineCache] = useState([]);
  const [pdfBusy, setPdfBusy] = useState(false);

  // PDF satır verisi — tekil, sıralı, sıfır-saatli boş kayıtlar temizlendi
  const pdfData = useMemo(() => {
    const seen = new Set();
    return mineCache
      .filter((a) => {
        const h = resolveHours(a);
        const code = String(a.shiftCode || "").trim();
        if (h === 0 && !code) return false;
        const key = `${String(a.date || a.day || "").slice(0, 10)}|${code.toUpperCase()}|${String(a.roleLabel || a.label || "").trim()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => {
        const da = String(a.date || a.day || "");
        const db = String(b.date || b.day || "");
        return da < db ? -1 : da > db ? 1 : 0;
      });
  }, [mineCache]);

  // people listesi her render'da taranmasın
  const resolvedId = useMemo(
    () => resolvePersonFromUser(me, people),
    [me, people]
  );

  const meCanon = useMemo(
    () => canonName(me?.fullName || me?.name || me?.displayName || me?.username || ""),
    [me]
  );

  const load = useCallback(async () => {
    if (!resolvedId) return;
    setLoading(true);
    try {
      const primaryServiceId = String(me?.serviceId || me?.service || activeServiceId || "");
      const fetchOpts = {
        sectionId: "calisma-cizelgesi",
        roles: ["", "Nurse", "Doctor", "Hemşire", "Doktor", "Personel"],
        year,
        month,
        options: { preferScheduleReadModel: true },
      };

      const [primaryTruth, holidays] = await Promise.all([
        fetchMergedScheduleTruth({ ...fetchOpts, serviceId: primaryServiceId }),
        fetchHolidayCalendar({ year, month }).catch(() => []),
      ]);

      // PersonScheduleCalendar gibi serviceId="" de dene — çizelge farklı bucket'ta kayıtlı olabilir
      let fallbackAssignments = [];
      if (primaryServiceId) {
        try {
          const fallbackTruth = await fetchMergedScheduleTruth({ ...fetchOpts, serviceId: "" });
          fallbackAssignments = fallbackTruth?.assignments || [];
        } catch {
          // fallback başarısız olursa primary ile devam et
        }
      }

      const all = normalizeForSummary([...(primaryTruth?.assignments || []), ...fallbackAssignments]);

      // PersonScheduleCalendar ile aynı OR mantığı:
      // ID eşleşmesi VEYA canon isim eşleşmesi — ikisi birbirinden bağımsız
      const mine = all.filter((a) => {
        const aid = String(a.personId || a.pid || a.staffId || "").trim();
        if (aid && aid === resolvedId) return true;
        if (meCanon) {
          const aCanon = canonName(a.personName || a.fullName || a.name || "");
          return !!(aCanon && aCanon === meCanon);
        }
        return false;
      });

      const mineDeduped = normalizeMine(mine);
      setMineCache(mineDeduped);
      setStats(computeStats(mineDeduped, holidays));
    } catch {
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [resolvedId, meCanon, me, year, month, activeServiceId]);

  // Google Calendar durumu — bağımsız, bir kez mount'ta çekilir
  useEffect(() => {
    let active = true;
    setGcal((s) => ({ ...s, loading: true }));
    API.http
      .get("/api/calendar/google/status")
      .then((data) => {
        if (!active) return;
        setGcal({
          loading: false,
          connected: !!data?.connected,
          lastSyncAt: data?.lastSyncAt || null,
        });
      })
      .catch(() => {
        if (!active) return;
        setGcal({ loading: false, connected: false, lastSyncAt: null });
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleExportPdf = useCallback(() => {
    if (!stats || stats.totalShifts === 0) {
      toast.info("Disa aktarilacak nobet verisi yok.");
      return;
    }
    setPdfBusy(true);
    try {
      const personName = forPdf(
        me?.personName || me?.fullName || me?.name || me?.displayName || me?.username || "Personel"
      );
      const monthLabel = forPdf(`${TR_MONTHS[(month - 1)] ?? ""} ${year}`);
      const genDate = new Date().toLocaleDateString("tr-TR");

      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const PW = doc.internal.pageSize.getWidth();
      const PH = doc.internal.pageSize.getHeight();
      const ML = 14;
      const MR = PW - 14;
      const CW = MR - ML;

      // ── HEADER ──────────────────────────────────────────────────────────
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, PW, 38, "F");
      doc.setFillColor(37, 99, 235);
      doc.rect(0, 35, PW, 3, "F");

      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.text("KISISEL NOBET OZETI", ML, 14);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(203, 213, 225);
      doc.text(personName, ML, 22);

      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(monthLabel, ML, 29);

      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text("Hospital Roster System", MR, 13, { align: "right" });
      doc.setFontSize(7);
      doc.text("Kisisel Nobet Raporu", MR, 20, { align: "right" });

      // ── ÖZET KUTULAR ────────────────────────────────────────────────────
      const BOX_Y = 44;
      const BOX_H = 22;
      const summaryItems = [
        { v: String(stats.totalShifts),                        l: "Toplam Nobet", bg: [219,234,254], fg: [30,64,175]   },
        { v: String(stats.nightShifts),                        l: "Gece Nobeti",  bg: [243,232,255], fg: [109,40,217]  },
        { v: `${stats.totalHours}s`,                           l: "Toplam Saat", bg: [220,252,231], fg: [21,128,61]   },
        { v: String(stats.weekendShifts),                      l: "Hafta Sonu",  bg: [255,237,213], fg: [194,65,12]   },
        { v: forPdf(monthIntensityLabel(stats.totalHours)),    l: "Yogunluk",    bg: [254,249,195], fg: [133,77,14]   },
      ];
      const bw = (CW - 2 * (summaryItems.length - 1)) / summaryItems.length;
      summaryItems.forEach((item, i) => {
        const bx = ML + i * (bw + 2);
        doc.setFillColor(...item.bg);
        doc.rect(bx, BOX_Y, bw, BOX_H, "F");
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.2);
        doc.rect(bx, BOX_Y, bw, BOX_H, "S");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.setTextColor(...item.fg);
        doc.text(item.v, bx + bw / 2, BOX_Y + 11, { align: "center" });
        doc.setFont("helvetica", "normal");
        doc.setFontSize(5.5);
        doc.setTextColor(100, 116, 139);
        doc.text(item.l, bx + bw / 2, BOX_Y + 18, { align: "center" });
      });

      // ── BÖLÜM BAŞLIĞI ────────────────────────────────────────────────────
      const SEC_Y = BOX_Y + BOX_H + 7;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(51, 65, 85);
      doc.text("NOBET LISTESI", ML, SEC_Y);
      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.3);
      doc.line(ML, SEC_Y + 1.5, MR, SEC_Y + 1.5);

      // ── NÖBET TABLOSU ────────────────────────────────────────────────────
      const tableBody = pdfData.length > 0
        ? pdfData.map((a) => {
            const ymd = String(a.date || a.day || "").slice(0, 10);
            const h   = resolveHours(a);
            const code = String(a.shiftCode || "").trim();
            return [
              ymd,
              forPdf(dayName(ymd)),
              forPdf(code) || "-",
              h > 0 ? `${h}s` : "-",
              forPdf(String(a.roleLabel || a.label || "").trim()) || "-",
              NIGHT_CODES.has(code.toUpperCase()) ? "E" : "-",
              isWeekend(ymd) ? "E" : "-",
            ];
          })
        : [["Kayit yok", "-", "-", "-", "-", "-", "-"]];

      autoTable(doc, {
        startY: SEC_Y + 5,
        head: [["Tarih", "Gun", "Vardiya", "Saat", "Gorev", "Gece", "H.Sonu"]],
        body: tableBody,
        theme: "striped",
        styles: {
          fontSize: 8,
          font: "helvetica",
          textColor: [30, 41, 59],
          cellPadding: { top: 2.5, right: 3, bottom: 2.5, left: 3 },
          lineColor: [226, 232, 240],
          lineWidth: 0.15,
        },
        headStyles: {
          fillColor: [30, 64, 175],
          textColor: [255, 255, 255],
          fontStyle: "bold",
          fontSize: 7.5,
          halign: "center",
          cellPadding: { top: 3, right: 3, bottom: 3, left: 3 },
        },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
          0: { cellWidth: 25, fontStyle: "bold" },
          1: { cellWidth: 13, halign: "center" },
          2: { cellWidth: 20, halign: "center", fontStyle: "bold" },
          3: { cellWidth: 14, halign: "center" },
          4: { cellWidth: "auto" },
          5: { cellWidth: 13, halign: "center" },
          6: { cellWidth: 16, halign: "center" },
        },
        margin: { left: ML, right: 14, bottom: 18 },
      });

      // ── FOOTER — tüm sayfalar ─────────────────────────────────────────────
      const totalPages = doc.getNumberOfPages();
      for (let pg = 1; pg <= totalPages; pg++) {
        doc.setPage(pg);
        doc.setFillColor(248, 250, 252);
        doc.rect(0, PH - 13, PW, 13, "F");
        doc.setDrawColor(203, 213, 225);
        doc.setLineWidth(0.2);
        doc.line(ML, PH - 13, MR, PH - 13);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(100, 116, 139);
        doc.text(`Olusturuldu: ${genDate}`, ML, PH - 6);
        doc.text("Hospital Roster System", PW / 2, PH - 6, { align: "center" });
        doc.text(`Sayfa ${pg} / ${totalPages}  -  Kullaniciya ozel`, MR, PH - 6, { align: "right" });
      }

      doc.save(`Nobet_Ozeti_${personName}_${year}_${String(month).padStart(2, "0")}.pdf`);
    } catch (err) {
      toast.error("PDF olusturulamadi.");
      console.error("[PersonalShiftSummary] PDF hatasi:", err);
    } finally {
      setPdfBusy(false);
    }
  }, [stats, pdfData, me, year, month]);

  // Kişi çözümlenemiyorsa hiçbir şey gösterme
  if (!resolvedId) return null;

  if (loading) {
    return (
      <>
        <SkeletonRow count={4} cols="grid-cols-2 sm:grid-cols-4" />
        <SkeletonRow count={6} cols="grid-cols-2 sm:grid-cols-3" />
      </>
    );
  }

  if (!stats || stats.totalShifts === 0) {
    return (
      <div className="mb-4 text-sm text-slate-500 text-center py-3 bg-slate-50 rounded-xl border border-slate-200">
        Bu ay nöbet kaydı yok
      </div>
    );
  }

  const {
    totalShifts, nightShifts, totalHours, weekendShifts, holidayShifts,
    thisWeekHours, nextShift, busiestDay,
  } = stats;

  const banner = getUpcomingBanner(mineCache, nextShift);

  const gcalValue = gcal.loading ? "…" : gcal.connected ? "Bağlı" : "Bağlı Değil";
  const gcalSub = gcal.connected && gcal.lastSyncAt
    ? `Son: ${new Date(gcal.lastSyncAt).toLocaleDateString("tr-TR")}`
    : gcal.connected ? "Senkronize edilmedi" : "Google Takvim";

  return (
    <>
      {banner && (
        <div
          className={`mb-3 rounded-xl border px-4 py-3 flex items-center gap-3 text-sm font-medium ${
            banner.type === "today"
              ? "bg-amber-50 border-amber-300 text-amber-900"
              : "bg-sky-50 border-sky-200 text-sky-800"
          }`}
        >
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
              banner.type === "today"
                ? "bg-amber-400 text-white"
                : "bg-sky-200 text-sky-700"
            }`}
          >
            {banner.type === "today" ? "!" : "↑"}
          </span>
          <span>
            {banner.type === "today"
              ? "Bugün nöbetiniz var"
              : `Yaklaşan nöbetiniz var: ${fmtTurkishDate(banner.dateStr)}${banner.shiftCode ? ` • ${banner.shiftCode}` : ""}`}
          </span>
        </div>
      )}

      <div className="flex justify-end mb-2">
        <button
          onClick={handleExportPdf}
          disabled={pdfBusy}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
        >
          {pdfBusy ? "Hazırlanıyor…" : "PDF İndir"}
        </button>
      </div>

      {/* Mevcut 4 kart — birebir korunur */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <StatCard
          label="Toplam Nöbet"
          value={totalShifts}
          colorClass="bg-blue-50 text-blue-700"
        />
        <StatCard
          label="Gece Nöbeti"
          value={nightShifts}
          colorClass="bg-purple-50 text-purple-700"
        />
        <StatCard
          label="Toplam Saat"
          value={`${totalHours}s`}
          colorClass="bg-green-50 text-green-700"
        />
        <StatCard
          label="Hafta Sonu"
          value={weekendShifts}
          colorClass="bg-orange-50 text-orange-700"
        />
      </div>

      {/* Faz-2: 6 yeni kart */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <StatCard
          label="Sonraki Nöbet"
          value={nextShift ? fmtTurkishDate(nextShift.dateStr) : "—"}
          sub={nextShift?.shiftCode || undefined}
          colorClass="bg-sky-50 text-sky-700"
        />
        <StatCard
          label="Bu Hafta"
          value={`${thisWeekHours}s`}
          sub={weekIntensityLabel(thisWeekHours)}
          colorClass="bg-teal-50 text-teal-700"
        />
        <StatCard
          label="Resmi Tatil"
          value={holidayShifts}
          sub={holidayShifts > 0 ? "nöbet" : "nöbet yok"}
          colorClass="bg-red-50 text-red-700"
        />
        <StatCard
          label="Aylık Yoğunluk"
          value={monthIntensityLabel(totalHours)}
          sub={`${totalHours}s toplam`}
          colorClass="bg-amber-50 text-amber-700"
        />
        <StatCard
          label="En Yoğun Gün"
          value={busiestDay ? fmtTurkishDate(busiestDay.dateStr) : "—"}
          sub={busiestDay ? `${busiestDay.hours}s` : undefined}
          colorClass="bg-rose-50 text-rose-700"
        />
        <StatCard
          label="Google Takvim"
          value={gcalValue}
          sub={gcalSub}
          colorClass={gcal.connected ? "bg-emerald-50 text-emerald-700" : "bg-slate-50 text-slate-500"}
        />
      </div>
    </>
  );
}
