import React, { useState, useEffect } from "react";
import { WifiOff, ServerOff } from "lucide-react";
import { apiHealth } from "../lib/api.js";
import { isOnlineOnly } from "../lib/apiConfig.js";

export default function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isBackendUp, setIsBackendUp] = useState(true);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    // İnternet yoksa backend kontrolüne gerek yok (zaten erişilemez)
    if (!isOnline) return;

    let mounted = true;
    const checkBackend = async () => {
      try {
        await apiHealth();
        if (mounted) setIsBackendUp(true);
      } catch (err) {
        if (mounted) setIsBackendUp(false);
      }
    };

    // İlk kontrol
    checkBackend();

    // Periyodik kontrol (30 saniyede bir)
    const interval = setInterval(checkBackend, 30000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [isOnline]);

  const hardBlock = isOnlineOnly() && (!isOnline || !isBackendUp);

  // Her şey yolundaysa gösterme
  if (isOnline && isBackendUp) return null;

  if (hardBlock) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-white">
        <div className="max-w-md w-full mx-4 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-800 shadow">
          <div className="text-lg font-semibold mb-2">Bağlantı gerekli</div>
          <div className="text-sm">
            {!isOnline ? "İnternet bağlantısı yok." : "Sunucuya ulaşılamıyor."}
          </div>
          <div className="text-xs text-rose-700/80 mt-2">
            Sistem online çalışacak şekilde ayarlandı. Bağlantı sağlanınca uygulama otomatik devam eder.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
      <div className="bg-rose-600 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 pointer-events-auto animate-pulse">
        {!isOnline ? (
          <>
            <WifiOff size={20} />
            <div className="text-sm font-medium">İnternet bağlantısı yok</div>
          </>
        ) : (
          <>
            <ServerOff size={20} />
            <div className="text-sm font-medium">Sunucuya ulaşılamıyor</div>
          </>
        )}
      </div>
    </div>
  );
}
