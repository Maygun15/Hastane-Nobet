// src/components/TopTabsBar.jsx
import React from "react";
import { ChevronLeft, ChevronRight, GripVertical, Plus, Pencil, Trash2 } from "lucide-react";

/**
 * TopTabsBar
 *
 * - Sekmeler ve aktif sekme localStorage'a persist edilir (storageKey ile).
 * - Klavye kısayolları: Enter (ekle), Shift+Enter (yeniden adlandır), Esc (input temizle).
 * - Orta tık (mouse wheel) ile sekme kapatma.
 * - Sekme nesnesinde `href`, `hidden`, `disabled` alanları desteklenir.
 * - getHref(tab) verilirse, sekmeye tıklayınca o URL'ye navigate edilir (tab.href önceliklidir).
 */
export default function TopTabsBar({
  tabs = [],              // [{ id, title, href?, hidden?, disabled? }, ...]
  activeId,
  onSelect,
  onMove,
  onAdd,
  onRename,
  onRemove,
  getHref,                // (tab) => string | null  (opsiyonel)
  storageKey = "TopTabsBar",
  variant = "default",
  title = "Sekmeler",
  subtitle = "",
  addLabel = "Ekle",
  inputPlaceholder = "Yeni sekme adı",
}) {
  const [input, setInput] = React.useState("");
  const visibleTabs = tabs.filter(t => !t.hidden);
  const activeExists = visibleTabs.some((t) => t.id === activeId);

  /* ===== Local Storage helpers ===== */
  const LS_KEYS = React.useMemo(
    () => ({
      tabs: `${storageKey}:tabs`,
      active: `${storageKey}:active`,
      input: `${storageKey}:input`,
    }),
    [storageKey]
  );

  const persist = React.useCallback(
    (next = {}) => {
      try {
        if (next.tabs) {
          localStorage.setItem(LS_KEYS.tabs, JSON.stringify(next.tabs));
        }
        if (typeof next.activeId !== "undefined") {
          localStorage.setItem(LS_KEYS.active, String(next.activeId ?? ""));
        }
        if (typeof next.input !== "undefined") {
          localStorage.setItem(LS_KEYS.input, String(next.input ?? ""));
        }
      } catch {
        // no-op
      }
    },
    [LS_KEYS]
  );

  React.useEffect(() => {
    // tabs derin eşitlik için string'leyip saklıyoruz
    persist({ tabs });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(tabs)]);

  React.useEffect(() => {
    persist({ activeId });
  }, [activeId, persist]);

  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEYS.input);
      if (saved && !input) setInput(saved);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    persist({ input });
  }, [input, persist]);

  /* ===== Actions ===== */
  const add = () => {
    const name = input.trim();
    if (!name) return;
    onAdd?.(name);
    setInput("");
  };

  const rename = () => {
    const name = input.trim();
    if (!name || !activeExists) return;
    onRename?.(activeId, name);
    setInput("");
  };

  const remove = () => {
    if (!activeExists) return;
    onRemove?.(activeId);
  };

  const moveLeft = (id) => onMove?.(id, "left");
  const moveRight = (id) => onMove?.(id, "right");

  /* ===== Keyboard shortcuts ===== */
  const onKeyDown = (e) => {
    if (e.key === "Enter") {
      if (e.shiftKey && activeExists) {
        e.preventDefault();
        rename();
      } else {
        e.preventDefault();
        add();
      }
    } else if (e.key === "Escape") {
      setInput("");
    }
  };

  /* ===== Middle-click close (auxclick) ===== */
  const onTabAuxClick = (e, id) => {
    if (e.button === 1) {
      e.preventDefault();
      onRemove?.(id);
    }
  };

  /* ===== Navigate helper ===== */
  const goTo = (href) => {
    if (!href) return;
    try {
      window.history.pushState({}, "", href);
      window.dispatchEvent(new PopStateEvent("popstate"));
      return;
    } catch {}
    if (href.startsWith("#")) {
      window.location.hash = href;
    } else {
      window.location.href = href;
    }
  };

  return (
    variant === "sidebar" ? (
      <div className="space-y-4">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">{title}</div>
          {subtitle ? <p className="mt-1 text-sm leading-5 text-slate-600">{subtitle}</p> : null}
        </div>

        <div className="space-y-2">
          {visibleTabs.map((t, index) => {
            const isActive = t.id === activeId;
            const disabled = !!t.disabled;
            const href = t.href ?? (typeof getHref === "function" ? getHref(t) : null);
            const handleClick = () => {
              if (disabled) return;
              onSelect?.(t.id);
              if (href) goTo(href);
            };

            return (
              <div
                key={t.id}
                onAuxClick={(e) => !disabled && onTabAuxClick(e, t.id)}
                className={`group rounded-2xl border transition ${
                  isActive
                    ? "border-slate-900 bg-slate-950 text-white shadow-sm"
                    : "border-slate-200 bg-slate-50/70 hover:border-slate-300 hover:bg-white"
                } ${disabled ? "opacity-60" : ""}`}
              >
                <div className="flex items-center gap-3 px-3 py-3">
                  <button
                    type="button"
                    onClick={handleClick}
                    className={`flex min-w-0 flex-1 items-center gap-3 text-left ${disabled ? "cursor-not-allowed" : ""}`}
                    title={isActive ? "Aktif grup" : disabled ? "Bu gruba erişiminiz yok" : "Gruba geç"}
                  >
                    <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${
                      isActive ? "border-white/15 bg-white/10 text-white" : "border-slate-200 bg-white text-slate-500"
                    }`}>
                      <GripVertical size={15} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{t.title}</span>
                      <span className={`block text-xs ${isActive ? "text-slate-300" : "text-slate-500"}`}>
                        {isActive ? "Aktif personel grubu" : `Grup ${index + 1}`}
                      </span>
                    </span>
                  </button>

                  {!disabled && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); moveLeft(t.id); }}
                        className={`rounded-lg p-1.5 transition ${isActive ? "hover:bg-white/10" : "hover:bg-slate-100"}`}
                        title="Yukarı / sola taşı"
                      >
                        <ChevronLeft size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); moveRight(t.id); }}
                        className={`rounded-lg p-1.5 transition ${isActive ? "hover:bg-white/10" : "hover:bg-slate-100"}`}
                        title="Aşağı / sağa taşı"
                      >
                        <ChevronRight size={15} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <label className="text-xs font-medium text-slate-500">Yeni grup adı</label>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
            placeholder={inputPlaceholder}
            title="Enter: Ekle • Shift+Enter: Düzenle • Esc: Temizle"
          />
          <div className="mt-3 grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={add}
              className="inline-flex items-center justify-center gap-1 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white"
              title="Sekme ekle (Enter)"
            >
              <Plus size={15} /> {addLabel}
            </button>
            <button
              type="button"
              onClick={rename}
              disabled={!activeExists}
              className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
              title="Aktif sekmeyi yeniden adlandır (Shift+Enter)"
            >
              <Pencil size={15} /> Düzenle
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={!activeExists}
              className="inline-flex items-center justify-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 disabled:opacity-50"
              title="Aktif sekmeyi sil"
            >
              <Trash2 size={15} /> Sil
            </button>
          </div>
        </div>
      </div>
    ) : (
      <div className="flex items-center gap-4 w-full">
        <div className="flex items-center gap-3 overflow-x-auto pr-2">
          {visibleTabs.map((t) => {
            const isActive = t.id === activeId;
            const disabled = !!t.disabled;
            const baseCls = `whitespace-nowrap rounded-full border px-4 py-2 flex items-center gap-2 transition select-none`;
            const clickable = disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer";
            const color = isActive
              ? "bg-blue-600 text-white border-blue-600"
              : "bg-white text-slate-800 hover:bg-slate-50";

            const handleClick = () => {
              if (disabled) return;
              onSelect?.(t.id);
              const href = t.href ?? (typeof getHref === "function" ? getHref(t) : null);
              if (href) goTo(href);
            };

            return (
              <div
                key={t.id}
                onClick={handleClick}
                onAuxClick={(e) => !disabled && onTabAuxClick(e, t.id)}
                className={`${baseCls} ${clickable} ${color}`}
                title={isActive ? "Aktif sekme" : (disabled ? "Bu sekmeye erişiminiz yok" : "Sekmeye geç")}
              >
                <span className="truncate max-w-[220px]">{t.title}</span>
                {!disabled && (
                  <span className="flex items-center gap-1 ml-2">
                    <span
                      onClick={(e) => { e.stopPropagation(); moveLeft(t.id); }}
                      title="Sola taşı"
                      className="p-1 rounded hover:bg-white/20 cursor-pointer"
                    >
                      <ChevronLeft size={16} />
                    </span>
                    <span
                      onClick={(e) => { e.stopPropagation(); moveRight(t.id); }}
                      title="Sağa taşı"
                      className="p-1 rounded hover:bg-white/20 cursor-pointer"
                    >
                      <ChevronRight size={16} />
                    </span>
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            className="h-10 w-[260px] rounded border px-3"
            placeholder={inputPlaceholder}
            title="Enter: Ekle • Shift+Enter: Düzenle • Esc: Temizle"
          />
          <button
            onClick={add}
            className="flex items-center gap-1 bg-emerald-600 text-white rounded px-3 py-2"
            title="Sekme ekle (Enter)"
          >
            <Plus size={16} /> {addLabel}
          </button>
          <button
            onClick={rename}
            disabled={!activeExists}
            className="flex items-center gap-1 rounded px-3 py-2 border hover:bg-slate-50 disabled:opacity-50"
            title="Aktif sekmeyi yeniden adlandır (Shift+Enter)"
          >
            <Pencil size={16} /> Düzenle
          </button>
          <button
            onClick={remove}
            disabled={!activeExists}
            className="flex items-center gap-1 rounded px-3 py-2 border bg-red-50 hover:bg-red-100 disabled:opacity-50"
            title="Aktif sekmeyi sil (Orta tık ile sekmeyi de kapatabilirsin)"
          >
            <Trash2 size={16} /> Sil
          </button>
        </div>
      </div>
    )
  );
}
