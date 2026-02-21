// src/tabs/HolidayCalendarTab.jsx
import React, { useEffect, useMemo, useState } from "react";
import { http } from "../lib/api.js";
const norm = (s) => (s ?? "").toString().trim();
const isValidDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

const sortByDate = (arr) =>
  [...(arr || [])].sort((a, b) => (a.date || "").localeCompare(b.date || ""));

const pad2 = (n) => String(n).padStart(2, "0");

function buildFixedHolidays(year) {
  const y = Number(year);
  if (!Number.isFinite(y)) return [];
  const fixed = [
    { m: 1,  d: 1,  name: "Yılbaşı" },
    { m: 4,  d: 23, name: "Ulusal Egemenlik ve Çocuk Bayramı" },
    { m: 5,  d: 1,  name: "Emek ve Dayanışma Günü" },
    { m: 5,  d: 19, name: "Atatürk'ü Anma, Gençlik ve Spor Bayramı" },
    { m: 7,  d: 15, name: "Demokrasi ve Millî Birlik Günü" },
    { m: 8,  d: 30, name: "Zafer Bayramı" },
    { m: 10, d: 28, name: "Cumhuriyet Bayramı Arifesi (Öğleden sonra)", kind: "half" },
    { m: 10, d: 29, name: "Cumhuriyet Bayramı" },
  ];
  return fixed.map((f) => ({
    date: `${y}-${pad2(f.m)}-${pad2(f.d)}`,
    kind: f.kind || "full",
    name: f.name,
  }));
}

export default function HolidayCalendarTab() {
  const [list, setList] = useState([]);
  const [form, setForm] = useState({ date: "", kind: "full", name: "" });
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [loading, setLoading] = useState(false);

  const loadYear = async (y) => {
    const data = await http.get(`/api/holidays?y=${y}`);
    const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
    setList(sortByDate(items));
    try { window.dispatchEvent(new Event("holidays:changed")); } catch {}
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loadYear(year).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [year]);

  const upsert = async (e) => {
    e?.preventDefault?.();
    const date = norm(form.date);
    if (!isValidDate(date)) return alert("Tarih formatı YYYY-MM-DD olmalı.");
    const kind =
      form.kind === "arife" ? "arife" :
      form.kind === "half" ? "half" :
      "full";
    const name = norm(form.name);
    await http.post(`/api/holidays`, { date, kind, name });
    await loadYear(year);
    setForm({ date: "", kind: "full", name: "" });
  };

  const del = async (date) => {
    await http.req(`/api/holidays/${date}`, { method: "DELETE" });
    await loadYear(year);
  };

  const clearAll = async () => {
    if (!window.confirm("Tüm tatil/arife kayıtları silinsin mi?")) return;
    setLoading(true);
    try {
      for (const t of list || []) {
        await http.req(`/api/holidays/${t.date}`, { method: "DELETE" });
      }
      await loadYear(year);
    } finally {
      setLoading(false);
    }
  };

  const addFixedTemplate = async () => {
    const y = Number(year);
    if (!Number.isFinite(y) || y < 2000 || y > 2100) {
      return alert("Yıl geçerli değil (örn: 2026).");
    }
    const template = buildFixedHolidays(y);
    for (const t of template) {
      await http.post(`/api/holidays`, { date: t.date, kind: t.kind, name: t.name });
    }
    await loadYear(year);
  };

  const generateYear = async () => {
    const y = Number(year);
    if (!Number.isFinite(y) || y < 2000 || y > 2100) {
      return alert("Yıl geçerli değil (örn: 2026).");
    }
    setLoading(true);
    try {
      await http.get(`/api/holidays/generate/${y}`);
      await loadYear(y);
    } finally {
      setLoading(false);
    }
  };

  const summary = useMemo(() => {
    const full = (list || []).filter((x) => x.kind === "full").length;
    const arife = (list || []).filter((x) => x.kind === "arife").length;
    const half = (list || []).filter((x) => x.kind === "half").length;
    return { full, arife, half };
  }, [list]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <input
          type="number"
          min="2000"
          max="2100"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="w-24 border rounded px-2 py-1 text-sm text-center"
        />
        <button type="button" onClick={addFixedTemplate} className="px-3 py-2 text-sm border rounded">
          Sabit Tatilleri Ekle
        </button>
        <button type="button" onClick={generateYear} className="px-3 py-2 text-sm border rounded">
          Yıla Göre Tatilleri Çek
        </button>
        <button type="button" onClick={clearAll} className="px-3 py-2 text-sm border rounded text-red-600">
          Tatilleri Sıfırla
        </button>
      </div>

      <h3 className="font-medium">Tatil Takvimi</h3>

      <form onSubmit={upsert} className="bg-white rounded-2xl shadow-sm p-4 grid md:grid-cols-5 gap-3 items-end">
        <input
          type="date"
          value={form.date}
          onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
          className="w-full border rounded p-2"
        />
        <select
          value={form.kind}
          onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}
          className="w-full border rounded p-2"
        >
          <option value="full">Resmî Tatil (0 saat)</option>
          <option value="arife">Arife (4 saat)</option>
          <option value="half">Yarım Gün (4 saat)</option>
        </select>
        <input
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className="md:col-span-2 w-full border rounded p-2"
          placeholder="Açıklama (örn: Ramazan Bayramı 1. Gün)"
        />
        <button type="submit" className="px-3 py-2 text-sm border rounded bg-emerald-600 text-white">
          Ekle / Güncelle
        </button>
      </form>

      <div className="bg-white rounded-2xl shadow-sm p-4 overflow-x-auto">
        <div className="text-xs text-slate-500 mb-2">
          Toplam: {summary.full} tatil, {summary.arife} arife, {summary.half} yarım gün
        </div>
        <table className="w-full text-sm">
          <thead className="text-slate-500">
            <tr className="border-b">
              <th className="py-2 pr-2 text-left">Tarih</th>
              <th className="py-2 pr-2 text-left">Tür</th>
              <th className="py-2 pr-2 text-left">Açıklama</th>
              <th className="py-2 pr-2 text-right">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-slate-400">Yükleniyor…</td>
              </tr>
            )}
            {(!loading && (!list || list.length === 0)) && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-slate-400">Henüz kayıt yok.</td>
              </tr>
            )}
            {(!loading ? (list || []) : []).map((t) => (
              <tr key={t.date} className="border-t">
                <td className="py-2 pr-2 font-mono">{t.date}</td>
                <td className="py-2 pr-2">
                  {t.kind === "arife"
                    ? "Arife (4s)"
                    : t.kind === "half"
                    ? "Yarım Gün (4s)"
                    : "Resmî Tatil (0s)"}
                </td>
                <td className="py-2 pr-2">{t.name || ""}</td>
                <td className="py-2 pr-2 text-right">
                  <button onClick={() => del(t.date)} className="text-xs px-2 py-1 border rounded bg-slate-100">Sil</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-slate-500">
        Not: Bu kayıtlar tüm hesaplarda (Fazla Mesai, Aylık Mesai, raporlar) ortak kullanılır.
        Dini bayramlar ve arifeler online kaynaktan otomatik çekilir; internet yoksa buradan manuel ekleyebilirsin.
      </div>
    </div>
  );
}
