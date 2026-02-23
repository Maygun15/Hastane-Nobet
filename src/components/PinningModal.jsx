import React, { useState, useMemo } from "react";
import { X, Plus, Trash2, Pin, Search } from "lucide-react";

export default function PinningModal({
  open,
  onClose,
  pins = [],
  onAdd,
  onRemove,
  people = [],
  rows = [],
  daysInMonth,
}) {
  const [form, setForm] = useState({ personId: "", day: "", rowId: "" });
  const [search, setSearch] = useState("");

  if (!open) return null;

  const filteredPeople = useMemo(() => {
    if (!search) return people;
    const q = search.toLocaleLowerCase("tr-TR");
    return people.filter((p) => (p.name || "").toLocaleLowerCase("tr-TR").includes(q));
  }, [people, search]);

  const handleAdd = () => {
    if (!form.personId || !form.day || !form.rowId) return;
    onAdd({
      id: Date.now() + Math.random(),
      personId: form.personId,
      day: Number(form.day),
      rowId: form.rowId, // ID string/number olabilir, olduğu gibi sakla
    });
    setForm({ ...form, day: "" }); // Kişi ve görev kalsın, günü temizle
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in duration-200">
        <div className="flex items-center justify-between p-4 border-b bg-slate-50">
          <div className="flex items-center gap-2">
            <Pin className="text-sky-600" size={20} />
            <div>
              <h3 className="font-semibold text-slate-800">Sabitlenen Nöbetler</h3>
              <p className="text-xs text-slate-500">Otomatik planlama bu atamaları değiştiremez.</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 border-b bg-slate-50/50 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <div className="flex flex-col gap-1">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 w-3 h-3" />
                <input
                  className="w-full h-7 rounded border pl-7 pr-2 text-xs focus:outline-none focus:border-sky-500"
                  placeholder="Personel ara..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <select
                className="h-9 rounded border px-2 text-sm w-full"
                value={form.personId}
                onChange={(e) => setForm({ ...form, personId: e.target.value })}
              >
                <option value="">Personel Seç...</option>
                {filteredPeople.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <select
              className="h-9 rounded border px-2 text-sm"
              value={form.rowId}
              onChange={(e) => setForm({ ...form, rowId: e.target.value })}
            >
              <option value="">Görev / Vardiya Seç...</option>
              {rows.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label} ({r.shiftCode})
                </option>
              ))}
            </select>

            <select
              className="h-9 rounded border px-2 text-sm"
              value={form.day}
              onChange={(e) => setForm({ ...form, day: e.target.value })}
            >
              <option value="">Gün Seç...</option>
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}. Gün
                </option>
              ))}
            </select>

            <button
              onClick={handleAdd}
              disabled={!form.personId || !form.day || !form.rowId}
              className="h-9 rounded bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Plus size={16} /> Ekle
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {pins.length === 0 ? (
            <div className="text-center text-slate-400 py-8 text-sm">
              Henüz sabitlenmiş bir nöbet yok.
            </div>
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-500 bg-slate-50 uppercase">
                <tr>
                  <th className="p-2">Gün</th>
                  <th className="p-2">Personel</th>
                  <th className="p-2">Görev</th>
                  <th className="p-2 text-right">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {pins.sort((a, b) => a.day - b.day).map((pin) => {
                  const p = people.find((x) => String(x.id) === String(pin.personId));
                  const r = rows.find((x) => String(x.id) === String(pin.rowId));
                  return (
                    <tr key={pin.id} className="hover:bg-slate-50">
                      <td className="p-2 font-medium">{pin.day}</td>
                      <td className="p-2">{p?.name || pin.personId}</td>
                      <td className="p-2">
                        {r ? (
                          <>
                            {r.label} <span className="text-xs text-slate-400">({r.shiftCode})</span>
                          </>
                        ) : (
                          pin.rowId
                        )}
                      </td>
                      <td className="p-2 text-right">
                        <button
                          onClick={() => onRemove(pin.id)}
                          className="text-rose-500 hover:bg-rose-50 p-1 rounded"
                          title="Kaldır"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="p-4 border-t bg-slate-50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium hover:bg-slate-50"
          >
            Tamam
          </button>
        </div>
      </div>
    </div>
  );
}