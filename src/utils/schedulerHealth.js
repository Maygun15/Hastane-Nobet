export const STATUS_STYLES = {
  GREEN: "border-emerald-200 bg-emerald-50 text-emerald-800",
  YELLOW: "border-amber-200 bg-amber-50 text-amber-900",
  RED: "border-rose-200 bg-rose-50 text-rose-800",
};

export function statusLabel(status) {
  if (status === "GREEN") return "Green";
  if (status === "YELLOW") return "Yellow";
  if (status === "RED") return "Red";
  return "Not observed";
}

export function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("tr-TR").format(n);
}

export function formatDateTime(value) {
  if (!value) return "Not observed";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not observed";
  return date.toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" });
}
