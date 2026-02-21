// src/components/MyPage.jsx
import React from "react";
import TopTabsBar from "./TopTabsBar.jsx";

export default function MyPage() {
  const [tabs, setTabs] = React.useState([
    { id: "calisma", title: "Çalışma Çizelgesi" },
    { id: "aylik", title: "Aylık Çalışma ve Mesai Saatleri Çizelgesi" },
    { id: "fazla", title: "Fazla Mesai Takip Formu" },
    { id: "izin", title: "Toplu İzin Listesi" },
  ]);
  const [activeId, setActiveId] = React.useState(tabs[0].id);

  const onMove = (id, dir) => {
    setTabs((prev) => {
      const i = prev.findIndex((t) => t.id === id);
      if (i < 0) return prev;
      const j = dir === "left" ? i - 1 : i + 1;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      const [row] = next.splice(i, 1);
      next.splice(j, 0, row);
      return next;
    });
  };

  const onAdd = (name) => {
    const id =
      name.toLowerCase().replace(/\s+/g, "-") +
      "-" +
      crypto.randomUUID().slice(0, 6);
    setTabs((prev) => [...prev, { id, title: name }]);
    setActiveId(id);
  };

  const onRename = (id, name) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, title: name } : t))
    );
  };

  const onRemove = (id) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (activeId === id) setActiveId(next[0]?.id ?? "");
      return next;
    });
  };

  return (
    <div className="p-4">
      <TopTabsBar
        tabs={tabs}
        activeId={activeId}
        onSelect={setActiveId}
        onMove={onMove}
        onAdd={onAdd}
        onRename={onRename}
        onRemove={onRemove}
      />

      {/* aktif sekmeye göre içerik */}
      <div className="mt-4">
        {activeId === "calisma" && <div>Çalışma Çizelgesi içeriği…</div>}
        {activeId === "aylik" && <div>Aylık Çalışma ve Mesai Saatleri…</div>}
        {activeId === "fazla" && <div>Fazla Mesai Takip Formu…</div>}
        {activeId === "izin" && <div>Toplu İzin Listesi…</div>}
      </div>
    </div>
  );
}
