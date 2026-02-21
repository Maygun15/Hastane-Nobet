import React from "react";
import { cn } from "../utils/classnames.js";

export default function PeopleFiveColumnList({
  title = "Kişiler",
  people = [],
  onPick,
  selectedId,
  leavesCountFor,
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm p-3">
      <div className="text-sm font-medium mb-2">{title}</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {people.length === 0 && (
          <span className="text-xs text-slate-400 col-span-full">Kayıt yok</span>
        )}
        {people.map((p) => (
          <button
            key={p.id}
            onClick={() => onPick?.(p)}
            className={cn(
              "p-3 rounded-lg border text-sm md:text-base font-medium text-left whitespace-normal break-words leading-snug min-h-[56px]",
              selectedId === p.id
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white border-slate-200 hover:bg-slate-50"
            )}
            title={p.name}
          >
            {p.name}
            {leavesCountFor && leavesCountFor(p) > 0 && (
              <span className="ml-1 opacity-80">({leavesCountFor(p)})</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
