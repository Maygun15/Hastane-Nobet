// src/pages/PingTester.jsx
import React from "react";
import { http } from "../lib/http";

export default function PingTester() {
  const [res, setRes] = React.useState(null);
  const [err, setErr] = React.useState("");

  const ping = async () => {
    setErr("");
    setRes(null);
    try {
      const r = await http.get("/ai/ping");
      setRes(r.data);
    } catch (e) {
      setErr(e?.response?.data?.message || e.message);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center bg-slate-50 p-6">
      <div className="bg-white rounded-xl shadow p-6 w-[420px] space-y-3">
        <h1 className="text-xl font-semibold">Frontend ↔ Backend Ping</h1>
        <button onClick={ping} className="w-full py-2 rounded bg-black text-white">
          Ping At
        </button>
        {res && (
          <pre className="text-xs bg-slate-900 text-slate-100 p-3 rounded overflow-auto max-h-64">
            {JSON.stringify(res, null, 2)}
          </pre>
        )}
        {err && <div className="text-red-600 text-sm">Hata: {err}</div>}
      </div>
    </div>
  );
}
