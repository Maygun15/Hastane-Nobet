// src/components/AnnouncementModal.jsx
import React, { useEffect, useState } from 'react';
import { X, Megaphone } from 'lucide-react';
import { toast } from 'sonner';
import { http } from '../lib/api.js';

export default function AnnouncementModal({ onClose }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [mode, setMode] = useState('info');
  const [sending, setSending] = useState(false);
  const [responses, setResponses] = useState([]);
  const [responsesLoading, setResponsesLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    async function loadResponses() {
      setResponsesLoading(true);
      try {
        const res = await http.get('/api/notifications/announcement-responses?limit=50');
        if (!alive) return;
        setResponses(Array.isArray(res?.items) ? res.items : []);
      } catch {
        if (alive) setResponses([]);
      } finally {
        if (alive) setResponsesLoading(false);
      }
    }
    loadResponses();
    return () => { alive = false; };
  }, []);

  const send = async () => {
    if (!title.trim() || !body.trim()) {
      toast.error('Başlık ve içerik zorunludur');
      return;
    }
    setSending(true);
    try {
      const res = await http.post('/api/notifications/broadcast', { title: title.trim(), body: body.trim(), mode });
      const count = Number(res?.createdNotifications || res?.targetedUsers || 0);
      toast.success(count > 0 ? `Duyuru ${count} kullanıcıya gönderildi` : 'Duyuru gönderildi');
      onClose();
    } catch (e) {
      toast.error(e?.message || 'Duyuru gönderilemedi');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold text-slate-800">
            <Megaphone size={16} className="text-sky-600" />
            Toplu Duyuru Gönder
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 text-slate-500" aria-label="Kapat">
            <X size={16} />
          </button>
        </div>
        <div className="grid max-h-[72vh] gap-0 overflow-hidden md:grid-cols-[minmax(0,1fr)_260px]">
          <div className="p-5 space-y-4 overflow-y-auto">
            <div className="space-y-1">
              <label className="text-[12px] font-medium text-slate-600">
                Başlık <span className="text-rose-500">*</span>
              </label>
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-sky-400"
                placeholder="Duyuru başlığı..."
                value={title}
                onChange={e => setTitle(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[12px] font-medium text-slate-600">
                İçerik <span className="text-rose-500">*</span>
              </label>
              <textarea
                rows={4}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-sky-400"
                placeholder="Duyuru içeriği..."
                value={body}
                onChange={e => setBody(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[12px] font-medium text-slate-600">Duyuru tipi</label>
              <div className="grid gap-2">
                {[
                  ['info', 'Sadece bilgilendirme', 'Kullanıcı okur; cevap veya onay beklenmez.'],
                  ['ack', 'Okundu onayı iste', 'Kullanıcı “Okudum” diyerek kayıt bırakır.'],
                  ['reply', 'Cevap / geri bildirim iste', 'Kullanıcı kısa bir yanıt gönderebilir.'],
                ].map(([value, label, desc]) => (
                  <label
                    key={value}
                    className={`flex cursor-pointer gap-3 rounded-xl border px-3 py-2 text-[12px] ${
                      mode === value ? 'border-sky-300 bg-sky-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="announcement-mode"
                      value={value}
                      checked={mode === value}
                      onChange={() => setMode(value)}
                      className="mt-1"
                    />
                    <span>
                      <span className="block font-semibold text-slate-800">{label}</span>
                      <span className="block text-slate-500">{desc}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <aside className="border-t border-slate-100 bg-slate-50/70 p-4 md:border-l md:border-t-0">
            <div className="text-[12px] font-semibold text-slate-800">Yanıt Takibi</div>
            <div className="mt-1 text-[11px] leading-4 text-slate-500">
              Okundu onayları ve kullanıcı cevapları burada listelenir.
            </div>
            <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
              {responsesLoading && (
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-400">
                  Yükleniyor...
                </div>
              )}
              {!responsesLoading && responses.length === 0 && (
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-400">
                  Henüz yanıt yok.
                </div>
              )}
              {!responsesLoading && responses.map((item) => (
                <div key={item._id} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12px] font-semibold text-slate-800">
                      {item.userName || item.userEmail || 'Kullanıcı'}
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      item.responseType === 'reply' ? 'bg-sky-50 text-sky-700' : 'bg-emerald-50 text-emerald-700'
                    }`}>
                      {item.responseType === 'reply' ? 'Cevap' : 'Okundu'}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-[11px] text-slate-500">{item.title || 'Duyuru'}</div>
                  {item.message && (
                    <div className="mt-1 text-[11px] leading-4 text-slate-600">{item.message}</div>
                  )}
                </div>
              ))}
            </div>
          </aside>
        </div>
        <div className="px-5 py-4 border-t flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border text-[13px] text-slate-600 hover:bg-slate-50"
          >
            Vazgeç
          </button>
          <button
            onClick={send}
            disabled={sending}
            className="px-4 py-2 rounded-lg bg-sky-600 text-white text-[13px] font-medium hover:bg-sky-700 disabled:opacity-60"
          >
            {sending ? 'Gönderiliyor…' : 'Gönder'}
          </button>
        </div>
      </div>
    </div>
  );
}
