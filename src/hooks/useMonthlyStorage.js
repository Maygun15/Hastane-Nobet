// src/hooks/useMonthlyStorage.js
import { useEffect, useMemo, useState } from "react";
import { ymKey } from "../lib/monthUtils";
import { LS } from "../utils/storage";

/**
 * Aylık anahtar ile localStorage okuma/yazma basitleştirici.
 * baseKey: "monthlyHoursSheet" gibi
 * ym: { year, month }  // month: 1..12
 */
export default function useMonthlyStorage(baseKey, ym, defaultValue) {
  const key = useMemo(() => `${baseKey}/${ymKey(ym.year, ym.month)}`, [baseKey, ym.year, ym.month]);
  const [value, setValue] = useState(() => LS.get(key, defaultValue));

  useEffect(() => {
    setValue(LS.get(key, defaultValue));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (value !== undefined) LS.set(key, value);
  }, [key, value]);

  return [value, setValue, key];
}
