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
- [ ] **Canlı veritabanı yedeği:** Atlas → Cluster → Backup → anlık yedek (on-demand snapshot). Yedeğin tarihini buraya not et.
- [ ] Railway'de **canlı ortam değişkenleri** listesi (değerler değil, adlar): `NOTIFICATIONS_ENABLED`, `SENTRY_DSN`, `FRONTEND_ORIGIN`, `CORS_ORIGINS` vb.
- [ ] **KVKK / hastane bilgi işlem** görüşmesi için tarih. Onay gelene kadar: personelde sadece ad-soyad + nöbet bilgisi; TC, telefon, e-posta girilmez.
- [ ] HEMŞIRELER.xlsx düzeltmesi: **30. satır (çalışma alanı boş)**. (Düzeltilmezse sistem "Personel verisi eksik" diye uyarır, yönetici "Bu şekilde devam" diyebilir.)
- [ ] Acil'de **Servis Sorumlusu M** için yeterli kişi var mı? Provada 3 gün boş kaldı; servis sorumlusu yetkisi olan kişi sayısı artırılabilir mi?

## B. Deneme ortamı — canlı verinin kopyası (18–19 Kasım)

Amaç: yeni sürümü **gerçek canlı verinin kopyasında** çalıştırıp indeks / veri sorunlarını canlıdan önce görmek.

1. Atlas'ta A'daki yedekten **ayrı bir veritabanına geri yükleme** (ör. `hastane_staging`) — canlı veritabanı etkilenmez.
2. Railway'de **ikinci servis** (staging) bu dalla, `MONGODB_URI` → staging veritabanı, `NOTIFICATIONS_ENABLED=false`, `SENTRY_DSN` boş.
3. Vercel **preview** deploy'u bu dalla, `VITE_API_BASE` → staging sunucu.
4. Taşımalar:
   - `MONGODB_URI=<staging> node scripts/migratePersonTcIndex.js` (kuru) → çıktıyı incele → `--apply`
   - Sunucu açılışındaki indeks hata kayıtlarını (`E11000`, `IndexOptionsConflict`) tara; çıkan her çakışma için ayrı taşıma yazılır.
5. **Duman testi (staging):**
   - [ ] Yönetici ve personel girişi
   - [ ] Mevcut aylar personelde **görünmeye devam ediyor** (eski kayıtlar "yayınlanmış" sayılır)
   - [ ] Mevcut izin / takas talepleri listeleniyor, onay çalışıyor
   - [ ] Yeni ay oluşturunca **taslak** başlıyor, personel görmüyor
   - [ ] Acil için Aralık çizelgesi üretiliyor; risk paneli çıkıyor; Yayınla → personel görüyor
   - [ ] Adalet raporu: gece (N/V1/V2) ve bayram sayıları mantıklı
6. Acil verisinin staging'e yüklenmesi (58 kişi + görev şablonu) — canlıda nasıl yapılacaksa öyle (Excel'den yükle / personel ekranı).

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
4. [ ] B'de bulunan diğer taşımalar (varsa) aynı şekilde.
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
