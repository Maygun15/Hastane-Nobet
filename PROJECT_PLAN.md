# Hastane-Nobet — Proje Planı

**Versiyon:** 1.2.0  
**Son Güncelleme:** 2026-05-22  
**Dal:** `vercel-preview-stabilizasyon`

---

## Projenin Amacı

Hastane personeli için aylık nöbet çizelgesi oluşturma, yönetme, takas etme ve raporlama sistemi.  
React (Vite) + Express 5 + MongoDB + Zustand mimarisiyle çalışır.  
Çok kiracılı (multi-tenant) yapı, RBAC, AI entegrasyonu ve gelişmiş scheduler engine içerir.

---

## Mevcut Mimari Haritası

```
hospital-roster/
├─ src/                     → React frontend (176 dosya, 25 tab, 14 sayfa)
├─ my-backend-project/      → Express 5 backend (163 dosya)
│  ├─ routes/               → 17 router, ~7.500 satır
│  ├─ services/             → 14 servis modülü
│  │  └─ scheduler/         → engine + constraints + policies + audit
│  ├─ models/               → 26 Mongoose şema
│  └─ middleware/           → auth, RBAC, hospitalScope
├─ shared/                  → constants, roles, permissions
└─ test/ + src/test/        → 9 test dosyası
```

---

## 1. Mevcut Darboğazlar (Kritik Hatalar)

> Bu hatalar tespit edilmiş, henüz tamamıyla düzeltilmemiştir. Kod referansları gerçek satır numaralarına dayanır.

### BUG-01 — DutyRule kuralları scheduler'a geçmiyor ✅ DÜZELTİLDİ
**Dosya:** `services/scheduler/ruleResolver.js:36`  
**Sorun:** `doc.rules` alanı `[{id, type, enabled, value}]` formatında bir array.  
Eski kod bunu `{ ...DEFAULT_RULES, ...(doc.rules || {}) }` şeklinde yayıyordu.  
Array spread etmek `{ 0: {...}, 1: {...} }` üretir — DEFAULT_RULES'un hiçbir anahtarı override edilmiyordu.  
**Düzeltme:** `basicRulesToSchedulerRules(doc.basicRules)` yardımcı fonksiyon eklendi.  
`maxConsecutiveDays → MAX_CONSECUTIVE_DAYS`, `minRestHours → MIN_REST_HOURS` vs. doğru eşleniyor.

---

### BUG-02 — LeaveBalance scheduler tarafından sorgulanmıyor
**Dosya:** `services/schedulerService.js:442`  
**Sorun:** Scheduler izinleri `payload.leavesByPerson` üzerinden alıyor; bu değer frontend'den gönderilmezse izinli kişiye nöbet yazılabiliyor.  
**Düzeltilecek:** Scheduler başlamadan önce DB'deki onaylı izin talepleri (`Request.status='approved'`) sorgulanıp `leavesByPerson` otomatik oluşturulacak.

---

### BUG-03 — LeaveBalance.allocated hiçbir zaman set edilmiyor
**Dosya:** `routes/requests.routes.js:93`  
**Sorun:** İzin onaylandığında `$setOnInsert: { allocated: 0 }` yazılıyor. `allocated` alanı (hakkedilen gün sayısı) hiçbir zaman doğru değerle güncellenmediği için `remaining` her zaman negatif.  
**Düzeltilecek:** İzin tipi oluşturulurken veya personel işe alındığında yıllık hak günü atanacak; onay akışında sadece `used` değiştirilecek.

---

### BUG-04 — executeSwap validateAssignment çağırmıyor
**Dosya:** `routes/requests.routes.js` — `executeSwap` fonksiyonu  
**Sorun:** Takas onaylandığında `rulesValidator.validateAssignment()` hiç çağrılmıyor.  
ScheduleRules (maxShifts, minRest, maxConsecutive, restrictedDays) tamamen atlanıyor.  
Yani takas işlemi nöbet yazma kurallarını ihlal edebiliyor.  
**Düzeltilecek:** `executeSwap` öncesinde `validateSwap()` çağrılacak; her iki tarafın yeni durumu simüle edilerek kural kontrolü yapılacak.

---

### BUG-05 — /assign endpoint namedAssignments güncellemiyor
**Dosya:** `routes/schedules.routes.js` — `/assign` endpoint  
**Sorun:** Manuel atama yapıldığında `Assignment` koleksiyonu güncelleniyor fakat `MonthlySchedule.data.roster.namedAssignments` güncellenmemiş kalıyor.  
DutyRowsEditor bu alandan okuduğu için manuel atamalar çizelgede görünmüyor.  
**Düzeltilecek:** Assign endpoint; atama sonrası `buildAssignmentsFromNamed` veya `assignmentsToNamed` çağırarak `namedAssignments`'ı sync'leyecek.

---

### BUG-06 — findNameFallback boş string kabul ediyor
**Dosya:** `routes/requests.routes.js` — `findAndSwap` fonksiyonu  
**Sorun:** Kişi adı bulunamazsa fallback olarak `""` (boş string) kullanılıyor.  
Bu `namedAssignments` içine boş string yazdırarak veri bozulmasına neden oluyor.  
**Düzeltilecek:** Boş string fallback kaldırılacak; ad bulunamazsa hata fırlatılacak.

---

### BUG-07 — swapSuggestionService Setting.find çok geniş
**Dosya:** `services/swapSuggestionService.js`  
**Sorun:** `Setting.find({ key: { $in: ['', serviceId] } })` — birden fazla servisin izin verisini birleştirip yanlış leave çakışması hesaplıyor.  
**Düzeltilecek:** Tek bir `Setting.findOne({ key: serviceId })` yapılacak.

---

### BUG-08 — RuleEngine koşullu; doküman yoksa çalışmıyor
**Dosya:** `services/scheduler/engine.js` ve `constraints.js`  
**Sorun:** `ruleEngineDoc` yoksa (DutyRule kaydı oluşturulmamışsa) RuleEngine hiç oluşturulmuyor.  
`leaveRules`, `taskRequirements`, `personnelRules` kontrolleri tamamen atlanıyor.  
**Düzeltilecek:** Her servis için minimum bir varsayılan DutyRule seed verilecek veya RuleEngine DEFAULT_RULES ile ayağa kalkacak.

---

### BUG-09 — isNightShiftDef eşiği 18:00, olması gereken 22:00
**Dosya:** `services/swapSuggestionService.js` veya constraints  
**Sorun:** Gece vardiyası tespiti `startHour >= 18` ile yapılıyor; 18:00 başlayan vardiyaları gece sayıyor, ardından gelen güne kısıtlama uyguluyor.  
Klinik standart gece vardiyası 22:00+.  
**Düzeltilecek:** Eşik `22`'ye çekilecek.

---

### BUG-10 — onAssigned callback'te race condition
**Dosya:** `src/components/PersonScheduleCalendar.jsx`  
**Sorun:** `onAssigned` callback içinde `setSwappedDates` ve `refreshRemote()` sırayla çağrılıyor.  
`refreshRemote` network'ten döndüğünde `swappedDates` state'i zaten silinmiş olabilir.  
**Düzeltilecek:** Refresh tamamlandıktan sonra swappedDates güncellenecek; ya da tek bir atomic state güncellemesi yapılacak.

---

### BUG-11 — RequestsManagementTab processing guard çift tıklamaya karşı yetersiz
**Dosya:** `src/tabs/RequestsManagementTab.jsx`  
**Sorun:** Onay/ret butonu tıklandığında `processing` state güncelleniyor; fakat optimistic update yoksa ikinci tıklamada API iki kez çağrılabiliyor.  
**Düzeltilecek:** `processing` state'i buton disabled ile senkron tutulacak; API yanıtı gelmeden ikinci istek gönderilmeyecek.

---

### BUG-12 — PersonScheduleCalendar QuickReplacePanel DutyRowsEditor'a bağlı değil
**Dosya:** `src/components/QuickReplacePanel.jsx`, `src/tabs/SchedulesTab.jsx`  
**Sorun:** Hızlı yerine atama yaptıktan sonra `schedule:changed` event'i dispatch edilmiyor.  
DutyRowsEditor grid'i güncellemiyor — atama yapılmış görünse de çizelgede aynı kalıyor.  
**Düzeltilecek:** `onAssigned` callback'ten `window.dispatchEvent(new CustomEvent('schedule:changed'))` atılacak; DutyRowsEditor bu eventi dinleyecek.

---

### BUG-13 — DutyRule localStorage → backend sync belirsiz
**Dosya:** `src/tabs/DutyRulesTab.Explained.jsx`  
**Sorun:** Kurallar önce localStorage'a kaydediliyor, backend sync ayrı bir "kaydet" butonuyla oluyor.  
Kullanıcı kaydetmeyi unutursa localStorage ve DB arasında tutarsızlık oluşuyor.  
**Düzeltilecek:** Kural değiştiğinde debounce ile otomatik backend sync; ya da kalıcı "kaydedilmemiş değişiklik" uyarısı.

---

## 2. Geliştirme Öncelik Sırası

### Aşama 0 — Veri Bütünlüğü (Şimdi) ✅ Başlandı
> Bunlar olmadan çizelge ve takas sistemi güvenilir değil.

| # | Görev | Dosya | Durum |
|---|-------|-------|-------|
| 0.1 | BUG-01: ruleResolver array→object fix | `scheduler/ruleResolver.js` | ✅ Tamamlandı |
| 0.2 | BUG-02: LeaveBalance DB'den çek | `schedulerService.js` | 🔴 Bekliyor |
| 0.3 | BUG-03: LeaveBalance.allocated set akışı | `requests.routes.js` | 🔴 Bekliyor |

---

### Aşama 1 — Takas Doğruluğu
> Nöbet takas işlemlerinin kural ihlali olmadan çalışması.

| # | Görev | Dosya | Durum |
|---|-------|-------|-------|
| 1.1 | BUG-04: executeSwap → validateSwap() | `requests.routes.js` | 🔴 Bekliyor |
| 1.2 | BUG-05: /assign → namedAssignments güncelle | `schedules.routes.js` | 🔴 Bekliyor |
| 1.3 | BUG-06: findNameFallback boş string | `requests.routes.js` | 🔴 Bekliyor |
| 1.4 | BUG-07: swapSuggestion Setting.find daralt | `swapSuggestionService.js` | 🔴 Bekliyor |

---

### Aşama 2 — UI Senkronizasyonu
> Çizelge, takvim ve raporlar değişiklikten haberdar olmalı.

| # | Görev | Dosya | Durum |
|---|-------|-------|-------|
| 2.1 | BUG-12: QuickReplacePanel → schedule:changed event | `QuickReplacePanel.jsx`, `SchedulesTab.jsx` | 🔴 Bekliyor |
| 2.2 | BUG-10: onAssigned race condition | `PersonScheduleCalendar.jsx` | 🔴 Bekliyor |
| 2.3 | BUG-11: Processing guard iyileştir | `RequestsManagementTab.jsx` | 🔴 Bekliyor |
| 2.4 | BUG-13: DutyRules otomatik sync veya uyarı | `DutyRulesTab.Explained.jsx` | 🔴 Bekliyor |

---

### Aşama 3 — Engine Güçlendirme
> Scheduler daha fazla kural ve gerçek veri kullanacak.

| # | Görev | Dosya | Durum |
|---|-------|-------|-------|
| 3.1 | BUG-08: RuleEngine default-doc ile ayağa kaldır | `engine.js`, `constraints.js` | 🔴 Bekliyor |
| 3.2 | BUG-09: isNightShiftDef eşiği 18 → 22 | `swapSuggestionService.js` | 🔴 Bekliyor |
| 3.3 | DutyRowsEditor hücre tıklama → QuickReplacePanel | `DutyRowsEditor.jsx`, `SchedulesTab.jsx` | 🔴 Bekliyor |

---

### Aşama 4 — Test Kapsamı
> Mevcut boşlukların kapatılması.

| # | Görev | Durum |
|---|-------|-------|
| 4.1 | executeSwap unit testleri | 🔴 Bekliyor |
| 4.2 | validateAssignment entegrasyon testleri | 🔴 Bekliyor |
| 4.3 | LeaveBalance akış testleri | 🔴 Bekliyor |
| 4.4 | /assign endpoint e2e testi | 🔴 Bekliyor |
| 4.5 | Frontend: DutyRowsEditor component testi | 🔴 Bekliyor |

---

## 3. Geliştirme Yol Haritası (Modül Bazlı)

### Modül A: Nöbet Scheduler Engine
**Mevcut:** Çalışıyor, temel kurallar uygulanıyor.  
**Eksik:**
- DutyRule.basicRules'tan gerçek rule merge (BUG-01 ✅ düzeltildi)
- LeaveBalance DB entegrasyonu (BUG-02)
- RuleEngine default-doc fallback (BUG-08)
- maxWeeklyHours kuralı henüz DEFAULT_RULES'a bağlanmadı

**Uzun vadeli hedef:** Engine, tüm aktif DutyRule kurallarını (basicRules, leaveRules, shiftRules) uygulayan tek source-of-truth haline gelmeli.

---

### Modül B: Nöbet Takas Sistemi
**Mevcut:** Peer-approval flow çalışıyor, CAS koruması var.  
**Eksik:**
- Takas sırasında kural kontrolü yok (BUG-04)
- Takas sonrası namedAssignments güncellenmiyor (BUG-05, -06)
- Öneri servisi yanlış leave verisi kullanıyor (BUG-07)

**Uzun vadeli hedef:** Takas onayı; önce validateSwap → kural analizi → admin override seçeneği akışını izlemeli.

---

### Modül C: İzin Yönetimi
**Mevcut:** İzin talebi + onay akışı çalışıyor.  
**Eksik:**
- `allocated` güncellenmiyor → bakiye hesabı bozuk (BUG-03)
- LeaveBalance scheduler'a geçmiyor (BUG-02)
- Google Takvim senkronizasyonu var ama test edilmemiş

**Uzun vadeli hedef:** İzin günleri `allocated` ile yönetilmeli, bakiye raporunda doğru görünmeli, izinli günler scheduler'ı otomatik engelleme.

---

### Modül D: UI/UX ve Senkronizasyon
**Mevcut:** DutyRowsEditor çalışıyor, PlanTab sync eklendi.  
**Eksik:**
- QuickReplacePanel atama sonrası grid güncellemiyor (BUG-12)
- DutyRulesTab localStorage/backend tutarsızlığı (BUG-13)
- DutyRowsEditor hücre tıklama → QuickReplacePanel açmıyor (Aşama 3.3)

**Uzun vadeli hedef:** Tüm veri değişikliği kaynakları (PlanTab, QuickReplacePanel, takas onayı) `schedule:changed` event dispatch etmeli; tüm görünümler bu event'i dinleyerek yenilemeli.

---

### Modül E: Raporlama
**Mevcut:** Adalet raporu, mesai özeti, doluluk raporu var.  
**Eksik:**
- LeaveBalance hesabı bozuk olduğu için izin raporları güvenilmez (BUG-03 bağımlı)
- Fairness score scheduler'dan ayrı hesaplanıyor — tutarsızlık riski
- Occupancy raporu servis bazlı değil, genel

**Uzun vadeli hedef:** Tüm raporlar Assignment koleksiyonunu SSOT olarak kullanmalı.

---

## 4. Teknik Borç

| Alan | Sorun | Etki |
|------|-------|------|
| DutyRowsEditor.jsx | Çok büyük bileşen (~1300 satır), utility dosyasına taşınan kısımlar var | Bakım zorluğu |
| MonthlyHoursSheet.jsx | 51KB, tüm veriyi tek seferde render ediyor | Performans riski |
| MonthlySchedule.data | Mixed type schema, 16MB BSON limit | Veri taşması riski |
| Test kapsamı | Integration ve E2E testler yok | Regresyon riski |
| DutyRule ↔ ScheduleRules | İki paralel kural sistemi | Kavramsal karmaşa |
| localStorage ↔ backend | DutyRulesTab sync belirsiz | Sessiz veri kaybı |

---

## 5. Tamamlanan İşler (v1.2.0)

- [x] Nöbet takas sistemi (peer-approval flow)
- [x] PlanTab → SchedulesTab senkronizasyonu (`schedule:saved` event + `reloadKey`)
- [x] schedulerService → `namedAssignments` writeback
- [x] notifications auth middleware fix
- [x] RequestsManagementTab çift tıklama koruması
- [x] TC kimlik verisi git takibinden çıkarıldı (KVKK)
- [x] LeaveBalance, Planning, PlanningTask modelleri
- [x] Google Takvim senkronizasyon altyapısı
- [x] AnnouncementModal, NotificationBell, PersonProfileModal bileşenleri
- [x] LeaveStatsPage, OccupancyReportPage, WorkingHoursSummaryPage sayfaları
- [x] BUG-01: ruleResolver.js array→object fix

---

## 6. Sonraki Commit Hedefi

```
fix: Aşama 0 tamamlama — LeaveBalance DB entegrasyonu + allocated akışı

- schedulerService: onaylı izin taleplerini DB'den çekip leavesByPerson oluştur
- requests.routes: izin tipi tanımından allocated gün sayısı ata
- requests.routes: findNameFallback boş string hatasını kaldır
```
