import React, { useState, useEffect } from "react";
import { WifiOff, ServerOff } from "lucide-react";
import { apiHealth } from "../lib/api.js";

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

  // Her şey yolundaysa gösterme
  if (isOnline && isBackendUp) return null;

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