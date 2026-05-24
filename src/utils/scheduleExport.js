// src/utils/scheduleExport.js — iCal / Excel indirme yardımcıları
import { getToken } from '../lib/api.js';

function buildUrl(path, params) {
  const base = (import.meta?.env?.VITE_API_BASE || '').replace(/\/$/, '');
  const qs = new URLSearchParams(params).toString();
  return `${base}${path}${qs ? '?' + qs : ''}`;
}

async function downloadFile(url, filename) {
  const token = getToken();
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`İndirme hatası: ${res.status}`);
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

export async function downloadIcal({ year, month, personId, serviceId } = {}) {
  const params = { year, month };
  if (personId)  params.personId = personId;
  if (serviceId) params.serviceId = serviceId;
  await downloadFile(
    buildUrl('/api/schedules/export/ical', params),
    `nobetler-${year}-${String(month).padStart(2,'0')}.ics`
  );
}

export async function downloadExcel({ year, month, serviceId } = {}) {
  const params = { year, month };
  if (serviceId) params.serviceId = serviceId;
  await downloadFile(
    buildUrl('/api/schedules/export/excel', params),
    `nobetler-${year}-${String(month).padStart(2,'0')}.xlsx`
  );
}

export async function downloadIKExcel({ year, month } = {}) {
  const pad2 = (n) => String(n).padStart(2, '0');
  await downloadFile(
    buildUrl('/api/schedules/export/excel-ik', { year, month }),
    `ik-rapor-${year}-${pad2(month)}.xlsx`
  );
}
