# Hastane Nöbet Sistemi — Yol Haritası

Kaynak: "Fikirden çalışan ürüne" 12 aşamalı yol haritası (yazilim_projesi_ana_ve_alt_kalemler_roadmap.pdf).
Her aşamanın bir **çıktısı** var; bu belge o çıktıları tek yerde tutar.
Teknik hata listesi ve modül planı için: [`PROJECT_PLAN.md`](../PROJECT_PLAN.md).

| # | Aşama | Durum |
|---|---|---|
| 01 | Problem ve kullanıcı | ✅ Taslak (2026-11-15) |
| 02 | Gereksinimler ve kapsam | ✅ Taslak (2026-11-15); kalite hedefleri eksik |
| 03 | Proje planı | ✅ Eksik listesi çıkarıldı (2026-11-15) |
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

---

## 03 — Proje planı

**Çıktı: Uygulanabilir çalışma planı**

### Mevcut durum: gereksinim → kod (2026-11-15 incelemesi)

✅ hazır · 🟡 kısmen · ❌ yok

| Gereksinim | Durum | Kodda ne var / ne eksik |
|---|---|---|
| Zorunlu kurallar (günde tek vardiya, izin engeli, gece sonrası dinlenme, 12 saat ara, art arda gün sınırı, rol/servis uygunluğu) | ✅ | Sunucu motoru (`services/scheduler`) bunları sert kural olarak uyguluyor. |
| Onaylı izin çizelgede kesin uygulanır | ✅ | BUG-02 düzeltmesiyle izin onayları motora ulaşıyor. |
| Otomatik çizelge (tek tık) | ✅ | `POST /api/scheduler/generate`; ekrandaki "Oluştur" bunu kullanıyor. 50–100 kişiyle hız denenmedi. |
| Adalet: toplam saat | ✅ | `scoring.js` hourBalance. |
| Adalet: gece sayısı | ✅ | 2026-11-15: motor kişi başı gece hedefi tutuyor (`nightBalance`); geceyi kapsayan 24 saat vardiyalar da sayılır. |
| Adalet: hafta sonu | ✅ | 2026-11-15: Cumartesi + Pazar + tam gün resmi tatil toplamı için kişi başı hedef (`weekendBalance`). |
| Adalet: bayram / yıl boyu dönüşüm | ❌ | Motor bayramda sadece kadroyu değiştiriyor; kimin bayram tuttuğunu hatırlamıyor. |
| Adalet raporu | ✅ | 2026-11-15: gece tanımı motorla ortak (N/NIGHT/V2 + eski G/GECE + 16+ saat); bayramlar veritabanı tatil takviminden. Uyum raporu da aynı gece tanımını kullanıyor. |
| İstek ("bu gün / gece istemiyorum") | ✅ | 2026-11-15: tercih talebinde tür seçilir (çalışmak istemiyorum / gece istemiyorum / çalışmak istiyorum) ve tarih aralığı girilir; motor veritabanından okur. |
| Sorumlu onaylı istek = kesin kural | ✅ | 2026-11-15: onaylı "istemiyorum" tercihi motorda kesin engel; bekleyen tercih kaçınma puanı alır. |
| İstek puanı/hakkı + karşılanamayanın sonraki aya devri | ❌ | Hiç yok. |
| İzin ve takas talebi + onay | ✅ | Talep, onay, kural kontrolü, çift onay koruması (BUG-04, BUG-11) var. |
| Sorumlunun elle düzenlemesi kayda geçer | ✅ | `changeLog` + işlem geçmişi ve geri alma (undo). |
| Elle düzenleme kuralı bozarsa uyarı | ✅ | `/assign` kural ihlalinde 409 döner; "zorla" seçeneği var. Zorla yapılan değişiklikte gerekçe zorunlu değil. |
| Taslak / yayınlandı ayrımı | ✅ | 2026-11-15: yeni ay ve yeniden üretilen çizelge taslak başlar; personel (`user`) taslağı göremez; "Yayınla" ile görünür olur ve sadece o çizelgedeki kişilere bildirim gider. Taslakta yapılan elle değişiklik bildirim göndermez. |
| Bildirimler | 🟡 | Uygulama içi (canlı) + e-posta var. E-posta için SMTP ayarı gerekli. Uygulama kapalıyken telefona anlık bildirim (push) yok. |
| Raporlar | ✅ | Adalet, doluluk, izin istatistik, çalışma saati sayfaları var. |
| Personel telefondan kullanır | 🟡 | Personel menüsü (Takvimim, Taleplerim, Duyurular, Profilim) ve telefona uygun sayfa ayarı var; telefonda ekran ekran denenmedi. |
| Doktor + hemşire birlikte | ✅ | Rol bazlı (`role`) çizelge ve personel bölümleri var. |
| KVKK / hastane onayı | ❌ | Teknik değil; hastaneyle görüşülmeli. |

### Aralık 2026 pilotu için öncelik sırası

Süre ~2 hafta (Aralık çizelgesi Kasım sonunda yayınlanmalı). Önerilen sıra:

**A. Pilot için şart (yayından önce)**

1. ✅ **Taslak / yayınlandı durumu** — personel sadece yayınlanmış çizelgeyi görür; "Yayınla" bildirimi tetikler. *(2026-11-15: `MonthlySchedule.publication`, `POST /api/schedules/publish|unpublish`, `SchedulePublishBar`; eski kayıtlar yayınlanmış sayılır. Ekranda gerçek veriyle denenmedi.)*
2. ✅ **Tercih talepleri motora bağlansın** — "bu gün / gece istemiyorum" desteği; sorumlu onaylı tercih = kesin engel, onaysız tercih = puanla kaçınma. *(2026-11-15: `Request.preferenceKind` (off | noNight | want), `services/preferenceRequestService.js`, motor kuralları `PREFERENCE_OFF` / `PREFERENCE_NO_NIGHT`, kaçınma ağırlığı `preferenceAvoid` = 20; talep formu ve onay ekranı güncellendi. Sadece varsayılan motor (`generateMonthlyPlan`) uyguluyor; `engine: "draft"` modu uygulamıyor. Türü olmayan eski serbest metin tercihleri yok sayılır.)*
3. ✅ **Gece ve hafta sonu dengesi motora eklensin** — kişi başı gece sayısı ve hafta sonu sayısı için hedef/ceza puanı. *(2026-11-15: `services/scheduler/fairnessCounters.js`; ağırlıklar `nightBalance` = 10, `weekendBalance` = 8; tam gün resmi tatil hafta sonu sayılır. Simülasyon, Aralık 2026, 15 kişi: kişiler arası gece farkı 5,7 → 2,1, hafta sonu farkı 1,7 → 1,0; 60 kişi: 7,7 → 2,9 ve 3,4 → 1,2; boş slot yok, çizelge başına ~0,4 sn.)*
4. ✅ **Adalet raporu düzeltmesi** — gece tanımı vardiya saatinden, bayramlar veritabanı tatil takviminden. *(2026-11-15: gece = motorun kodları (N, NIGHT, V2) + eski G/GECE + adında gece/night + 16 saat ve üzeri nöbet; bayram = `listHolidays` tam gün tatilleri (koddaki 2026 sonunda biten liste kaldırıldı). Uyum raporu (`complianceEngine`) da aynı gece tanımını kullanıyor. Not: atama kayıtlarında vardiya saati tutulmadığı için 12 saatlik ve kodu N olmayan bir gece (ör. "G12") yalnızca kod/ad kuralına uyarsa sayılır.)*
5. 🟡 **Acil verisiyle uçtan uca prova** — gerçek vardiya tanımları, 50–100 kişi, Aralık çizelgesini üret → kural ihlali sayısı 0 mı, süre kaç saniye, telefonda personel ekranı.
6. **KVKK görüşmesi** (hastane tarafı) — onaya kadar sadece ad-soyad + nöbet bilgisi.

**B. Pilot başladıktan sonra (Ocak 2027 çizelgesine kadar)**

7. İstek puanı/hakkı ve karşılanamayan isteğin sonraki aya devri.
8. Bayram nöbetlerinin yıl boyu dönüşümlü dağıtımı (geçmiş yılları hatırlama).
9. Telefona anlık bildirim (web push).
10. "Zorla" yapılan elle değişiklikte gerekçe zorunluluğu.

### Acil provası — motor (2026-11-16)

`my-backend-project/scripts/acilProva.js` ile, **veritabanı kullanmadan** gerçek Acil verisiyle Aralık 2026 çizelgesi üretildi ve motordan bağımsız bir denetçiyle kontrol edildi.

```bash
cd my-backend-project
node scripts/acilProva.js --staff ../../HEMŞIRELER.xlsx \
  --template "../../nobet_cizelgesi_hemşireler_2026-03.xlsx" --year 2026 --month 12 --runs 10
```

- **Girdi:** 58 personel (HEMŞIRELER.xlsx), 41 görev satırı (Mart çizelgesinin "Cizelge-Sayı" sayfası; her görevin haftanın günlerine göre kişi sayısı Aralık'a uygulandı) → **488 slot, 9.792 saat**, kişi başı ort. 169 saat.
- **Denetlenen kurallar:** günde tek vardiya, çakışma, 12 saat dinlenme, 24 saat nöbetin ertesi günü boş, art arda en fazla 6 gün, haftalık 72 saat (Kurallar m.7), alan uygunluğu, vardiya kodu uygunluğu, hafta sonu M4 yasağı (m.17). Denetçinin bu ihlalleri gerçekten yakaladığı `test/acilProvaAudit.test.js` ile kanıtlandı.

| Ölçüm (10 çalıştırma) | Sonuç |
|---|---|
| Kural ihlali | **0** |
| Çizelge üretim süresi | ~0,26 sn |
| Boş kalan slot | ort. 1,8 / 488 (hepsi "SERVİS SORUMLUSU M") |
| Aylık saat (57 kişi) | 160 – 192 saat |
| Hafta sonu nöbeti | kişi başı 1 – 4 |
| 24 saat nöbet (N/V2 tutabilen 56 kişi) | 2 – 8 |

**Bulgular (veri tarafında, hastaneyle netleşmeli):**

1. **HEMŞIRELER.xlsx 30. satırdaki kişinin "ÇALIŞMA ALANLARI" boş** → sistem bu kişiyi hiçbir göreve yazamıyor (0 saat).
2. **Cerrahi Müdahale yükü:** günde 2 adet 24 saat N (ayda 62) var; bu alanda çalışabilen personelin tek alanı Cerrahi Müdahale ve kodları M/N. Bu kişiler ayda 8 kez 24 saat tutuyor, diğerleri 3–5. Denge için başka personele de bu alan tanımlanmalı.
3. **Servis Sorumlusu M** satırı hafta içi her gün 2 kişi istiyor; uygun kişi sayısı az olduğu için ayda 0–3 slot boş kalıyor.
4. Şablondaki SÜPERVİZÖR V2, KIRMIZI VE SARI GÖREVLENDİRME, AŞI ve TRİAJ V2 satırları Mart'ta hiç kişi istemiyor (0); gerçekte isteniyorsa şablon güncellenmeli.
5. Kurallar m.13–16 (triaj/V1/M4 dağılımı, yeşil alanda hafta içi 3 / hafta sonu 4 V1) şablondaki kişi sayılarına bağlı; bu prova Mart şablonunun sayılarını kullandı.
