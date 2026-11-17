# Acil Pilotu — Canlıya Alma Planı (Aralık 2026)

Yol haritası **11 — Yayınlama** aşamasının çıktısı. Hedef: Acil Servisin **Aralık 2026** çizelgesi yeni sistemle üretilip **27 Kasım Cuma**ya kadar personele yayınlanmış olsun.

Hazırlayan: 2026-11-16 · Dal: `vercel-preview-stabilizasyon` (`b026c9e`)

---

## Durum özeti (neden dikkatli gidiyoruz)

| Konu | Durum |
|---|---|
| Otomatik yayın | `.github/workflows/deploy.yml` **sadece `main`** dalına gönderimde çalışır: ön yüz → Vercel (`--prod`), sunucu → Railway |
| `main` dalı | Son kayıt **20 Mart 2026** (`86e768f`). Çalıştığımız dal **116 kayıt ileride**, 319 dosya farklı, 28 model dosyası değişmiş |
| Canlıda hangi sürüm var? | **Bilinmiyor.** `main` mı, yoksa bu daldan elle yüklenmiş bir sürüm mü — Railway / Vercel panelinden bakılmalı |
| Veritabanı | MongoDB Atlas (canlı veri var). Bu çalışmalar boyunca **canlı veritabanına hiç dokunulmadı** |
| Bilinen zorunlu taşıma | Person TC indeksi: `scripts/migratePersonTcIndex.js` (yapılmazsa TC'siz ikinci kişi eklenemez) |
| Olası başka taşımalar | 28 model değişikliği (ör. `Setting`, `hospitalScope`) yeni indeksler getirebilir → **canlı verinin kopyasında** denenmeden bilinemez |

**Sonuç:** 8 aylık birikimi doğrudan canlıya vermek yerine önce canlı verinin **kopyası** üzerinde bir deneme ortamında (staging) çalıştırıp, sorun yoksa canlıya alıyoruz.

---

## Takvim

| Gün | Tarih | İş | Sorumlu | Çıktı |
|---|---|---|---|---|
| 0 | **Pzt 16 – Sal 17 Kas** | A. Hazırlık ve erişimler | Sen (+ ben) | Canlı sürüm tespiti, yedek, KVKK randevusu |
| 1 | **Çar 18 – Per 19 Kas** | B. Deneme ortamı (canlı verinin kopyası) | Ben (+ sen: panel erişimi) | Staging çalışıyor, taşımalar denendi |
| 2 | **Cum 20 – Pzt 23 Kas** | C. Kullanıcı kabul testi (Acil sorumlusu + 2–3 personel) | Sen + Acil | Onay ya da düzeltme listesi |
| 3 | **Sal 24 Kas** | D. Canlıya alma (mesai dışı, ör. 19:00) | Ben + sen | Canlı yeni sürümde, duman testi geçti |
| 4 | **Çar 25 – Cum 27 Kas** | E. Aralık çizelgesi: üret → riskleri karara bağla → yayınla | Acil sorumlusu | **Aralık yayında** |
| — | **Aralık** | F. Pilot izleme | Sen + ben | Haftalık kontrol, Ocak iş listesi |

Tampon: C'de sorun çıkarsa D → **Çar 25**, E → **Cum 27**. Daha fazla kayma olursa Aralık eski yöntemle hazırlanır, pilot **Ocak 2027**ye kayar (aşağıda "Geri dönüş").

---

## A. Hazırlık ve erişimler (16–17 Kasım)

- [ ] **Canlıda hangi sürüm çalışıyor?** Railway → servis → Deployments: son deploy'un commit'i ve dalı. Vercel → Deployments → Production: commit ve dal. (Sen bakıp yazarsın ya da erişim verirsin.)
- [x] **Canlı veritabanı yedeği — ALINDI 16 Kas 2026 14:06** (`mongodump`, salt-okur). Yer: `~/nöbet/.yedek-2026-11-16/dump` (klasör izni 700, repoda değil). 28 koleksiyon, 2336 kayıt, 7,3 MB (gzip). Geçici bir yerel veritabanına geri yüklendi: 0 hata. ~~Eski not:~~ Atlas → Cluster → Backup → anlık yedek (on-demand snapshot). Yedeğin tarihini buraya not et.
- [ ] Railway'de **canlı ortam değişkenleri** listesi (değerler değil, adlar): `NOTIFICATIONS_ENABLED`, `SENTRY_DSN`, `FRONTEND_ORIGIN`, `CORS_ORIGINS` vb.
- [ ] **KVKK / hastane bilgi işlem** görüşmesi için tarih. Onay gelene kadar: personelde sadece ad-soyad + nöbet bilgisi; TC, telefon, e-posta girilmez.
- [ ] HEMŞIRELER.xlsx düzeltmesi: **30. satır (çalışma alanı boş)**. (Düzeltilmezse sistem "Personel verisi eksik" diye uyarır, yönetici "Bu şekilde devam" diyebilir.)
- [ ] Acil'de **Servis Sorumlusu M** için yeterli kişi var mı? Provada 3 gün boş kaldı; servis sorumlusu yetkisi olan kişi sayısı artırılabilir mi?

### A — Bulgular (16 Kasım 2026, dışarıdan salt-okur kontrol)

| Kontrol | Sonuç |
|---|---|
| Canlı ön yüz `hastane-nobet.vercel.app` | Açılıyor (200). **Eski sürüm:** "Yayınla", risk paneli, "Sonraki nöbetiniz" yok |
| Ön yüzün bağlandığı sunucu | `hastane-backend-production-dcf1.up.railway.app` |
| O sunucu | **Cevap vermiyor:** Railway "Application not found" (`x-railway-fallback: true`). Bu adreste çalışan servis yok |
| Diğer eski adres `hastane-backend-production.up.railway.app` | Aynı, çalışan servis yok |
| GitHub deploy kayıtları | Son 4 kayıt bizim dalın **Preview** deploy'ları (15 Kas). Production kaydı yok |

**Anlamı:** Şu an canlı sistemde kimse giriş yapamaz, çünkü sunucu kapalı, silinmiş ya da adresi değişmiş. Canlıda koruyacağımız "çalışan bir sürüm" yok; sadece **Atlas'taki veri** korunmalı.

**Railway paneli (16 Kas, sahibiyle birlikte bakıldı):**
- Hesapta **"Trial Ended / Trial expired"**. Deneme süresi bitmiş, 4 projenin hepsinde 0/1 servis çalışıyor.
- Canlı sunucu `courageous-elegance` projesindeki `hastane-backend` servisi. Kaynak `Maygun15/Hastane-Nobet`, dal `main`, otomatik deploy açık, alan adı `hastane-backend-production-dcf1.up.railway.app`, port 8080.
- Bu servisin durumu "Service offline" ve aktif deploy yok. Son deploy **8 ay önce** (Mart 2026, "Kural 3 STABLE"), kaydı REMOVED.
- Diğer projeler eski ve kullanılmıyor: `respectful-dedication` (eski `hastane-backend` reposu), `gleaming-happiness` ve `helpful-intuition` (alan adı yok).
- **Yapılacak:** Ücretli plana geçmeden ne staging ne canlı açılabilir. En düşük plan Hobby ($5/ay) bu yük için yeterli. Ödeme kararı ve işlemi hesap sahibinde.
- Kullanılmayan 3 proje sonra temizlenebilir. Sadece sahibinin onayıyla.


**Atlas paneli (16 Kas, sahibiyle birlikte bakıldı):**
- Cluster `hastane`: **FREE (M0)**, AWS Frankfurt, MongoDB 8.0.37, 3 düğüm.
- Veri **duruyor**: 255 MB / 512 MB kullanılmış. Son 4 saatte bağlantı yok; Railway kapalı olduğu için beklenen durum.
- **Yedekleme kapalı** ("Backups Inactive"). Ücretsiz planda Atlas anlık yedek (snapshot) almıyor.
- **Bu yüzden yedek `mongodump` ile alınır:** sadece okur, veriyi değiştirmez. Dosya bilgisayarda şifreli bir klasörde saklanır, KVKK gereği paylaşılmaz.
- Not: 512 MB sınırının yarısı dolu. Pilot büyürse ücretli kümeye (M10) ya da Flex'e geçiş gerekebilir.

## B. Deneme ortamı — canlı verinin kopyası (18–19 Kasım)

Amaç: yeni sürümü **gerçek canlı verinin kopyasında** çalıştırıp indeks / veri sorunlarını canlıdan önce görmek.

> **16 Kas kararı:** Deneme ortamı **ücretsiz** kurulur. Railway kararı kabul testinden sonra verilecek.
> - Veritabanı: Atlas'ta **ayrı proje + ücretsiz M0 küme** (`hastane-staging`). Ayrı küme şart, çünkü sunucu veritabanı adını her zaman `hastane` olarak açıyor.
> - Sunucu + site: **Render** ücretsiz plan, `render.yaml` blueprint'i (`nobet-staging-api` + `nobet-staging`). Sunucu 15 dk kullanılmayınca uyur; ilk açılış 30–60 sn sürer.
> - Bağlantı adresi sohbete yazılmaz: yerelde `~/nöbet/.staging-uri` dosyasına konur (izin 600).

1. Atlas'ta A'daki yedekten **ayrı bir veritabanına geri yükleme** (ör. `hastane_staging`) — canlı veritabanı etkilenmez.
2. Railway'de **ikinci servis** (staging) bu dalla, `MONGODB_URI` → staging veritabanı, `NOTIFICATIONS_ENABLED=false`, `SENTRY_DSN` boş.
3. Vercel **preview** deploy'u bu dalla, `VITE_API_BASE` → staging sunucu.
4. Taşımalar:
   - `MONGODB_URI=<staging> node scripts/migratePersonTcIndex.js` (kuru) → çıktıyı incele → `--apply`
   - Sunucu açılışındaki indeks hata kayıtlarını (`E11000`, `IndexOptionsConflict`) tara; çıkan her çakışma için ayrı taşıma yazılır.
5. **Duman testi (staging):**
   - [x] Yönetici ve personel girişi *(personel C'de)*
   - [x] Mevcut aylar personelde **görünmeye devam ediyor** (eski kayıtlar "yayınlanmış" sayılır)
   - [ ] Mevcut izin / takas talepleri listeleniyor, onay çalışıyor
   - [x] Yeni ay oluşturunca **taslak** başlıyor, personel görmüyor
   - [x] Acil için Aralık çizelgesi üretiliyor; risk paneli çıkıyor; Yayınla → personel görüyor
   - [x] Adalet raporu: gece (N/V1/V2) ve bayram sayıları mantıklı
6. Acil verisinin staging'e yüklenmesi (58 kişi + görev şablonu) — canlıda nasıl yapılacaksa öyle (Excel'den yükle / personel ekranı).

**B — Yapılanlar (16 Kas):**
- [x] Atlas `hastane-staging` projesi, ücretsiz `staging` kümesi (Frankfurt). İzinli IP: sadece geliştirici bilgisayarı. Render için `0.0.0.0/0` henüz eklenmedi.
- [x] 16 Kas yedeği deneme kümesine yüklendi: **2336 kayıt, 0 hata**.
- [x] TC taşıması: kuru çalıştırma temiz (boş TC 1 kişi, kopya TC 0) → deneme kümesinde `--apply` başarılı.
- [x] Yeni sürüm (yerelde, `NODE_ENV=production`) deneme verisiyle açıldı: MongoDB bağlı, sağlık OK, hata yok. Kısa `JWT_SECRET` güvenlik kontrolünce reddediliyor (iyi).
- [x] İndeks karşılaştırması (`diffIndexes`, salt-okur): **eksik kritik indeks yok**. Production'da `autoIndex` kapalı olduğu için bu kontrol gerekliydi. Bulgular:
  - `people.tc_1` ve `people.userId_1` mevcut ama `sparse` değil (model `sparse` istiyor). Benzersiz olmadıkları için **zararsız**, düzeltme isteğe bağlı.
  - Birçok koleksiyonda eski tek-alan indeksler "fazla". Zararsız, sadece yazmayı biraz yavaşlatır. Pilottan sonra temizlenebilir.
- [x] Render (17 Kas): `nobet-staging-api` + `nobet-staging` ayakta. `ADMIN_PASSWORD` blueprint'te `generateValue` (sadece ilk admin oluşturmada kullanılır). Atlas'a `0.0.0.0/0` eklendi (sadece deneme kümesi). CORS doğru.
- [x] Deneme ortamı yönetici şifresi yalnızca deneme veritabanında yenilendi (canlı şifre değişmedi).

**B.5 duman testi sonuçları (17 Kas, deneme sitesi):**
- [x] Yönetici girişi. *(Personel girişi C'de gerçek personelle denenecek.)*
- [x] Eski aylar korunmuş: Temmuz 2026 Acil hemşire çizelgesi dolu ve "Yayınlandı". Veride 58 kişi, 17 talep (2 bekleyen).
- [x] Yeni ay **taslak** başlıyor. Boş ay açınca hiçbir şey kendiliğinden kaydedilmiyor.
- [x] Aralık 2026 üretildi: 486 atama / 58 kişi (ort. 8,4). Risk paneli 2 boş görev gösterdi (7 ve 28 Ara, Servis Sorumlusu: iki sorumlu da uygun değil). "Hepsi için bu şekilde devam" kararı yönetici adıyla kaydedildi → **Yayınla** çalıştı.
- [x] Adillik raporu Aralık için açılıyor: genel puan 73 (Orta), gece dengesi 84, hafta sonu 70, eksik slot 0. En çok yük: iki servis sorumlusu (20'şer). Diğerleri 7–10 arası.
- **Bulunan ve düzeltilen hata (82dd6ff):** boş bir aya geçince önceki görüntülenen ayın isimleri o aya kopyalanıp **otomatik kaydediliyordu** (Şubat 2026'dan beri var). Düzeltildi, yerelde ve deneme sitesinde doğrulandı. Hatanın deneme verisine yazdığı Aralık 2026 / Haziran 2027 taslakları silindi.
- **Gözlemler (pilot öncesi karar gerekir):**
  - Şablon taşıma yalnızca **bir önceki aya** bakıyor. Canlıda son dolu ay Temmuz, Kasım boş. Bu yüzden Aralık açılınca "önceki ay şablonu" bulunamaz. Görev satırları, aynı tarayıcıda önce Temmuz açıldıysa ekranda kalıyor. Öneri: taşıma en son şablonu olan aya baksın.
  - Adillik raporunda "Eksik slot 0" görünüyor ama risk panelinde 2 boş görev var. Gece oranı sütununda "100% / 8 nöbet (0%)" gibi çelişkili etiketler var. Rapor dili gözden geçirilmeli.
  - Onay pencereleri (`window.confirm`) yerleşik tarayıcıda otomatik "hayır" sayılıyor. Gerçek tarayıcıda sorun yok.
- Deneme sitesinde Aralık 2026 şu an **yayınlanmış** durumda (test verisi).

**Talep testi (17 Kas) — iki engel bulundu:**
- **Hastanesiz eski kayıtlar:** 17 talepten 13'ü, 6/6 ayar, 3/3 görev kuralı, 1/1 çizelge kuralı ve 7 eski otomatik plan `hospitalId`'siz. Yeni sürüm bunları göremiyordu: ekranda 4 talep vardı, bekleyen 1 takas gizliydi. Ayrıca izin onayı, eski `settings.key_1_serviceId_1` benzersiz indeksine çarpıp geri alınıyordu.
  - Çözüm: `scripts/backfillLegacyHospitalId.js`. Varsayılan kuru çalışır, `.env` okumaz, tek hastane yoksa durur, çakışma varsa koleksiyonu atlar. Tatiller dahil değil: 2026–27 için hastaneli kopyalar var.
  - Deneme: kuru çalıştırma 30 kayıt / 0 çakışma → `--apply` → 30 güncellendi, tekrar kuru çalıştırma 0. Talepler ekranı artık **17/17** gösteriyor.
  - Görev kuralı kayıtlarının içi boş/deneme amaçlı. Görünür olmaları üretimi değiştirmez.
- **İzin onayı kod hatası:** bakiye güncellemesi `used` alanını hem `$setOnInsert` hem `$inc` ile yazıyordu. MongoDB bunu **her seferinde** reddeder, yani düşülen izin türünde hiçbir onay yapılamıyordu. Düzeltildi: `services/requestService.js`. Yerel MongoDB'de eski hali hata verdi, yeni hali 4+2=6 gün doğru saydı. Sunucu testleri 386/386 geçti.
- **Deneme sitesinde doğrulandı (bfe76c3 sonrası):** Gamze Öztürk 1–4 Temmuz izni onaylandı. Bakiye kullanılan 4 gün, izin günleri çizelge verisine "Y" olarak yazıldı. Ayar kaydı güncellendi, kopya oluşmadı (6 ayar).
- **Kabul testinde bakılacak:** izin türlerinde yıllık hak tanımlı değil (hak 0 → kalan 0 görünüyor). Pilot öncesi izin hakları girilmeli ya da bu alan gizlenmeli.
- Not: sunucu kayıtlarında sık "Dev login path reached in production — blocked" uyarısı var. Ön yüz bir yerde geliştirici giriş yolunu çağırıyor. Zararsız (engelleniyor) ama incelenmeli.

**D (canlıya alma) için eklenecek adım:** TC taşımasından sonra `MONGODB_URI=<canlı> node scripts/backfillLegacyHospitalId.js` (kuru) → çıktı birlikte incelenir → açık onayla `--apply`.

**Çıkış kriteri:** duman testinin hepsi geçti, açıklanmamış sunucu hatası yok.

## C. Kullanıcı kabul testi (20–23 Kasım)

Staging adresinde, Acil sorumlusu ve 2–3 personelle:

- [ ] Sorumlu: Aralık'ı üretir, risk panelinde her risk için karar verir ("Yerine ata" / "Bu şekilde devam"), yayınlar.
- [ ] Personel (kendi telefonundan): yayından önce Aralık'ı **göremez**, sonra görür; bildirim gelir.
- [ ] Personel bir **tercih** girer ("gece istemiyorum"), sorumlu onaylar; yeniden üretimde o güne gece yazılmaz.
- [ ] Bir **takas** talebi baştan sona.
- [ ] Geri bildirimler bu dosyanın sonuna "Kabul testi notları" olarak yazılır.

**Karar (Pzt 23 Kas akşamı):** Go / No-go. Kriterler: kural ihlali yok, sorumlu çizelgeyi kullanılabilir buluyor, personel telefondan erişebiliyor, KVKK açısından engel yok.

## D. Canlıya alma (Salı 24 Kasım, mesai dışı)

Sıra önemli:

1. [ ] Kullanıcılara kısa duyuru: "19:00–20:00 arası bakım."
2. [ ] **Taze yedek**: Atlas on-demand snapshot (tarih/saat not edilir).
3. [ ] TC indeksi taşıması (canlı): kuru çalışma → çıktıyı birlikte okuma → **senin onayınla** `--apply`.
4. [ ] **Hastanesiz eski kayıtlar** (B'de bulundu): `scripts/backfillLegacyHospitalId.js` kuru → çıktıyı birlikte okuma → **senin onayınla** `--apply`. Yapılmazsa talepler görünmez ve izin onayı çalışmaz.
5. [ ] `main` ← `vercel-preview-stabilizasyon` birleştirme (hızlı ileri: `main` dalın atası, çakışma yok) ve GitHub'a gönderme → `deploy.yml` Vercel + Railway'i otomatik yayınlar.
6. [ ] **Duman testi (canlı)** — B.5 listesinin aynısı, Acil yerine test edilmeyen bir serviste sadece görüntüleme.
7. [ ] 30 dk sunucu kayıtlarını izleme (hata oranı, `E11000`, 5xx).

## E. Aralık çizelgesi (25–27 Kasım)

- [ ] Acil personeli ve görev şablonu canlıda tam (C'de denenmiş haliyle).
- [ ] Onaylı izinler ve tercihler girilmiş (son gün: **Çar 25 Kas 17:00** — personele duyurulur).
- [ ] Sorumlu Aralık'ı üretir → risk panelindeki her risk için karar → **Yayınla** (en geç **Cum 27 Kas**).
- [ ] Personel takvimini telefonda görüyor (rastgele 3 kişiyle kontrol).

## F. Pilot izleme (Aralık)

- Haftalık 15 dk: boş kalan görevler, zorla atamalar ("Yine de ata"), personel şikayetleri, takas/izin akışı.
- Adalet raporu ay sonunda: gece / hafta sonu / saat farkları.
- Ocak işleri (ROADMAP 03-B): istek puanı ve sonraki aya devir, bayram dönüşümü, telefona anlık bildirim, ekranda "çizelge henüz yayınlanmadı" mesajı.

---

## Geri dönüş (rollback) planı

| Sorun | Yapılacak | Süre |
|---|---|---|
| Ön yüz bozuk | Vercel → önceki production deploy → **Promote / Instant Rollback** | ~1 dk |
| Sunucu bozuk | Railway → önceki deployment → **Redeploy** | ~2–5 dk |
| Veri bozuldu | Atlas snapshot'tan geri yükleme (D.2'deki yedek). Yedekten sonraki girişler kaybolur → bu yüzden mesai dışı | 15–60 dk |
| TC indeksi | Eski indeks gerekirse yeniden kurulabilir; yeni indeks sadece dolu TC'leri kapsar, veri değiştirmez | dk |

Notlar:
- Eski sürüme dönülürse yeni alanlar (`publication`, `riskAcks`, `preferenceKind`) eski sürümce **yok sayılır**; veri bozulmaz. Ama eski sürüm taslak ayrımını bilmediği için **taslak aylar personele görünür hale gelir.**
- Pilot ertelenirse: Aralık eski yöntemle (Excel) hazırlanır, yeni sistemde sadece "gölge" çizelge üretilip karşılaştırılır; pilot Ocak 2027.

---

## Açık riskler

| Risk | Etki | Önlem |
|---|---|---|
| Canlıdaki sürüm `main` değil, bilinmeyen bir sürüm | Birleştirme beklenmeyen değişiklik getirebilir | A'da tespit, B'de canlı kopyasıyla test |
| 28 model değişikliği → başka indeks çakışması | Sunucu açılışında hata / kayıt eklenememe | B.4 kayıt taraması, gerekirse ek taşıma |
| KVKK onayı gecikir | TC/telefon girilemez | Ad-soyad + nöbetle pilot; TC zorunlu değil (düzeltildi) |
| Servis Sorumlusu eksikliği | Ayda birkaç boş gün | Risk paneli uyarır; kadro kararı hastanede |
| Personel "taslak" kavramını bilmiyor | "Çizelgem yok" şikayeti | Duyuru: "Çizelge yayınlanınca bildirim gelecek" |
| Tek kişi bağımlılığı (sorumlu) | Yayın gecikir | İkinci yetkili (authorized) kullanıcı tanımla |

---

## Kabul testi notları

_(C aşamasında doldurulacak)_
