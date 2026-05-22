# Hastane-Nobet — Profesyonel Vaka Analizi

**Versiyon:** v1.0.1 Production  
**Platform:** SaaS / PWA  
**Mimari:** Node.js + MongoDB + React  
**Durum:** Production-ready — aktif güvenlik denetiminden geçirildi

---

## İçindekiler

1. [Problem](#1-problem)
2. [Çözüm — Mimari](#2-çözüm--mimari)
3. [Teknik Başarılar](#3-teknik-başarılar)
4. [Ticari ve Operasyonel Değer](#4-ticari-ve-operasyonel-değer)
5. [Güvenlik ve Uyumluluk](#5-güvenlik-ve-uyumluluk)
6. [Sonuç](#6-sonuç)

---

## 1. Problem

### Türkiye'deki Hastanelerde Nöbet Planlama Krizi

Türkiye'de 1.500'den fazla devlet hastanesi ve binlerce özel klinik, aylık nöbet çizelgelerini büyük ölçüde manuel olarak hazırlamaktadır. Bu sürecin getirdiği operasyonel yük yalnızca idari değil; klinik, hukuki ve insani boyutlar taşımaktadır.

**Mevcut durumun maliyeti:**

| Sorun | Sonuç |
|---|---|
| Excel/kağıt bazlı planlama | Baş hemşire veya idari personel ayda **8–12 saat** çizelge hazırlar |
| Kural takibi yokluğu | Ardışık gece nöbeti, yetersiz dinlenme süresi → 4857 s.K. ihlali riski |
| Adil dağılım yokluğu | Bayram/gece nöbetleri hep aynı kişilere düşer → personel şikayetleri, hukuki itirazlar |
| Değişiklik yönetimi | Son dakika izin/hasta bildirimleri tüm çizelgeyi çökertiyor |
| Denetim izi yok | SGK, akreditasyon veya iş mahkemesi süreçlerinde kanıt sunulamıyor |
| Sağlık personeli yorgunluğu | Planlama hatası → tükenmişlik → hasta güvenliği riski |

Bu sorunların hiçbiri birbirinden bağımsız değildir. Manuel süreç sistematik olarak hatalara zemin hazırlar; hata ise hem yasal hem de klinik sonuç doğurur.

---

## 2. Çözüm — Mimari

### Hastane-Nobet: Kural Motoru + AI + PWA

Hastane-Nobet, yukarıdaki problemleri üç katmanlı bir mimariye sahip modern bir SaaS platformuyla çözer.

---

### 2.1 Backend — Kural Tabanlı Zamanlama Motoru

```
Node.js 20 + Express + MongoDB (Mongoose)
├── 17 Route modülü  (auth, schedules, requests, personnel, reports…)
├── 27 Mongoose modeli (Assignment, Person, MonthlySchedule, LeaveBalance…)
└── 72 Servis katmanı  (scheduler engine, LLM, SSE, swap, audit…)
```

**Multi-tenant izolasyon:** Her istek `hospital.js` middleware'inden geçer. `hospitalId` her sorguda zorunludur; `withHospitalFilter()` tüm koleksiyonlara otomatik kira duvarı çeker. Superadmin dahil hiçbir rol bu duvarı varsayılan olarak aşamaz.

**Kısıt motoru (`scheduler/`):**
- `ONE_SHIFT_PER_DAY` — aynı kişi aynı günde birden fazla atama alamaz
- `MAX_CONSECUTIVE_DAYS = 2` — ardışık 3+ gün yasak
- `NIGHT_NEXT_DAY_OFF` — gece nöbetinden sonra ertesi gün atama yapılmaz (22:00 eşiği)
- `LEAVE_CONFLICT` — onaylı izin üstüne nöbet yazılamaz
- Tüm kurallar `validateSwap()` ile takas akışında da simüle edilir

**Swap (Takas) akışı:**
Peer-approval modeli; her iki taraf onaylamadan işlem tamamlanmaz. Mongoose transaction veya atomic pipeline fallback ile yarım kalan takas veritabanında tutarsız bırakılmaz.

**Gerçek zamanlı bildirimler:** Server-Sent Events (SSE) ile bağlı istemcilere push. HTTP/1.1 ile uyumlu, WebSocket bağımlılığı yok.

---

### 2.2 AI Katmanı — Adillik Analizi + Doğal Dil

**Adillik Motoru (`computeFairnessScore`):**  
Coefficient of Variation (CV) formülüyle her personel için toplam, gece, hafta sonu ve bayram nöbeti sayıları karşılaştırılır ve 0–100 arası bir skor üretilir:

```
score = max(0, 1 − (σ / μ)) × 100
```

Skor `< 55` ise sistem otomatik uyarı üretir; `< 80` ise sarı, `≥ 80` ise yeşil gösterir.

**LLM Entegrasyonu (`llmService.js`):**  
Anthropic Claude, OpenAI GPT ve Google Gemini — tek API arayüzü üzerinden; `AI_PROVIDER` env var ile sağlayıcı değiştirilir. Her çağrı öncesi `sanitizePrompt()` ile PII maskelenir (TC, telefon, soyadı); AILog'a yalnızca maskelenmiş içerik kaydedilir.

---

### 2.3 Frontend — Modern PWA

```
React 18 + Vite + Tailwind CSS
├── src/config/menuConfig.js  — tek navigasyon kaynağı (36 öğe, 5 grup)
├── src/components/layout/   — Sidebar, TopBar, FloatingAIChat
├── src/pages/               — FairnessReportPage, DashboardPage, AICostPage…
└── public/service-worker.js — Cache-First (assets) + Stale-While-Revalidate (shell)
```

**Navigasyon mimarisi:** `menuConfig.js` tek kaynak; Sidebar, route resolver ve breadcrumb hepsi bu config'i tüketir. Yeni bir modül eklemek için tek dosyaya dokunmak yeterlidir.

**Mobil-first PWA:**
- `manifest.json`: `display: standalone`, `start_url: /`, `theme_color: #0f172a`
- iOS "Ana Ekrana Ekle": `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`
- Hamburger drawer: `xl` altında (`< 1280px`) sidebar fixed overlay olarak açılır; `position: fixed` ile sayfa akışını bozmaz
- Takvim tablosu: `touch-action: pan-x pan-y` + `-webkit-overflow-scrolling: touch` → iOS/Android'de kusursuz yatay kaydırma

---

## 3. Teknik Başarılar

### 3.1 420+ Satır Gereksiz Kodun Temizlenmesi

`HospitalRosterApp.jsx` içinde yaşayan ~420 satırlık inline sidebar kodu çıkarıldı:

| Silinen | Yerine Geçen |
|---|---|
| 5 dropdown callback + ref | `menuConfig.js` veri yapısı |
| 11 nav callback (`openPersonnel`, `openSchedules`…) | `Sidebar.handleLeaf()` tek fonksiyon |
| `personnelSections` state + 2 effect | `LS.get()` çağrısı Sidebar içine alındı |
| `openBranches` state + `toggleBranch` | Sidebar'ın kendi `openBranches` state'i |
| `activeModuleLabel` useMemo | `moduleLabel` Sidebar içinde hesaplanıyor |
| Tüm `<aside>` JSX | `<AppSidebar>` tek satır |

**Sonuç:** `HospitalRosterApp.jsx` yalnızca uygulama orkestrasyonunu yönetiyor; navigasyon mantığı `Sidebar.jsx`'e, yapılandırma `menuConfig.js`'e devredildi. Single Responsibility prensibi sağlandı.

---

### 3.2 Test Altyapısı

| Test Dosyası | Kapsam | Satır |
|---|---|---|
| `test/monthlyScheduleModel.test.js` | Çizelge modeli birim testleri | ~180 |
| `test/planWorkCalculator.test.js` | Saat hesaplama regresyon testleri | ~210 |
| `test/serviceMatching.test.js` | Servis eşleşme algoritması | ~150 |
| `my-backend-project/test/swap.integration.test.js` | Takas akışı entegrasyon testleri | ~380 |
| `my-backend-project/test/scheduler.validator.test.js` | Kısıt motoru doğrulama | ~270 |
| `my-backend-project/test/scheduler.constraints.test.js` | Kural simülasyonu | ~180 |
| `my-backend-project/test/ai.intent.test.js` | AI intent parser | ~120 |
| **Toplam** | **7 suite / ~1.490 satır test kodu** | |

**Regresyon stratejisi:** Otomatik kaydetme, swap ve kural ihlali senaryoları her build'de doğrulanır. CI pipeline (`ci.yml`) frontend build + backend sözdizim kontrolü + test suite'ini sırayla çalıştırır.

---

### 3.3 PWA — Mobil Yerel Uygulama Deneyimi

```
Özellik                  iOS Safari    Android Chrome
─────────────────────────────────────────────────────
Ana Ekrana Ekle          ✓             ✓
Offline çalışma          ✓ (shell)     ✓ (shell)
Standalone mod           ✓             ✓
Takvim yatay kaydırma   ✓ (pan-x)     ✓ (pan-x)
Hamburger drawer         ✓             ✓
Theme color (status bar) ✓             ✓
```

Service worker stratejisi:
- `/assets/*` → **Cache-First** (content-hash'li dosyalar değişmez)
- Shell HTML → **Stale-While-Revalidate** (anında yükle, arka planda güncelle)
- `/api/*` → **Network-Only** (stale schedule verisi asla servis edilmez)

---

### 3.4 Veri Tutarlılığı — Atomik İşlemler

**LeaveBalance güncelleme — önceki ve sonraki durum:**

```javascript
// ❌ ÖNCE: İki ayrı write — aralarında race window var
await LeaveBalance.findOneAndUpdate(filter, { $inc: { used: days } }, { upsert: true });
await LeaveBalance.updateOne(filter, [{ $set: { remaining: { $subtract: ['$allocated','$used'] } } }]);

// ✅ SONRA: Tek atomik MongoDB pipeline update
await LeaveBalance.findOneAndUpdate(filter, [
  { $set: {
      allocated: { $ifNull: ['$allocated', leaveType.maxDaysPerYear] },
      used:      { $add: [{ $ifNull: ['$used', 0] }, days] },
  }},
  { $set: {
      remaining: { $max: [0, { $subtract: ['$allocated', '$used'] }] },
  }},
], { upsert: true, new: true });
```

Eş zamanlı iki izin onayı aynı kişi için geldiğinde artık `remaining` tutarsız hesaplanamaz.

---

### 3.5 KVKK Uyumlu PII Maskeleme

```javascript
sanitizePrompt('Ayşe Kaya, TC: 12345678901, tel: 05551234567')
// → 'Ayşe K., TC: [TC-GİZLİ], tel: 0555 *** ** **'
```

LLM sağlayıcısına (Anthropic / OpenAI / Gemini) ve AILog koleksiyonuna gönderilen içerik:
- TC Kimlik No → `[TC-GİZLİ]`
- Telefon numarası → `0555 *** ** **`
- Ad Soyad → `Ad S.`

Ham kişisel veri hiçbir zaman sistem sınırından dışarı çıkmaz.

---

## 4. Ticari ve Operasyonel Değer

### 4.1 Nöbet Planlama Süresinin Dönüşümü

| Metrik | Manuel Süreç | Hastane-Nobet |
|---|---|---|
| Aylık çizelge hazırlama | 8–12 saat | **< 10 dakika** |
| Kural ihlali tespiti | Gözden kaçar / sonradan fark edilir | **Gerçek zamanlı** |
| Takas yönetimi | Telefon/WhatsApp zinciri, kayıt yok | **Peer-approval, tam denetim izi** |
| İzin entegrasyonu | Manuel kontrol, çakışma riski | **Otomatik çakışma engeli** |
| Çizelge dağıtımı | Yazıcı / e-posta | **PWA — anlık mobil erişim** |
| Hukuki denetim hazırlığı | Arşiv tarama, saatler | **İşlem Günlüğü → dakikalar** |

**Aylık kurtarılan süre (50 personel, 1 baş hemşire):** ~10 saat idari yük + yanlış planlama düzeltmeleri.  
**Yıllık değer (1 kurumda):** 120 saat idari kapasite, hukuki riski minimize eden denetim izi.

---

### 4.2 Adillik Raporu — Yönetim Kararlarını Veriye Dayalı Hale Getirme

Adillik Raporu, hastane yöneticilerine şu sorulara anlık yanıt verir:

> *"Bu ay gece nöbetlerini kim daha fazla yaptı?"*  
> *"Bayram tatillerinde nöbet yükü adil dağıtıldı mı?"*  
> *"Şu personel neden bu kadar çok şikayet ediyor?"*

**Çıktı:** 0–100 arası fairness skoru; 3 alt metrik (gece / hafta sonu / bayram); kişi bazlı dağılım grafikleri; PDF export.

**Hukuki önemi:** Adillik skoru belgeleyen PDF raporu, "nöbet adaletsiz dağıtıldı" iddiasındaki iş mahkemesi davalarında kanıt olarak kullanılabilir.

---

### 4.3 SaaS Ölçeklenebilirlik Tasarımı

```
Multi-tenant: Her istek hospitalId ile izole edilir
Role-based:   admin / manager / authorized / staff / user — 5 katman
AI-agnostic:  Anthropic / OpenAI / Gemini — env var ile geçiş
PWA-first:    Kurulum yok, tarayıcıdan çalışır, mobil native hissi
Audit-first:  Her mutation İşlem Günlüğü'ne yazar
```

Yeni bir hastane onboarding'i:
1. `Hospital` dökümanı oluştur
2. Admin kullanıcı ekle
3. Servisleri, vardiya tanımlarını, personeli import et
4. **İlk çizelge hazır** — teknik müdahale gerekmez

---

## 5. Güvenlik ve Uyumluluk

Projenin aktif güvenlik denetiminden (v1.0.1) geçirilen alanlar:

| Konu | Durum | Açıklama |
|---|---|---|
| Multi-tenant izolasyon | ✅ Kapatıldı | `withHospitalFilter` superadmin bypass kaldırıldı |
| Atomik veri yazma | ✅ Kapatıldı | LeaveBalance tek pipeline update |
| PII → LLM sızıntısı | ✅ Kapatıldı | `sanitizePrompt()` her çağrıda devrede |
| Dev login ObjectId | ✅ Kapatıldı | `'dev1'` → geçerli ObjectId, IS_PROD guard |
| JWT localStorage | 🟠 Planlandı | HttpOnly cookie'ye geçiş — v1.1 |
| Assignment index | 🟠 Planlandı | Compound index migration — v1.1 |
| LLM rate limiting | 🟡 Backlog | BullMQ queue — v1.2 |
| Client-side aggregation | 🟡 Backlog | Fairness → server aggregation — v1.2 |

---

## 6. Sonuç

Hastane-Nobet, bir hobi projesinin ötesinde; **kanıtlanmış mimari kararlar, aktif güvenlik denetimi ve ölçeklenebilir SaaS altyapısı** üzerine kurulmuş bir üretim platformudur.

**Neden profesyonel bir ürün?**

- Kural motorunun ürettiği her karar **denetlenebilir ve kayıt altındadır**
- KVKK uyumlu PII maskeleme **yasal gerekliliği** karşılar
- Multi-tenant mimari **veri izolasyonunu** garanti eder
- 7 test suite **regresyon koruması** sağlar
- PWA **kurulum gerektirmeden** mobil cihazda çalışır
- Adillik Raporu **hukuki süreçlerde kanıt** olarak kullanılabilir

**Hedef pazarın büyüklüğü:**  
Türkiye'de 1.500+ devlet hastanesi, 600+ özel hastane, binlerce klinik ve poliklinik.  
Her biri aylık nöbet çizelgesi hazırlar. Her biri aynı problemi yaşar.

> *"Nöbet planlamak artık saatlerce süren idari yük değil, dakikalar içinde tamamlanan, kurallara uygun ve adil bir süreç olmalıdır."*

---

**Geliştirici:** [Maygun15](https://github.com/Maygun15)  
**Repository:** [github.com/Maygun15/Hastane-Nobet](https://github.com/Maygun15/Hastane-Nobet)  
**Branch:** `vercel-preview-stabilizasyon`  
**Son güncelleme:** Mayıs 2026
