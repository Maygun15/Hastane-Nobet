import React from "react";
import { cn, bg600, text700 } from "../utils/classnames.js";
import { Activity } from "lucide-react";

export default function ServiceCard({ def, onOpen, counts }) {
  const Icon = def.icon || Activity;
  const color = def.color || "slate";
  return (
    <button
      className="group relative overflow-hidden rounded-2xl border bg-white shadow-sm hover:shadow-md transition text-left"
      onClick={onOpen}
    >
      <div className="p-4 flex items-center gap-3">
        <div className={cn("w-10 h-10 rounded-xl grid place-items-center text-white", bg600(color))}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <div className="font-semibold">{def.name}</div>
          <div className="text-xs text-slate-500">Servis kimliği: {def.id}</div>
        </div>
      </div>
      <div className="px-4 pb-4 grid grid-cols-2 gap-2 text-center text-xs">
        <div className="rounded-lg bg-slate-50 p-2">
          <div className="text-slate-500">Doktor</div>
          <div className={cn("font-semibold", text700(color))}>{counts?.doctors || 0}</div>
        </div>
        <div className="rounded-lg bg-slate-50 p-2">
          <div className="text-slate-500">Hemşire</div>
          <div className={cn("font-semibold", text700(color))}>{counts?.nurses || 0}</div>
        </div>
      </div>
      <div className={cn("absolute inset-x-0 bottom-0 h-1", bg600(color))} />
    </button>
  );
}
