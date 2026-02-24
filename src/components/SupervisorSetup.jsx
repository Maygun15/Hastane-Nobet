import React, { useState, useEffect } from "react";
import { X, Save, RotateCcw, Info, ShieldAlert, Clock } from "lucide-react";

const DEFAULT_RULES = {
  maxPerDayPerPerson: 1,
  maxConsecutiveNights: 1,
  targetMonthlyHours: 168,
  weeklyHourLimit: 80,
  restAfterNight24h: true,
  distinctTasksSameHour: true,
};

export default function SupervisorSetup({ open, onClose, role, currentRules = [], onSave }) {
  const [localRules, setLocalRules] = useState(DEFAULT_RULES);

  useEffect(() => {
    if (open) {
      const storedMap = {};
      (currentRules || []).forEach((r) => {
        if (r.active) storedMap[r.id] = r.value;
      });
      
      setLocalRules((prev) => ({
        ...prev,
        ...storedMap,
      }));
    }
  }, [open, currentRules]);

  const handleChange = (key, val) => {
    setLocalRules((prev) => ({ ...prev, [key]: val }));
  };

  const handleSave = () => {
    const newArr = [...(currentRules || [])];

    Object.entries(localRules).forEach(([key, val]) => {
      const idx = newArr.findIndex((r) => r.id === key);
      if (idx >= 0) {
        newArr[idx] = { ...newArr[idx], value: val, active: true };
      } else {
        newArr.push({ id: key, value: val, active: true, name: key });
      }
    });

    onSave(newArr);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-4 border-b bg-slate-50">
          <div>
            <h3 className="font-semibold text-slate-800">Sorumlu Ayarları</h3>
            <p className="text-xs text-slate-500">{role === "Doctor" ? "Doktor" : "Hemşire"} grubu için genel kısıtlamalar</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto">
          {/* Sayısal Ayarlar */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-900 border-b pb-2">
              <Clock size={16} className="text-violet-600" />
              Limitler ve Hedefler
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Günlük Max Nöbet</label>
                <input
                  type="number"
                  min="1"
                  className="w-full rounded-lg border-slate-200 text-sm focus:ring-violet-500 focus:border-violet-500"
                  value={localRules.maxPerDayPerPerson}
                  onChange={(e) => handleChange("maxPerDayPerPerson", Number(e.target.value))}
                />
                <p className="text-[10px] text-slate-400 mt-1">Aynı gün max görev sayısı.</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Ardışık Gece Sınırı</label>
                <input
                  type="number"
                  min="0"
                  className="w-full rounded-lg border-slate-200 text-sm focus:ring-violet-500 focus:border-violet-500"
                  value={localRules.maxConsecutiveNights}
                  onChange={(e) => handleChange("maxConsecutiveNights", Number(e.target.value))}
                />
                <p className="text-[10px] text-slate-400 mt-1">Peş peşe gece nöbeti limiti.</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Aylık Hedef Saat</label>
                <input
                  type="number"
                  min="0"
                  className="w-full rounded-lg border-slate-200 text-sm focus:ring-violet-500 focus:border-violet-500"
                  value={localRules.targetMonthlyHours}
                  onChange={(e) => handleChange("targetMonthlyHours", Number(e.target.value))}
                />
                <p className="text-[10px] text-slate-400 mt-1">Dengeleme hedefi (örn: 168).</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Haftalık Saat Limiti</label>
                <input
                  type="number"
                  min="0"
                  className="w-full rounded-lg border-slate-200 text-sm focus:ring-violet-500 focus:border-violet-500"
                  value={localRules.weeklyHourLimit}
                  onChange={(e) => handleChange("weeklyHourLimit", Number(e.target.value))}
                />
                <p className="text-[10px] text-slate-400 mt-1">Haftalık max çalışma saati.</p>
              </div>
            </div>
          </div>

          {/* Mantıksal Ayarlar */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-900 border-b pb-2">
              <ShieldAlert size={16} className="text-violet-600" />
              Kurallar ve Kısıtlamalar
            </div>

            <div className="flex items-start gap-3 p-3 rounded-lg border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-colors">
              <input
                type="checkbox"
                id="restAfterNight"
                className="mt-1 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                checked={localRules.restAfterNight24h}
                onChange={(e) => handleChange("restAfterNight24h", e.target.checked)}
              />
              <div>
                <label htmlFor="restAfterNight" className="block text-sm font-medium text-slate-700 cursor-pointer">Gece Sonrası 24 Saat Dinlenme</label>
                <p className="text-xs text-slate-500 mt-0.5">Gece veya uzun (16s+) vardiya tutan personel ertesi gün görev alamaz.</p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 rounded-lg border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-colors">
              <input
                type="checkbox"
                id="distinctTasks"
                className="mt-1 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                checked={localRules.distinctTasksSameHour}
                onChange={(e) => handleChange("distinctTasksSameHour", e.target.checked)}
              />
              <div>
                <label htmlFor="distinctTasks" className="block text-sm font-medium text-slate-700 cursor-pointer">Saat Çakışması Kontrolü</label>
                <p className="text-xs text-slate-500 mt-0.5">Aynı saat aralığına denk gelen iki farklı görev atanmasını engeller.</p>
              </div>
            </div>
          </div>
          
          <div className="flex items-start gap-2 text-xs text-amber-600 bg-amber-50 p-3 rounded-lg border border-amber-100">
            <Info size={16} className="shrink-0 mt-0.5" />
            <p>Bu ayarlar "Liste Oluştur" butonuna bastığınızda otomatik planlayıcı (solver) tarafından kullanılır. Manuel düzenlemelerde bu kurallar esnetilebilir.</p>
          </div>
        </div>

        <div className="p-4 border-t bg-slate-50 flex justify-end gap-3">
          <button 
            onClick={() => setLocalRules(DEFAULT_RULES)} 
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 rounded-lg flex items-center gap-2 transition-colors"
          >
            <RotateCcw size={16}/> 
            Varsayılan
          </button>
          <button 
            onClick={handleSave} 
            className="px-4 py-2 text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 rounded-lg flex items-center gap-2 shadow-sm transition-colors"
          >
            <Save size={16}/> 
            Kaydet ve Kapat
          </button>
        </div>
      </div>
    </div>
  );
}