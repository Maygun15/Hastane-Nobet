import React, { useMemo } from "react";
import { ROLE, services } from "../constants/enums.js";
import ServiceCard from "./ServiceCard.jsx";

export default function ServiceGrid({ onSelect, peopleAll = [] }) {
  const counts = useMemo(() => {
    const m = {};
    services.forEach((s) => (m[s.id] = { doctors: 0, nurses: 0 }));
    (peopleAll || []).forEach((p) => {
      if (!m[p.service]) return;
      if (p.role === ROLE.Doctor) m[p.service].doctors++;
      else m[p.service].nurses++;
    });
    return m;
  }, [peopleAll]);

  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
      {services.map((s) => (
        <ServiceCard key={s.id} def={s} counts={counts[s.id]} onOpen={() => onSelect(s.id)} />
      ))}
    </div>
  );
}
