export const cn = (...c) => c.filter(Boolean).join(" ");

export const bg600 = (c) => ({
  red:"bg-red-600", emerald:"bg-emerald-600", rose:"bg-rose-600",
  amber:"bg-amber-600", violet:"bg-violet-600", indigo:"bg-indigo-600", slate:"bg-slate-600"
}[c] || "bg-slate-600");

export const text700 = (c) => ({
  red:"text-red-700", emerald:"text-emerald-700", rose:"text-rose-700",
  amber:"text-amber-700", violet:"text-violet-700", indigo:"text-indigo-700", slate:"text-slate-700"
}[c] || "text-slate-700");
