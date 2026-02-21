// src/app/ErrorProbe.jsx
import React, { useEffect } from "react";

export default function ErrorProbe() {
  useEffect(() => {
    const onErr = (e) => {
      // Konsola ve ekrana bas
      // (React overlay çıkmıyorsa bile göreceksin)
      console.error("GlobalError:", e.message || e.reason || e);
      const box = document.getElementById("__fatal__");
      if (box) {
        box.style.display = "block";
        box.textContent = "HATA: " + (e.message || e.reason || String(e));
      }
    };
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onErr);
    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onErr);
    };
  }, []);

  return (
    <div
      id="__fatal__"
      style={{
        display: "none",
        position: "fixed",
        zIndex: 999999,
        top: 8,
        left: 8,
        right: 8,
        padding: 12,
        borderRadius: 8,
        background: "#210",
        color: "#fff",
        fontSize: 14,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas",
        boxShadow: "0 6px 18px rgba(0,0,0,.35)",
      }}
    />
  );
}
