# 2026-05-02 Çalışma Notları

Bu doküman, 2 Mayıs 2026 tarihinde `hospital-roster` projesinde yapılan başlıca düzeltmeleri, UI/UX iyileştirmelerini ve veri uyumluluğu çalışmalarını özetler.

## 1. Derleme ve Çalıştırma Düzeltmeleri

### Üretim build hataları
- `src/components/DutyRowsEditor.jsx`
  - Çift tanımlanan `isJusticeModalOpen` state kaldırıldı.
  - `npm run build` kıran hata temizlendi.

### Legacy / uyumsuz dosyalar
- `src/routes.jsx`
  - Eski ve kırık importlar güncel akışla uyumlu hale getirildi.
- `src/pages/Login.jsx`
  - Eski `signIn` akışı güncel `login` API kullanımına taşındı.
- `src/api/auth.routes.js`
  - Frontend tarafında yanlışlıkla import edilirse build bozmayacak uyum katmanına çevrildi.

### Runtime erişim ve hata mesajları
- `src/lib/api.js`
  - `429` için kullanıcı dostu mesaj eklendi:
    - `Çok fazla istek, lütfen daha sonra tekrar deneyin`
  - Ağ / erişim hataları için:
    - `Sunucuya bağlanılamadı`
  - Kör `API ERROR` mesajı yerine backend’den gelen anlamlı hata mesajları gösterilmeye başlandı.
  - `429` sonrası gereksiz tekrar denemeler kesildi.

### Backend login limiter düzeltmesi
- `my-backend-project/routes/auth.routes.js`
  - Başarılı login denemeleri sayaç artırmıyor.
  - Başarılı giriş sonrası limiter sayacı temizleniyor.
  - Rate-limit değerlendirmesi başarısız denemeler üstünden yapılıyor.

## 2. Çalışma Çizelgesi / Fazla Mesai Veri Uyum Çalışması

### Ana problem
`Çalışma Çizelgesi`, `Aylık Çalışma`, `Kişi Planlama` ve `Fazla Mesai` ekranları aynı gerçeği farklı veri katmanlarından okuyordu. Bu da vardiya saatleri ve toplam mesai hesaplarında ayrışma üretiyordu.

### Yapılan düzeltmeler

#### Truth source hizalaması
- `src/tabs/OvertimeTab.jsx`
- `src/store/monthlyScheduleModel.js`
- `src/utils/overtimePlanTruth.js`
- `src/utils/conflictChecker.js`
- `src/tabs/SchedulesTab.jsx`

Yapılanlar:
- Fazla mesai ekranı önce `monthly schedule` truth kaynağını okumaya başladı.
- `generated schedule` sadece fallback olarak bırakıldı.
- Cache yapısı servis kapsamına göre ayrıldı.
- `schedule:saved`, `schedule:built`, `schedule:invalidated` olaylarında ekran kendini yeniden hizalar hale geldi.
- `Liste Oluştur` akışı doğrudan çalışma çizelgesinden veri çekme mantığına yaklaştırıldı.

#### Boş explicit assignment kayıtları
- `src/store/monthlyScheduleModel.js`
  - `data.assignments` içinde boş / zayıf kayıtların, `namedAssignments + defs` tarafından sağlanan daha zengin kayıtları ezmesi engellendi.
  - Merge sırasında daha anlamlı kayıt tercih edilir hale getirildi.

#### Vardiya saat çözümü
- `src/utils/planWorkCalculator.js`
- `src/store/monthlyScheduleModel.js`
- `src/components/MonthlyHoursSheet.jsx`

Yapılanlar:
- Alternatif saat alanları (`start/end`, `from/to`, `startTime/endTime` vb.) desteklendi.
- `V1` vardiyası yanlışlıkla `24 saat` sayılıyordu; bu `16 saat` olacak şekilde düzeltildi.
- Fazla mesai ve aylık çalışma ekranlarının aynı vardiya çözümleyiciyi kullanması sağlandı.

#### Personel bazlı ay özeti
- `src/components/PersonScheduleCalendar.jsx`
- `src/components/MonthStats.jsx`

Yapılanlar:
- `Çalıştığı Toplam`, `Kişinin Gerekeni`, `Eksik/Fazla Mesai` hesapları normalize edilmiş truth veriye bağlandı.
- Kişi planlama ekranı ile aylık çalışma ekranı aynı assignment gerçeğinden beslenir hale getirildi.
- Görev/alan dağılımı da aynı normalizasyon hattına taşındı.

### Testler
- `test/monthlyScheduleModel.test.js`
- `test/planWorkCalculator.test.js`

Eklenen / geçen kritik testler:
- `namedAssignments` çözümü
- scoped backend cache tercihi
- boş explicit assignment’ın truth veriyi ezmemesi
- `V1 -> 16 saat`
- stale explicit hour görmezden gelinip vardiya tanımından yeniden çözümleme

## 3. Planlama Ekranı Düzenlemeleri

### Dashboard / üst seviye iyileştirme
- `src/tabs/PlanTab.jsx`

Yapılanlar:
- Üst bağlam alanı daha anlamlı hale getirildi.
- KPI / özet kartları ve operasyon görünümü eklendi.
- Hızlı aksiyonlar, kapsam bilgisi ve plan durumu daha belirgin hale getirildi.

### Takvim ekranı
- `src/components/PersonScheduleCalendar.jsx`
- `src/components/DayCard.jsx`

Yapılanlar:
- Ay başı/sonu boş alanlar daha düzgün gösterildi.
- Kırmızı kritik noktalar kişi takvimi bağlamında gereksiz olduğu yerlerde kapatıldı.
- Ayın özeti renkleri yumuşatıldı.
- İzin ve tatil tonları yeniden dengelendi.

## 4. Çizelgeler Modülü UI/UX Çalışması

### Üst shell ve bilgi mimarisi
- `src/tabs/SchedulesTab.jsx`

Yapılanlar:
- Düz sekme satırı yerine modül odaklı bir üst shell tasarlandı.
- Çizelge türleri kart benzeri, aktif durumlu seçim alanlarına dönüştürüldü.
- Aktif çizelge için dönem, kapsam ve bağlam alanı netleştirildi.
- Sağ tarafta kapsam/ayar paneli eklendi.

### Fazla Mesai Takip Formu
- `src/tabs/OvertimeTab.jsx`

Yapılanlar:
- Üst bilgi alanı ve veri özetleri yeniden düzenlendi.
- `Çalışma çizelgesinden yenile` gibi paralel aksiyonlar sadeleştirildi.
- Kullanıcı akışı `Liste Oluştur = çalışma çizelgesinden oluştur` mantığına yaklaştırıldı.

## 5. Parametreler / Personel / Kullanıcılar UI Sistemi

### Parametreler
- `src/tabs/ParametersTab.jsx`

Yapılanlar:
- Sol navigasyonlu ayar paneli yapısı kuruldu.
- Açıklama, etki alanı ve sekme organizasyonu iyileştirildi.
- `Servisler` artık `Parametreler` altında çalışacak şekilde taşındı.

### Personel
- `src/tabs/PersonnelTab.jsx`
- `src/components/TopTabsBar.jsx`
- `src/tabs/PeopleTab.jsx`

Yapılanlar:
- Personel alanı daha sistemli bir shell’e taşındı.
- Sol grup paneli daha okunur sidebar yapısına çevrildi.
- Kayıt formu şu bölümlere ayrıldı:
  - Kimlik ve görev bilgisi
  - İletişim bilgileri
  - Çalışma alanları
  - Vardiya uygunluğu
- Form içi kart yükseklikleri ve genişlikleri hizalandı.
- Kayıt listesi ayrı bir ergonomik kart yüzeyine taşındı.

### Kullanıcılar
- `src/tabs/UsersTab.jsx`

Yapılanlar:
- Kullanıcı yönetimi için daha net hero, kontrol alanı ve özet sinyalleri eklendi.
- Kart düzeni ve aksiyon hiyerarşisi güçlendirildi.

## 6. Uygulama Shell / Header Revizyonu

### Genişlik ve tam ekran kullanımı
- `src/app/HospitalRosterApp.jsx`

Yapılanlar:
- Önceki `max-width` sınırları kaldırıldı.
- Header ve main içerik daha fazla yatay alan kullanır hale getirildi.

### Header ergonomisi
- `src/app/HospitalRosterApp.jsx`
- `src/components/BackupButtons.jsx`

Yapılanlar:
- Header üst alanı yeniden gruplanarak daha ergonomik hale getirildi:
  - marka + oturum bilgisi
  - yedekleme araçları
  - kullanıcı kartı
  - daha sakin nav bandı
- `UserBadge` daha kompakt ve dengeli hale getirildi.
- Yedekleme butonları compact modda daha tutarlı görünecek şekilde ayarlandı.

## 7. Doğrulama

Gün içindeki ana müdahaleler sonrası tekrar tekrar doğrulanan komutlar:

```bash
npm test -- --runInBand
npm run build
```

Genel sonuç:
- testler geçti
- production build geçti

Not:
- Build sırasında büyük bundle uyarısı sürüyor.
- Bu bir runtime kırığı değil, ayrı bir performans/ayrıştırma işi olarak ele alınmalı.

## 8. Açık Kalan / Sonraki Aday İşler

1. Header navigasyon butonlarını bir seviye daha sıkıştırmak.
2. Personel kayıt ekranında tablo/kart hibrit görünüm düşünmek.
3. Çizelgeler modülü alt ekranlarında ortak table/action dili kurmak.
4. Büyük bundle uyarısı için code-splitting yapmak.
5. Backend single source of truth kararını kalan localStorage akışlarından tamamen ayırmak.

