// src/components/TopTabsBar.jsx
import React from "react";
import { ChevronLeft, ChevronRight, Plus, Pencil, Trash2 } from "lucide-react";

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
    <div className="flex items-center gap-4 w-full">
      {/* SOL sekmeler */}
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

      {/* SAĞ: ekle/düzenle/sil */}
      <div className="ml-auto flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          className="h-10 w-[260px] rounded border px-3"
          placeholder="Yeni sekme adı"
          title="Enter: Ekle • Shift+Enter: Düzenle • Esc: Temizle"
        />
        <button
          onClick={add}
          className="flex items-center gap-1 bg-emerald-600 text-white rounded px-3 py-2"
          title="Sekme ekle (Enter)"
        >
          <Plus size={16} /> Ekle
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
  );
}
