// Tercih talebi türleri — backend: services/preferenceRequestService.js
export const PREFERENCE_KIND_OPTIONS = [
  { value: "off", label: "Bu gün(ler) çalışmak istemiyorum" },
  { value: "noNight", label: "Bu gün(ler) gece nöbeti istemiyorum" },
  { value: "want", label: "Bu gün(ler) çalışmak istiyorum" },
];

export const PREFERENCE_KIND_SHORT = {
  off: "Çalışmak istemiyor",
  noNight: "Gece istemiyor",
  want: "Çalışmak istiyor",
};

export function formatPreferenceDates(r = {}) {
  const start = String(r.targetDate || "").slice(0, 10);
  const end = String(r.targetDateEnd || "").slice(0, 10);
  if (!start) return "";
  return end && end !== start ? `${start} – ${end}` : start;
}
