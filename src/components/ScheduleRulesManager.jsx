// src/components/ScheduleRulesManager.jsx
import React, { useEffect, useState } from 'react';
import { API } from '../lib/api.js';

export default function ScheduleRulesManager({ sectionId = 'calisma-cizelgesi' }) {
  const [rules, setRules] = useState({
    enabled: false,
    maxShiftsPerPerson: 5,
    minRestDaysBetween: 1,
    maxConsecutiveShifts: 3,
    restrictedDays: [],
  });

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [role, setRole] = useState('');

  useEffect(() => {
    loadRules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionId]);

  const loadRules = async () => {
    try {
      setLoading(true);
      setError('');
      const qs = new URLSearchParams({ sectionId });
      if (serviceId) qs.append('serviceId', serviceId);
      if (role) qs.append('role', role);
      const res = await API.http.get(`/api/schedules/rules?${qs.toString()}`);
      if (res?.rules) setRules(res.rules);
    } catch (err) {
      setError(err?.message || 'Kurallar yüklenemedi');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setLoading(true);
      setError('');
      setSuccess('');

      const payload = {
        sectionId,
        serviceId: serviceId || '',
        role: role || '',
        enabled: !!rules.enabled,
        maxShiftsPerPerson: rules.maxShiftsPerPerson || null,
        minRestDaysBetween: rules.minRestDaysBetween || 0,
        maxConsecutiveShifts: rules.maxConsecutiveShifts || null,
        restrictedDays: rules.restrictedDays || [],
      };

      const res = await API.http.req(`/api/schedules/rules`, {
        method: 'PUT',
        body: payload,
      });

      if (res?.rules) setRules(res.rules);
      setSuccess('✓ Kurallar kaydedildi!');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err?.message || 'Kaydetme başarısız');
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async () => {
    try {
      setLoading(true);
      setError('');
      setSuccess('');
      const res = await API.http.req(`/api/schedules/rules/toggle`, {
        method: 'PATCH',
        body: {
          sectionId,
          serviceId: serviceId || '',
          role: role || '',
          enabled: !rules.enabled,
        },
      });
      if (res?.rules) setRules(res.rules);
      if (res?.message) setSuccess(res.message);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err?.message || 'İşlem başarısız');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field, value) => {
    setRules((prev) => ({
      ...prev,
      [field]: value === '' ? null : value,
    }));
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6 space-y-6 max-w-3xl">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">📋 Nöbet Yazma Kuralları</h2>
        <p className="text-sm text-slate-500 mt-1">
          Sistem otomatik olarak bu kuralları kontrol edecektir.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          ❌ {error}
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-green-700 text-sm">
          ✓ {success}
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Bölüm ID</label>
          <input
            type="text"
            value={sectionId}
            disabled
            className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-100 text-slate-600 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Servis ID (Opsiyonel)</label>
          <input
            type="text"
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            placeholder="Tümü için boş bırak"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Rol (Opsiyonel)</label>
          <input
            type="text"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="Tümü için boş bırak"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={!!rules.enabled}
            onChange={handleToggle}
            disabled={loading}
            className="w-5 h-5 accent-blue-600 cursor-pointer"
          />
          <div>
            <div className="font-semibold text-blue-900">Nöbet yazma kurallarını aktifleştir</div>
            <div className="text-xs text-blue-700">
              {rules.enabled ? '✓ Kurallar etkin - Sistem kontrol ediyor' : '✗ Kurallar pasif - Sınırsız atama'}
            </div>
          </div>
        </label>
      </div>

      {rules.enabled && (
        <div className="space-y-4">
          <div className="border-t-2 border-slate-100 pt-4">
            <h3 className="font-semibold text-slate-800 mb-4">Kural Parametreleri</h3>

            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-2">📅 Ayda Maksimum Nöbet Sayısı</label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={rules.maxShiftsPerPerson === null ? '' : rules.maxShiftsPerPerson}
                  onChange={(e) =>
                    handleInputChange('maxShiftsPerPerson', e.target.value ? parseInt(e.target.value, 10) : '')
                  }
                  placeholder="Örn: 5"
                  className="w-24 px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
                <span className="text-xs text-slate-500">(Boş = sınırsız)</span>
              </div>
              <p className="text-xs text-slate-500 mt-1">Bir kişi bu ayda kaç nöbet alabilir?</p>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-2">😴 Nöbetler Arası Minimum Gün</label>
              <input
                type="number"
                min="0"
                max="10"
                value={rules.minRestDaysBetween || 0}
                onChange={(e) => handleInputChange('minRestDaysBetween', parseInt(e.target.value, 10) || 0)}
                placeholder="0"
                className="w-24 px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
              <p className="text-xs text-slate-500 mt-1">
                Bir nöbetten sonra en az kaç gün ara olmalı?
                <br />
                <em>(1 = ardışık nöbet yok, 2 = en az 2 gün ara)</em>
              </p>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-2">🔗 Ardışık Maksimum Nöbet Sayısı</label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={rules.maxConsecutiveShifts === null ? '' : rules.maxConsecutiveShifts}
                  onChange={(e) =>
                    handleInputChange('maxConsecutiveShifts', e.target.value ? parseInt(e.target.value, 10) : '')
                  }
                  placeholder="Örn: 3"
                  className="w-24 px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
                <span className="text-xs text-slate-500">(Boş = sınırsız)</span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Bir kişi art arda kaç nöbet alabilir?
                <br />
                <em>(3 = 3 gün nöbet, sonra ara)</em>
              </p>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-2">🚫 Yasaklı Günler</label>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={rules.restrictedDays?.includes('weekend') || false}
                    onChange={(e) => {
                      const days = rules.restrictedDays ? [...rules.restrictedDays] : [];
                      if (e.target.checked) {
                        if (!days.includes('weekend')) days.push('weekend');
                      } else {
                        const idx = days.indexOf('weekend');
                        if (idx > -1) days.splice(idx, 1);
                      }
                      handleInputChange('restrictedDays', days);
                    }}
                    className="accent-red-600"
                  />
                  <span>Hafta sonları nöbet yasak</span>
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-3 justify-end border-t pt-4">
        <button
          onClick={loadRules}
          disabled={loading}
          className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 text-sm hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? '⏳' : '↻'} Yenile
        </button>
        <button
          onClick={handleSave}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 font-medium"
        >
          {loading ? '💾...' : '💾 Kaydet'}
        </button>
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs text-slate-600 space-y-2">
        <p><strong>💡 İpucu:</strong> Kurallar etkinken, sistem nöbet atarken otomatik olarak kontrol eder.</p>
        <p><strong>⚠️ Uyarı:</strong> Kuralları değiştirdikten sonra önceki atamalar kontrol edilmez.</p>
        <p>
          <strong>🔧 Tekil Ayarlar:</strong> Farklı servislere veya rollere farklı kurallar uygulamak için
          "Servis ID" veya "Rol" alanlarını doldurun.
        </p>
      </div>
    </div>
  );
}
