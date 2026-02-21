// src/hooks/useYearMonth.js
import { useCallback, useMemo, useState } from "react";
import { readActiveYM, writeActiveYM } from "../utils/storage.js";

function normalizeYM(year, month) {
  const y = Number(year) || new Date().getFullYear();
  const rawM = Number(month) || new Date().getMonth() + 1; // 1..12
  const m = Math.min(12, Math.max(1, rawM));
  return { year: y, month: m };
}

export default function useYearMonth(initial) {
  // LS’ten oku, yoksa initial, o da yoksa bugünkü ay
  const fromLs = readActiveYM();
  const base =
    fromLs ?? initial ?? { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
  const norm = normalizeYM(base.year, base.month);

  const [year, setYear] = useState(norm.year);
  const [month, setMonth] = useState(norm.month);

  const setYM = useCallback((y, m) => {
    const n = normalizeYM(y, m);
    setYear(n.year);
    setMonth(n.month);
    writeActiveYM(n.year, n.month);
  }, []);

  return useMemo(() => ({ year, month, setYM }), [year, month, setYM]);
}
