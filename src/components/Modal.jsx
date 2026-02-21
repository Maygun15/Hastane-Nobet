// src/components/Modal.jsx
import React from "react";

export default function Modal({ open, title, onClose, children, footer }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-5xl rounded-2xl bg-white shadow-xl border">
          <div className="px-5 py-4 border-b flex items-center justify-between">
            <div className="text-lg font-semibold">{title}</div>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm rounded-md border hover:bg-gray-50"
            >
              Kapat
            </button>
          </div>
          <div className="p-5 max-h-[70vh] overflow-auto">{children}</div>
          {footer ? (
            <div className="px-5 py-4 border-t bg-gray-50 rounded-b-2xl flex items-center justify-end gap-2">
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
