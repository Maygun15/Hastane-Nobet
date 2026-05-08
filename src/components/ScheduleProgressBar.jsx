import React, { useState, useEffect } from 'react';
import axios from 'axios';

/**
 * Celery Task'ını takip eden Progress Bar bileşeni.
 * @param {string} taskId - Takip edilecek Celery görev ID'si.
 * @param {function} onComplete - Görev başarıyla bittiğinde çağrılacak callback.
 * @param {function} onError - Görev hata aldığında çağrılacak callback.
 */
const ScheduleProgressBar = ({ taskId, onComplete, onError }) => {
    const [progress, setProgress] = useState(0);
    const [message, setMessage] = useState('İşlem kuyruğa alındı, başlatılıyor...');
    const [status, setStatus] = useState('PENDING');

    useEffect(() => {
        if (!taskId) return;

        // Belirli aralıklarla (polling) arka plandaki görevin durumunu sorgula
        const intervalId = setInterval(async () => {
            try {
                // Daha önce FastAPI tarafında yazdığımız endpoint'e istek atıyoruz
                const response = await axios.get(`/api/schedule/status/${taskId}`);
                const data = response.data;

                setStatus(data.status);

                if (data.status === 'PROGRESS') {
                    // Celery'den dönen meta verilerini state'e yaz
                    setProgress(data.meta?.progress || 0);
                    setMessage(data.meta?.message || 'İşlem devam ediyor...');
                }
                else if (data.status === 'SUCCESS') {
                    setProgress(100);
                    setMessage('Nöbet programı başarıyla oluşturuldu!');
                    clearInterval(intervalId); // İşlem bitince sorgulamayı durdur

                    if (onComplete) onComplete(data.result);
                }
                else if (data.status === 'FAILURE') {
                    setMessage('Bir hata oluştu: ' + (data.error || 'Bilinmeyen hata'));
                    clearInterval(intervalId); // Hata durumunda sorgulamayı durdur

                    if (onError) onError(data.error);
                }
            } catch (error) {
                console.error("Görev durumu sorgulanırken hata:", error);
                setMessage('Sunucu bağlantısında sorun oluştu.');
                clearInterval(intervalId);

                if (onError) onError(error);
            }
        }, 2000); // Her 2 saniyede bir güncelle

        // Bileşen ekrandan kaldırılırsa (unmount) interval'i temizle
        return () => clearInterval(intervalId);
    }, [taskId, onComplete, onError]);

    // İlerleme durumuna göre renk belirleme
    const getBarColor = () => {
        if (status === 'FAILURE') return 'bg-red-500';
        if (status === 'SUCCESS') return 'bg-green-500';
        return 'bg-blue-600';
    };

    return (
        <div className="w-full max-w-lg mx-auto mt-4 p-4 border border-gray-200 rounded-lg shadow-sm bg-white">
            <div className="flex justify-between mb-2">
                <span className="text-sm font-medium text-gray-700">{message}</span>
                <span className="text-sm font-medium text-gray-700">{progress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                    className={`h-3 rounded-full transition-all duration-500 ease-out ${getBarColor()}`}
                    style={{ width: `${progress}%` }}
                ></div>
            </div>
        </div>
    );
};

export default ScheduleProgressBar;