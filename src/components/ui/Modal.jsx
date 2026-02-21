// src/components/ui/Modal.jsx
import React from "react";

export default function Modal({
  open,
  title,
  children,
  onClose,
  footer,
  maxWidth = "max-w-4xl",
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100]">
      {/* arka plan */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden
      />
      {/* kutu */}
      <div
        className={`absolute left-1/2 top-12 -translate-x-1/2 rounded-2xl bg-white shadow-xl border w-[95vw] ${maxWidth}`}
        role="dialog"
        aria-modal="true"
      >
        <div className="px-4 sm:px-5 py-3 border-b flex items-center justify-between">
          <div className="text-base sm:text-lg font-semibold">{title}</div>
          <button
            className="px-2 py-1 rounded-md hover:bg-gray-100"
            onClick={onClose}
            aria-label="Kapat"
          >
            ✕
          </button>
        </div>
        <div className="p-4 sm:p-5 max-h-[70vh] overflow-auto">{children}</div>
        {footer ? (
          <div className="px-4 sm:px-5 py-3 border-t bg-gray-50 rounded-b-2xl">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
