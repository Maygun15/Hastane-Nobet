# Sistem Testi — Yönetici Gözüyle Tam Tur (17 Kasım 2026)

**Ortam:** Deneme sitesi (`nobet-staging.onrender.com`, canlı verinin 16 Kasım kopyası).
Personel görünümü, yerel deneme kopyasında `personel@prova.test` hesabıyla denendi.

**Yöntem:**
- Yönetici hesabıyla 15 menünün ve alt sekmelerinin hepsi açıldı. Masaüstü ve telefon boyutunda bakıldı.
- Ekran hataları ve başarısız sunucu çağrıları kaydedildi.
- Veri kalitesi veritabanından salt-okur sayıldı.
- Kural listesi motor koduyla karşılaştırıldı.

**Canlıya dokunulmadı.**

**Bu oturumda zaten düzeltilenler** (bu raporda tekrar sayılmadı):
- Boş ayda isim kopyalanması
- Hastanesiz eski kayıtlar
- İzin onayı bakiye hatası
- Şablon taşıma

---

## Özet

| Öncelik | Adet | Anlamı |
|---|---|---|
| 🔴 Kritik | 6 | Pilot (Aralık) öncesi çözülmeli ya da bilinçli kabul edilmeli |
| 🟠 Önemli | 9 | Pilot sırasında kafa karıştırır / yanlış karara yol açabilir |
| 🟡 İyileştirme | 9 | Kullanım kolaylığı, temizlik |

Çalışan ana akış:
- Giriş
- Çizelge üretme → risk kararı → yayınlama
- Personelin yayınlanmış ayı görmesi
- Talep listeleme ve onay
- Adillik raporu
- Aylık mesai ve fazla mesai tabloları
- Toplu izin listesi

Ekranlarda JavaScript hatası ya da başarısız sunucu çağrısı **görülmedi**.

---

## 🔴 Kritik

### K1. Kural ekranındaki kuralların çoğu motor tarafından uygulanmıyor
- "Nöbet Kuralları" ekranında **70 kural** var, 33'ü "Katı" işaretli.
- Sunucudaki çizelge motoru bunların yalnızca **7'sini** adıyla tanıyor:
  - Günde tek vardiya
  - Gece sonrası izin
  - 11/12 saat dinlenme
  - Ardışık en fazla 6 gün
  - Haftalık vardiya sınırı
  - Kişi başı görev sınırı
- Ekranda "aktif/katı" görünüp motorda adı geçmeyenlere örnekler:
  - Hamileye gece yok (`PREGNANT_NO_NIGHTS`)
  - Resüsitasyonda en az 2 kişi (`RESUS_MIN_TWO`)
  - Bayram eşitliği (`HOLIDAY_EQUAL`)
  - Haftada en az 1 gün izin (`WEEKLY_MIN_1_OFF`)
  - İzin isteklerine uyma (`TRY_RESPECT_OFF_REQUESTS`)
- Bir kısmı başka yoldan sağlanıyor olabilir: görev satırındaki kişi sayısı, alan yetkinliği.
- **Risk:** Yönetici "bu kural var" sanıp kontrol etmeyebilir.
- **Öneri:** Kural kural "uygulanıyor / uygulanmıyor / başka yoldan" tablosu çıkarılmalı. Uygulanmayanlar ekranda "yalnızca bilgi" olarak işaretlenmeli ya da gizlenmeli. Acil için olmazsa olmaz 5–6 kural belirlenip motorda test edilmeli.

### K2. İzin türü ve izin hakkı ayarları yanlış
- **20 izin türünün hepsi** "bakiyeden düşülür" işaretli: Rapor, Doğum izni, Görevli, Eğitim, Refakat dahil.
- **58 personelin hiçbirinde** yıllık izin hakkı girili değil.
- Sonuç: rapor onaylansa bile "izin bakiyesinden" düşülüyor. Bakiye her zaman "hak 0, kalan 0" görünüyor.
- **Öneri:** Pilot öncesi sadece **Yıllık izin** (ve varsa mazeret) düşülsün. Personelin yıllık hakları Excel ile toplu girilsin.

### K3. Aylık saat normu tutmuyor
- Aralık 2026 aylık standardı **184 saat** (23 iş günü × 8).
- Üretilen çizelgede personelin çoğu **152–176 saatte** kalıyor. Ortalama 170,8 saat; toplam fazla mesai sadece 64 saat.
- Personel kendi ekranında "Normun altında 16 sa" uyarısı görüyor.
- **Risk:** Personel "eksik çalıştırılıyorum / fazla mesai kesiliyor" algısı yaşar. Hesap doğruysa bordro etkisi olur.
- **Öneri:** Acil sorumlusuyla norm teyit edilmeli: 184 mü, nöbet sisteminde farklı mı? Motor hedefi "aylık zorunlu saat ± tolerans" olacak şekilde ayarlanmalı.

### K4. KVKK — deneme ortamında gerçek kişisel veri var
- Deneme veritabanı canlının kopyası:
  - 57 kişide gerçek **TC**
  - Kullanıcılar ekranında **maskesiz telefon** ve e-posta
- Bu veri ücretsiz Render + Atlas M0 (Frankfurt) üzerinde. Atlas erişimi `0.0.0.0/0`.
- Kabul testinde başka kişiler de bu siteye girecek.
- **Öneri:** Kabul testinden önce deneme verisindeki TC/telefon/e-postayı sahte değerlerle değiştiren bir "anonimleştirme" adımı. Telefon ve e-posta da TC gibi maskelenmeli.

### K5. Fazladan / eski yönetici ve hesaplar
- 117 hesap var: 58'i personele bağlı, 4 yönetici, **55 "staff" hesabı hiçbir personele bağlı değil**. Kullanıcılar ekranı 62 hesap gösteriyor; bu 55'i göstermiyor.
- Yöneticiler arasında `admin@admin.com`, "Dev Admin" (pending) ve `melih@local.com` var. Canlıda da aynı hesaplar olmalı.
- Personele hesap açılırken **ilk şifre TC numarası** oluyor. TC kolay bulunabilen bir bilgi.
- **Öneri:**
  - Canlıya geçişte gereksiz yönetici hesapları askıya alınmalı.
  - 55 bağsız hesap incelenip temizlenmeli.
  - İlk şifre rastgele, tek kullanımlık olmalı (SMS/e-posta ile ya da yöneticinin çıktı alıp elden vermesi).

### K6. Personelin iletişim bilgisi yok
- 58 kişiden yalnızca **1'inde** telefon ve e-posta var.
- Yayın bildirimi, şifre sıfırlama ve "Şifremi unuttum" bu kişilere ulaşamaz.
- **Öneri:** Kabul testi öncesi iletişim bilgisi toplanmalı (KVKK onayıyla) ya da şifre sıfırlama yöneticiden yapılacak diye süreç yazılmalı.

---

## Kritik maddeler için üretilen çözümler (17 Kas, ikinci tur)

Hepsi **deneme ortamında doğrulanmak üzere** hazır. Taşıma betikleri varsayılan olarak yalnızca rapor verir; `--apply` ile uygulanır. Canlıda her biri kuru çalıştırma → birlikte inceleme → açık onay sırasıyla yapılacak.

| # | Çözüm | Dosya |
|---|---|---|
| K1 | Her kural kartına rozet: **Motor uygular** (11) / **Şablon-alan ile** (12) / **Yaklaşık-denge** (7) / **Bilgi — motor kontrol etmez** (40). Envanter belgesi ve Acil için motora eklenecek öncelikli kurallar listesi | `src/rules/ruleEnforcement.js`, `docs/KURAL_ENVANTERI.md`, `test/ruleEnforcement.test.js` |
| K2 | **Kök neden:** izin türlerinin hastane kimliği metin olarak kayıtlı → onayda tür hiç bulunamıyor, her izin "Y" koduyla bakiyeden düşüyordu. Ayrıca düşülür alanı boş. **Çözüm:** (1) tip düzeltmesi; (2) yalnızca açıkça "düşülür" işaretli tür düşer, yeni türlerde varsayılan "düşülmez"; (3) Yıllık izin = düşülür, 20 gün; diğer 19 tür düşülmez; eski bakiyeler türe bağlanır, hak güncellenir | `scripts/backfillLegacyHospitalId.js` (bölüm 2), `scripts/fixLeaveTypes.js`, `services/requestService.js`, `models/LeaveType.js` |
| K3 | **Kök neden bulundu:** Aralık şablonundaki toplam iş 9.904 saat; 58 kişi × 184 saat = 10.672 saat. Yani iş ihtiyacı normdan **768 saat (~32 adet 24 saatlik nöbet) az**. Motor olmayan nöbeti dağıtamaz. Bu bir **kadro/politika kararı** (aşağıda) | — |
| K4 | Deneme verisi anonimleştirme: personel ve personel hesaplarında sahte TC (99…), telefon/e-posta boş veya `personelNN@deneme.test`. Yönetici hesaplarına ve isimlere dokunmaz. Canlıyı görürse çalışmaz. Ekranda telefon ve e-posta artık maskeli | `scripts/anonymizeStaging.js`, `src/tabs/UsersTab.jsx`, `src/tabs/PeopleTab.jsx`, `src/components/IDCard.jsx` |
| K5 | (1) **Hata bulundu:** hesap açılırken sunucu rastgele şifre üretiyor ama kimseye göstermiyordu; personel giriş yapamıyordu. Ekrandaki "ilk şifre TC" yazısı da yanlıştı. Artık geçici şifre bir kez gösterilir (tekli: pencere; toplu: indirilen liste). (2) Hesap denetim betiği: yöneticileri ve 55 bağsız hesabı listeler, istenirse **askıya alır, silmez**. 55 hesabın hiçbirinde TC/e-posta yok, zaten giriş yapamıyorlar | `routes/users.routes.js`, `PeopleTab.jsx`, `UsersTab.jsx`, `scripts/auditAccounts.js` |
| K6 | Karar notu (aşağıda) | — |

### K3 karar notu — Acil sorumlusuyla konuşulacak
Seçenekler:
- **A. Norm altını devret:** Aylık mesai çizelgesindeki "gelecek aya devir" sütunu kullanılır. Eksik saat sonraki aylarda tamamlanır. Kod değişikliği gerekmez.
- **B. Gündüz mesaisiyle tamamla:** Normun altında kalan personele hafta içi M (08–16) görevi eklenir. Gerekirse şablona "norm tamamlama" satırı eklenir; motor bunları en çok açığı olana verir. Küçük geliştirme gerekir.
- **C. Normu teyit et:** Acil nöbet sisteminde aylık norm farklı hesaplanıyorsa (ör. nöbet ertesi izin düşümü) "Aylık zorunlu çalışma saati" parametresi ona göre girilir.

Öneri: **C ile teyit + A** (pilot için en az risk). B pilot sonrası.

### K6 karar notu
- İletişim bilgisi KVKK onayıyla toplanır. Kullanıcılar ekranındaki "Excel İçe Aktar" ile toplu girilir.
- Toplanana kadar şifre unutulursa yönetici "Şifre sıfırla" yapar; ekran geçici şifreyi gösterir.
- Yayın duyurusu ilk ay WhatsApp grubu / pano ile yapılır.

### Ek bulgular (bu turda)
- Vardiya tanımlarının (11) hastane kimliği yanlışlıkla bir kullanıcı kimliği. Taşıma betiği düzeltiyor.
- 55 bağsız hesabın hastane kimliği metin tipinde olduğu için Kullanıcılar ekranında görünmüyorlardı. Taşıma sonrası görünecekler, denetim betiğiyle askıya alınabilirler.
- `admin@admin.com`, sunucunun açılışta otomatik oluşturduğu varsayılan yönetici. Canlıda askıya alınması önerilir. Askıya alınınca sunucu onu yeniden açmaz.

---

## 🟠 Önemli

1. **"Planlama çalıştırılamadı" yanıltıcı:** Planlama ekranı, çizelge üretilmiş ve yayınlanmışken kırmızı uyarı gösteriyor. Sebep: 2 boş görev uyarısı var (yönetici kararı da verilmiş). Durum "Plan hazır — 2 uyarı (kararı verildi)" olmalı.
2. **Personel ekranında yanlış yüzde:** "Ayın Özeti — 0% tamamlanmış" yazıyor, ama kişi 184 saatin 168'ini doldurmuş.
3. **Gece nöbeti sayımı:** 08:00–24:00 (V1) vardiyaları da "gece nöbeti" sayılıyor; bir personelin 8 nöbetinin 8'i gece görünüyor. Adillik raporunda "toplam gece 442 / 486". Gece tanımı netleşmeli (örn. 00:00–08:00'i kapsayan vardiyalar).
4. **Adillik raporu çelişkileri:**
   - "Eksik slot 0" yazıyor, ama risk panelinde 2 boş görev var.
   - Gece sütununda "100% / 8 nöbet (0%)" gibi etiketler var.
5. **Personele yönetici mesajı:** Yayınlanmamış ayda personel "Planlama sekmesinden Çizelgeden Doldur çalıştırın" mesajını görüyor. Personel bunu yapamaz. Yalnızca "Bu ay henüz yayınlanmadı" kalmalı.
6. **Talep sayaçları:** Planlama özetinde "Sonuçlanan talepler 6" yazıyor. Sadece onaylananları sayıyor, reddedilen 10 talep sayılmıyor. Genel Bakış'ta bekleyen talepte isim yerine "Bilinmiyor" görünüyor.
7. **Duyuru penceresi takılı kalıyor:** "Duyuru Gönder" açıldıktan sonra başka menüye geçilince form sayfaların altında kalmaya devam ediyor.
8. **İşlem Günlüğü kullanışsız:** Her sayfa açılışı ("GET … İşlem listelendi") kaydediliyor. Yayınlama, onay, silme gibi gerçek işlemler bu kalabalıkta kayboluyor. Sadece değişiklik yapan işlemler, anlaşılır Türkçe açıklamayla tutulmalı.
9. **İki ayrı kural ekranı:** "Nöbet Kuralları" (70 kural) ile "Nöbet Yazma Kuralları" (Bölüm ID / Servis ID kutuları) ayrı ve çakışıyor. Yönetici hangisinin geçerli olduğunu bilemez.

---

## 🟡 İyileştirme

1. **Telefon menüsü:** Menü sağ üstteki "⋮" düğmesinde; bulunması zor. Sol üstte "☰ Menü" olmalı. Ayrıca AI asistan düğmesi telefonda "Çizelgeden Doldur" düğmesinin üstüne biniyor.
2. **Gereksiz / yarım menüler:**
   - "Planlama Yönetimi" boş ve ilgisiz bir "proje planlama" modülü; adı da ana sayfa ile aynı ("Planlama Kontrol Merkezi").
   - "Projection Health" ve "Scheduler Health" İngilizce geliştirici ekranları, ham ID istiyor.
   - "AI Maliyet" "endpoint mevcut değil" diyor.
   - Bunlar hastane yöneticisinden gizlenmeli.
3. **AI özellikleri:**
   - Deneme ortamında AI anahtarı tanımlı değil; AI asistan ve AI Çizelge çalışmaz.
   - Canlıda açılacaksa personel verisinin dış AI sağlayıcısına gitmesi **KVKK açısından ayrıca onay** gerektirir.
   - Pilotta kapalı tutulması önerilir.
4. **"İstek" sekmesi (Parametreler):** Talepler ekranıyla karışıyor. Kaldırılmalı ya da adı değiştirilmeli.
5. **Süpervizör satırı:** V2 süpervizör satırı Aralık'ta hiç dolmuyor (alanında tek kişi var). Kullanılmıyorsa şablondan çıkarılmalı.
6. **Servis listesi:** 54 servis var; personeli olan tek servis Acil. Pilotta seçim listesi sadeleştirilmeli (örn. sadece aktif ve personeli olan servisler).
7. **Adres çubuğu karışıklığı:** Menüler arasında gezerken adres `/personel?sec=…#/cizelgeler/…` gibi karışıyor. Yenileme veya paylaşma sonrası yanlış sayfa açılabilir.
8. **Güvenlik kaydı:** Sunucuda sık "Dev login path reached in production — blocked" uyarısı var; ön yüz geliştirici giriş yolunu çağırıyor. Zararsız ama kaldırılmalı.
9. **Excel / PDF çıktısı:** Bu turda indirme denenmedi; kabul testinde sorumlunun gerçek ihtiyacıyla (resmi form) karşılaştırılmalı.

---

## Geliştirme önerileri (yol haritası)

**Pilot öncesi (20–23 Kasım kabul testine kadar):**
1. İzin türlerini düzelt + yıllık hakları Excel ile yükle (K2).
2. Kural envanteri: Acil için kritik 5–6 kuralı seç, motorda uygulandığını testle göster. Diğerlerini "bilgi" olarak işaretle (K1).
3. Saat normunu Acil sorumlusuyla teyit et, motor hedefini ayarla (K3).
4. Deneme verisini anonimleştir; kabul testini sahte TC/telefonla yap (K4).
5. Gereksiz yönetici hesaplarını askıya al; ilk şifre = TC uygulamasını değiştir (K5).
6. Yanıltıcı mesajları düzelt: "Planlama çalıştırılamadı", personelin gördüğü "Çizelgeden Doldur" yazısı, "0% tamamlanmış" (Önemli 1, 2, 5).

**Pilot sırasında (Aralık):**
- Gece tanımı ve adillik raporu etiketleri (Önemli 3, 4)
- İşlem günlüğünü "gerçek işlemler" günlüğüne çevirme (Önemli 8)
- Personel iletişim bilgisi toplama ve bildirim kanalı (K6)

**Pilot sonrası:**
- Menü sadeleştirme: geliştirici ekranlarını gizleme, tek kural ekranı (İyileştirme 2, 4; Önemli 9)
- AI özellikleri için KVKK değerlendirmesi
- Çoklu servis açılımı (servis listesi, servis bazlı yetki)
- Eski benzersiz indekslerin temizliği (çoklu hastane için şart)

---

## Ekler — sayılar (deneme verisi, salt-okur)

| Ölçüm | Değer |
|---|---|
| Personel | 58 (hepsi hemşire, hepsi Acil) |
| Çalışma alanı / vardiya kodu eksik personel | 0 / 0 |
| TC dolu / telefon dolu / e-posta dolu | 57 / 1 / 1 |
| Yıllık izin hakkı girili | 0 |
| Hesap: personel / yönetici / bağsız staff | 58 / 4 / 55 |
| İzin türü (hepsi bakiyeden düşülür) | 20 |
| Vardiya tanımı | 11 (N ve V2 24 saat, V1 16 saat) |
| Aralık 2026 üretim | 486 atama, kişi başı 7–20 nöbet, ort. 170,8 saat |
| Kural ekranı / motorda adıyla geçen | 70 / 7 |
