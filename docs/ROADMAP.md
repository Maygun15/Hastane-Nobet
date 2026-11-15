# Hastane Nöbet Sistemi — Yol Haritası

Kaynak: "Fikirden çalışan ürüne" 12 aşamalı yol haritası (yazilim_projesi_ana_ve_alt_kalemler_roadmap.pdf).
Her aşamanın bir **çıktısı** var; bu belge o çıktıları tek yerde tutar.
Teknik hata listesi ve modül planı için: [`PROJECT_PLAN.md`](../PROJECT_PLAN.md).

| # | Aşama | Durum |
|---|---|---|
| 01 | Problem ve kullanıcı | ✅ Taslak (2026-11-15) |
| 02 | Gereksinimler ve kapsam | ✅ Taslak (2026-11-15); kalite hedefleri eksik |
| 03 | Proje planı | ⏳ |
| 04–05 | UX / UI | Kısmen var (25 sekme), sistemli kontrol yok |
| 06 | Mimari | Var; tek sayfalık şema ve API sözleşmesi yok |
| 07 | Veritabanı | Var (26 model) |
| 08 | Backend ve API | Var; PROJECT_PLAN BUG-01…13 kapandı (2026-11-15) |
| 09 | Frontend | Var; büyük bileşenler bölünmeli |
| 10 | Test ve kalite | Backend 325, frontend 42 test; E2E yok |
| 11 | Yayınlama | CI/CD var; yedek/geri dönüş prosedürü yok |
| 12 | Bakım | Sentry var; geri bildirim kanalı yok |

---

## 01 — Problem ve kullanıcı

**Çıktı: Problem tanımı**

### Amaç

İnsan faktörünü mümkün olduğunca ortadan kaldıran, **adil** ve personel **isteklerinin işlenebildiği**, tamamen **online** bir nöbet sistemi kurmak.

### Kullanıcılar

| Kullanıcı | Sistemde ne yapar |
|---|---|
| Nöbet planlayan sorumlu | Çizelgeyi üretir/düzenler, talepleri onaylar |
| Hemşireler / personel | Kendi nöbetini görür, izin ve takas talebi gönderir |
| Doktorlar | Doktor nöbetleri de aynı sistemle planlanır |
| Hastane yönetimi | Raporları, adaleti ve doluluğu izler |

### Çözülecek sorunlar (hepsi öncelikli)

1. Aylık çizelgeyi elle hazırlamak çok zaman alıyor.
2. Gece, hafta sonu ve bayram nöbetleri adil dağılmıyor; şikayet geliyor.
3. Dinlenme, art arda nöbet gibi kurallar gözden kaçıyor.
4. İzin ve takas talepleri kâğıtta / mesajlaşmada kayboluyor.

### Başarı ölçütleri

- Personel sisteme **tamamen online** ulaşır (dijital çağ gerekliliği).
- Personel nöbetini ve taleplerini **telefondan** yönetir.
- Aylık çizelge saatler yerine **dakikalar** içinde hazır olur.
- Yayınlanan çizelgede **sıfır kural ihlali** olur.
- Dağılımla ilgili **şikayetler azalır**.

### İlk sürümün yeri (pilot)

**Tek servis — Acil Servis.** Önce orada denenir, sorunlar çözülür, sonra diğer servislere yayılır.
İlgili kaynaklar: `kurallar/Acil Servis Nöbet Planlama Kuralları.docx`, `kurallar/Acil_Servis_Nobet_Kurallari.docx`.

---

## 02 — Gereksinimler ve kapsam

**Çıktı: Gereksinim ve özellik listesi** *(devam ediyor)*

### Pilot servisin özellikleri

- **Ekip büyüklüğü:** Acil Serviste nöbet listesine giren 50–100 kişi (hemşire + doktor).
  Algoritma ve ekranlar bu ölçekte hızlı ve okunabilir çalışmalı.
- **Vardiya düzeni:** Sabit kodlanmaz; sistemdeki vardiya tanımlarından gelir
  (Parametreler → Çalışma saatleri / vardiya satırları). Pilotta Acil'in kendi tanımları kullanılır.

### İş kuralları (karar verilenler)

**İstekler — puanlı + sorumlu onaylı hibrit:**
- Personel istek girer ("bu gün çalışmak istemiyorum", "gece istemiyorum" gibi).
- Her personelin aylık sınırlı istek puanı/hakkı vardır; sistem istekleri bu önceliğe göre karşılamaya çalışır.
- Sorumlu onayladığı istek **kesin kural** olur (izin gibi); onaysız istek **tercih** olarak puanla değerlendirilir.
- Karşılanamayan istek bir sonraki ay öne alınır (adalet dengesi).

**Çizelge yayını — sistem önerir, sorumlu düzenler:**
- Sistem kurallara uygun bir taslak çizelge üretir.
- Sorumlu elle düzenleme yapabilir; her elle değişiklik **kayıt altına alınır** (kim, ne zaman, neyi değiştirdi).
- Elle değişiklik bir kuralı bozuyorsa sistem uyarır; zorla yapılırsa gerekçesi kaydedilir.
- Sorumlu kontrol edip yayınlar; yayın sonrası personele bildirim gider.

**Adalet ölçüsü — sistem bu dört sayıyı kişiler arasında eşitlemeye çalışır:**
1. Gece nöbeti sayısı
2. Hafta sonu nöbeti sayısı
3. Bayram / resmi tatil nöbeti (yıl boyunca dönüşümlü)
4. Toplam aylık çalışma saati

Raporlarda her kişi için bu dört sayı ve servis ortalamasından sapması görünür.

### İlk sürümün kapsamı (Acil pilotu)

Hepsi ilk sürümde zorunlu:

| Özellik | Kabul kriteri (taslak) |
|---|---|
| Otomatik çizelge üretimi | 50–100 kişilik Acil için aylık taslak tek tıkla üretilir; hiçbir zorunlu kural ihlali içermez |
| İzin, istek ve takas | Personel telefondan talep girer; sorumlu onaylar/reddeder; onaylı izin çizelgede kesin uygulanır |
| Bildirimler | Çizelge yayını, talep onayı/reddi ve nöbet değişikliğinde ilgili kişiye bildirim gider |
| Raporlar | Kişi bazında gece, hafta sonu, bayram ve saat dağılımı; izin bakiyeleri |

### Takvim

- **Pilot:** Acil Servisin **Aralık 2026** çizelgesi (çizelgenin Kasım sonunda hazır olması gerekir; yaklaşık 2 hafta).

### Riskler ve açık konular

- ⚠️ **KVKK / hastane bilgi işlem onayı henüz konuşulmadı.** Gerçek personel verisi (TC, telefon) sisteme girmeden önce hastanenin KVKK ve bilgi işlem birimiyle görüşülmeli. Onay gelene kadar pilot yalnızca ad-soyad ve nöbet bilgisiyle yürütülebilir.
- ⚠️ **Süre kısa.** 2 haftada dört özelliğin Acil'in gerçek verisiyle uçtan uca denenmesi gerekiyor; ekranda (tarayıcıda) uçtan uca test henüz yok.
- Hız, erişilebilirlik, güvenlik gibi kalite hedefleri henüz yazılmadı.
