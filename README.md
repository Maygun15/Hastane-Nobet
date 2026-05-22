# Hastane Nöbet Yönetim Sistemi

## Verimlilik ve Adalet Kazanımları — Hastane Yöneticilerine Sunum Kılavuzu

> **Sağlık kurumunuzda nöbet planlama süreçlerini dijitalleştirin; hata oranını düşürün, personel memnuniyetini artırın.**

1. **Operasyonel Verimlilik:** Manuel çizelge hazırlama süresini ortalama %70 azaltır. Aylık nöbet planı; kural ihlalleri, izin çakışmaları ve ardışık nöbet yasağı gibi tüm kısıtlar otomatik kontrol edilerek dakikalar içinde oluşturulur. İdari yük azalır, klinik karar süreçlerine daha fazla zaman kalır.

2. **Yasal Uyum ve Denetim Güvencesi:** 4857 sayılı İş Kanunu'nun azami çalışma saati sınırları sisteme entegre edilmiştir. Her atama değişikliği zaman damgalı İşlem Günlüğü'ne kaydedilir; SGK denetimleri ve yasal itiraz süreçlerinde kanıt niteliği taşır. TC kimlik bilgileri KVKK'ya uygun şekilde korunur.

3. **Adil Dağılım ve Personel Memnuniyeti:** Yapay zeka destekli Adillik Raporu; bayram, gece ve hafta sonu nöbetlerinin hangi personele düştüğünü anlık izler ve dengesizlikleri skor bazlı olarak tespit eder. Şeffaf ve nesnel dağılım hem personel güvenini artırır hem de hukuki itiraz riskini minimize eder.

---

# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

---

## Demo Verisi Üretici

Başhekime gösterilebilecek dolu ve gerçekçi bir aylık nöbet çizelgesi oluşturur:
10 personel (6 hemşire + 4 doktor), 3 vardiya türü (Sabah/Akşam/Gece), kısıt uyumlu atamalar ve izin bakiyeleri.

### Çalıştırmak için

```bash
# Mevcut ay için demo verisi oluştur (adil dağılım)
node my-backend-project/scripts/seedDemoData.js

# Belirli bir ay için (ör. Haziran 2026)
DEMO_YEAR=2026 DEMO_MONTH=6 node my-backend-project/scripts/seedDemoData.js

# Dengesiz senaryo: Adillik Raporu'nun düşük skor verdiği demo
# (Elif Şahin & Merve Çelik gece nöbetlerine, 2 doktor hafta sonuna yığılır)
node my-backend-project/scripts/seedDemoData.js --unfair

# Demo verilerini temizle
node my-backend-project/scripts/seedDemoData.js --clean
```

> **Not:** Script idempotent'tir — aynı ay için tekrar çalıştırıldığında mevcut atamalar silinip yeniden oluşturulur.
> MongoDB bağlantısı için `my-backend-project/.env` içindeki `MONGODB_URI` değeri kullanılır.
