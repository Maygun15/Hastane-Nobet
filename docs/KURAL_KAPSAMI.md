# Kural Kapsamı (koddan üretildi)

Kaynak: `src/tabs/DutyRulesTab.Explained.jsx` kataloğu (70 kural), `src/rules/ruleEnforcement.js`, sunucu motoru ve risk denetçisi. Üretim: `node scripts/kural-kapsami.mjs > docs/KURAL_KAPSAMI.md`.

**Aşamalar:**
- **Motor:** otomatik planlama (`services/scheduler`).
- **Elle atama:** `POST /api/schedules/assign`. Kurum kuralı denetçisi bu atamanın **yeni** doğurduğu ihlali 409 ile durdurur; `force` ile devam edilirse ihlal risk panelinde kalır.
- **Plan kaydı:** `PUT /monthly`. Kural denetlemez; ihlal risk paneline düşer.
- **Risk paneli:** `scheduleRiskService.auditAssignments`, motorla aynı kurum değerleri.
- **Yayın:** kararsız risk varken 409.

**Etkinlik:** "Kurum anahtarı" olan kurallar, **Parametreler → Nöbet Kuralları → Kurum kuralları** panelinde değer verildiğinde etkindir. Değer yoksa uygulanmaz ve yayın 422 ile durur (zorunlu set eksik).

**Kaynak:** kurum değerlerinin dayanağı (mevzuat / kurum kararı) kurum tarafından girilmeli. Deneme ortamında doğrulanmış bir mevzuat dayanağı **yok**.

| Durum | Adet |
|---|---|
| Şablon/alan ile | 12 |
| Bilgi — motor kontrol etmez | 38 |
| Motor uygular | 13 |
| Yaklaşık (denge) | 7 |

## Pilotu etkileyen zorunlu kurallar

| Kural | Durum | Kanıt | Bekleyen |
|---|---|---|---|
| `ONE_SHIFT_PER_DAY` — Bir personele bir günde yalnızca 1 vardiya atanır. | ✅ motor, elle atama, risk paneli ve yayında uygulanıyor | mandatoryRules.test.js (15 tekrar) | kurum değerinin dayanağı |
| `LEAVE_BLOCK_GENERIC` — İzin/rapor kodlu günlere atama yapılmaz; bazıları çalışılmış sayılır. (Bİ, Dİ, E, Eİ, G, U, H, R, RE, S, Sİ, İ, İİ, Üİ, Y vb.) | ✅ motor, elle atama, risk paneli ve yayında uygulanıyor | mandatoryRules, riskAuditExtra, E2E F7, K12 | kurum değerinin dayanağı |
| `NIGHT_NEXT_DAY_OFF` — Gece nöbeti tutan kişi ertesi gün izinlidir. | ✅ motor, elle atama, risk paneli ve yayında uygulanıyor | scheduler.restAfterNight, monthBoundary, E2E K8, K13 | kurum değerinin dayanağı |
| `MIN_REST_11H` — Vardiyalar arasında en az 11 saat dinlenme olmalıdır. | ✅ motor, elle atama, risk paneli ve yayında uygulanıyor | monthBoundary.test.js, E2E K13 | kurum değerinin dayanağı |
| `MAX_CONSECUTIVE_6D` — Maksimum ardışık çalışma 6 gündür. | ✅ motor, elle atama, risk paneli ve yayında uygulanıyor | monthBoundary.test.js (26–31 Ara → 1 Oca) | kurum değerinin dayanağı |
| `WEEKLY_MIN_1_OFF` — Her hafta en az 1 gün kesintisiz tatil olmalıdır. | ✅ motor, elle atama, risk paneli ve yayında uygulanıyor | monthBoundary.test.js | kurum değerinin dayanağı |
| `QUAL_ONLY_IN_SPECIALTY` — Kişi yalnızca kendi uzmanlık/unvanına uygun görevlerde çalışır. | ✅ motor, elle atama, risk paneli ve yayında uygulanıyor | mandatoryRules (yalnız triaj personeli), Aralık deneme 486/486 | kurum değerinin dayanağı |
| `WEEKLY_MAX_80H` — Haftalık toplam çalışma saati üst sınırı 80 saattir. | 🟡 mekanizma hazır, değer bekliyor | mandatoryRules.test.js (değer kurum kararı) | KARAR: değer ve dayanağı (önceki 72 s kaynaksızdı). Mekanizma hazır. |
| `PREGNANT_NO_NIGHTS` — Hamile/emziren personel gece nöbetine yazılmaz. | ❌ uygulanmıyor | — | KARAR: personel kartında sağlık/gebelik bilgisi tutulacak mı, kim görür (KVKK m.6 özel nitelikli veri). Teknik hazırlık: "gece yok" kısıtı alanı. |
| `HEALTH_LIMITED_SHIFTS` — Sağlık raporu olan personel kısıtlı vardiyalara yazılır. | ❌ uygulanmıyor | — | KARAR: aynı (KVKK m.6). Önerilen alanlar: nightAllowed, onlyDayShifts, maxShiftsPerMonth. |
| `TRY_RESPECT_OFF_REQUESTS` — Boş gün (B) isteği olan personele o gün nöbet yazmamaya çalış. | 🟡 tercih olarak (motor cezası + risk panelinde TERCIH) | — | KARAR: onaylı boşluk isteği (B) izin gibi kesin engel mi, tercih mi? Şu an tercih cezası + risk panelinde TERCIH. |

## Tüm kurallar

| Kural | Tanım | Seviye | Durum | Kurum anahtarı | Motor | Elle atama | Risk paneli | Yayın | Test | Karar bekleyen |
|---|---|---|---|---|---|---|---|---|---|---|
| `QUAL_ONLY_IN_SPECIALTY` | Kişi yalnızca kendi uzmanlık/unvanına uygun görevlerde çalışır. | Katı | Şablon/alan ile | — | görev satırı kişi sayısı + personel alan/vardiya kodu | aday listesi alan ve koda göre süzülür | ALAN_UYGUN_DEGIL, VARDIYA_KODU_UYGUN_DEGIL, BOS_SLOT | BOS_SLOT kararı ister | mandatoryRules (yalnız triaj personeli), Aralık deneme 486/486 |  |
| `CERT_REQUIRED_FOR_CRITICAL` | Kritik görevler sadece gerekli sertifikalı personele atanır. | Katı | Bilgi — motor kontrol etmez | — | — | — | — | — | — |  |
| `TRIAGE_NURSES_ONLY` | Triaj görevi yalnızca hemşirelere atanır. | Katı | Şablon/alan ile | — | görev satırı kişi sayısı + personel alan/vardiya kodu | aday listesi alan ve koda göre süzülür | ALAN_UYGUN_DEGIL, VARDIYA_KODU_UYGUN_DEGIL, BOS_SLOT | BOS_SLOT kararı ister | mandatoryRules (yalnız triaj personeli), Aralık deneme 486/486 |  |
| `RESUS_MIN_TWO` | Resüsitasyon alanında her vardiyada en az 2 sağlık personeli bulunur. | Katı | Şablon/alan ile | — | görev satırı kişi sayısı + personel alan/vardiya kodu | aday listesi alan ve koda göre süzülür | ALAN_UYGUN_DEGIL, VARDIYA_KODU_UYGUN_DEGIL, BOS_SLOT | BOS_SLOT kararı ister | mandatoryRules (yalnız triaj personeli), Aralık deneme 486/486 |  |
| `RED_YELLOW_CHILD_MIN1` | Kırmızı, Sarı ve Çocuk alanlarında her vardiyada en az 1 kişi bulunur. | Katı | Şablon/alan ile | — | görev satırı kişi sayısı + personel alan/vardiya kodu | aday listesi alan ve koda göre süzülür | ALAN_UYGUN_DEGIL, VARDIYA_KODU_UYGUN_DEGIL, BOS_SLOT | BOS_SLOT kararı ister | mandatoryRules (yalnız triaj personeli), Aralık deneme 486/486 |  |
| `GREEN_MIN_STAFF` | Yeşil alanda min. kadro: hafta içi 3, hafta sonu 4. | Katı | Şablon/alan ile | — | görev satırı kişi sayısı + personel alan/vardiya kodu | aday listesi alan ve koda göre süzülür | ALAN_UYGUN_DEGIL, VARDIYA_KODU_UYGUN_DEGIL, BOS_SLOT | BOS_SLOT kararı ister | mandatoryRules (yalnız triaj personeli), Aralık deneme 486/486 |  |
| `PHARMACY_ONE_PER_24H` | Eczaneye her 24 saatte 1 personel atanır. | Katı | Şablon/alan ile | — | görev satırı kişi sayısı + personel alan/vardiya kodu | aday listesi alan ve koda göre süzülür | ALAN_UYGUN_DEGIL, VARDIYA_KODU_UYGUN_DEGIL, BOS_SLOT | BOS_SLOT kararı ister | mandatoryRules (yalnız triaj personeli), Aralık deneme 486/486 |  |
| `SERVICE_LEAD_WEEKDAY_DAY` | Servis sorumlusu yalnız hafta içi gündüz vardiyalarında yazılır. | Katı | Şablon/alan ile | — | görev satırı kişi sayısı + personel alan/vardiya kodu | aday listesi alan ve koda göre süzülür | ALAN_UYGUN_DEGIL, VARDIYA_KODU_UYGUN_DEGIL, BOS_SLOT | BOS_SLOT kararı ister | mandatoryRules (yalnız triaj personeli), Aralık deneme 486/486 |  |
| `SUPERVISOR_UNUSED` | Süpervizör vardiyası tanımlı fakat kullanılmıyor. | Düşük | Şablon/alan ile | — | görev satırı kişi sayısı + personel alan/vardiya kodu | aday listesi alan ve koda göre süzülür | ALAN_UYGUN_DEGIL, VARDIYA_KODU_UYGUN_DEGIL, BOS_SLOT | BOS_SLOT kararı ister | mandatoryRules (yalnız triaj personeli), Aralık deneme 486/486 |  |
| `RED_YELLOW_TEAMLEAD_ONE` | Kırmızı/Sarı ekip sorumlusu her nöbette 1 kişi olur. | Katı | Şablon/alan ile | — | görev satırı kişi sayısı + personel alan/vardiya kodu | aday listesi alan ve koda göre süzülür | ALAN_UYGUN_DEGIL, VARDIYA_KODU_UYGUN_DEGIL, BOS_SLOT | BOS_SLOT kararı ister | mandatoryRules (yalnız triaj personeli), Aralık deneme 486/486 |  |
| `SURGERY_ROOM_MIN2` | Cerrahi müdahale odasında her nöbette 2 personel bulunur. | Katı | Şablon/alan ile | — | görev satırı kişi sayısı + personel alan/vardiya kodu | aday listesi alan ve koda göre süzülür | ALAN_UYGUN_DEGIL, VARDIYA_KODU_UYGUN_DEGIL, BOS_SLOT | BOS_SLOT kararı ister | mandatoryRules (yalnız triaj personeli), Aralık deneme 486/486 |  |
| `VACCINATION_UNUSED` | Aşı uygulama nöbeti tanımlı fakat kullanılmıyor. | Düşük | Şablon/alan ile | — | görev satırı kişi sayısı + personel alan/vardiya kodu | aday listesi alan ve koda göre süzülür | ALAN_UYGUN_DEGIL, VARDIYA_KODU_UYGUN_DEGIL, BOS_SLOT | BOS_SLOT kararı ister | mandatoryRules (yalnız triaj personeli), Aralık deneme 486/486 |  |
| `ROTATION_APPLIES` | Görev yerleri rotasyonla dağıtılır. | Orta | Bilgi — motor kontrol etmez | — | — | — | — | — | — |  |
| `NO_UNQUALIFIED_ASSIGN` | Yetkin olmadığı alana atama yapılmaz. | Katı | Şablon/alan ile | — | görev satırı kişi sayısı + personel alan/vardiya kodu | aday listesi alan ve koda göre süzülür | ALAN_UYGUN_DEGIL, VARDIYA_KODU_UYGUN_DEGIL, BOS_SLOT | BOS_SLOT kararı ister | mandatoryRules (yalnız triaj personeli), Aralık deneme 486/486 |  |
| `SUPPORT_ROLES_OPTIONAL` | Destek rolleri ihtiyaç halinde tanımlanabilir. | Düşük | Bilgi — motor kontrol etmez | — | — | — | — | — | — |  |
| `MAX_TASK_PER_PERSON` | Aynı kişi aynı göreve ay içinde en fazla X kez yazılır. | Yüksek | Motor uygular | MAX_TASK_PER_PERSON | constraints.js | GOREV_SAYISI (yeni) | GOREV_SAYISI (yeni) | kararsız risk varken 409 RISKS_PENDING | riskAuditExtra.test.js, scheduler.constraints |  |
| `WEEKLY_MAX_80H` | Haftalık toplam çalışma saati üst sınırı 80 saattir. | Katı | Motor uygular | MAX_WEEKLY_HOURS | constraints.js | HAFTALIK_SAAT | HAFTALIK_SAAT | kararsız risk varken 409 RISKS_PENDING | mandatoryRules.test.js (değer kurum kararı) | KARAR: değer ve dayanağı (önceki 72 s kaynaksızdı). Mekanizma hazır. |
| `WEEKLY_MAX_SHIFTS` | Bir personel haftada en fazla X nöbet alır. | Katı | Motor uygular | MAX_SHIFTS_PER_WEEK | maxWeeklyShifts.rule.js, constraints.js | HAFTALIK_VARDIYA (yeni) | HAFTALIK_VARDIYA (yeni) | kararsız risk varken 409 RISKS_PENDING | riskAuditExtra.test.js, scheduler.constraints |  |
| `DAILY_MAX_24H` | Bir günde toplam çalışma 24 saati geçemez. | Katı | Bilgi — motor kontrol etmez | ONE_SHIFT_PER_DAY + MIN_REST_HOURS | dolaylı: günde tek vardiya ve en uzun vardiya 24 s | GUNDE_IKI_VARDIYA, CAKISMA | GUNDE_IKI_VARDIYA, CAKISMA | kararsız risk varken 409 RISKS_PENDING | mandatoryRules |  |
| `MAX_CONSECUTIVE_6D` | Maksimum ardışık çalışma 6 gündür. | Katı | Motor uygular | MAX_CONSECUTIVE_DAYS | maxConsecutiveDays.rule.js | ART_ARDA_GUN | ART_ARDA_GUN | kararsız risk varken 409 RISKS_PENDING | monthBoundary.test.js (26–31 Ara → 1 Oca) |  |
| `WEEKLY_MIN_1_OFF` | Her hafta en az 1 gün kesintisiz tatil olmalıdır. | Katı | Motor uygular | MAX_CONSECUTIVE_DAYS ≤ 6 | maxConsecutiveDays.rule.js — kayan 7 günde en az 1 boş gün, en fazla 6 gün art arda ile aynıdır | ART_ARDA_GUN | ART_ARDA_GUN | kararsız risk varken 409 RISKS_PENDING | monthBoundary.test.js |  |
| `MIN_REST_11H` | Vardiyalar arasında en az 11 saat dinlenme olmalıdır. | Katı | Motor uygular | MIN_REST_HOURS | constraints.js (gece yarısını aşan vardiya dahil) | DINLENME_12S | DINLENME_12S | kararsız risk varken 409 RISKS_PENDING | monthBoundary.test.js, E2E K13 |  |
| `OVERTIME_MINIMIZE` | Fazla mesai yapılabilir ama minimumda tutulur. | Yüksek | Bilgi — motor kontrol etmez | — | — | — | — | — | — | KARAR: aylık norm. |
| `MONTHLY_TARGET_CALC` | Aylık hedef saat = (resmi iş günü × 8) olarak planlanır. | Orta | Bilgi — motor kontrol etmez | — | — | — | — | — | — | KARAR: aylık norm ve eksik saat devri. |
| `ONE_SHIFT_PER_DAY` | Bir personele bir günde yalnızca 1 vardiya atanır. | Katı | Motor uygular | ONE_SHIFT_PER_DAY | oneShiftPerDay.rule.js, constraints.js | GUNDE_IKI_VARDIYA, CAKISMA + aynı gün çakışma kontrolü | GUNDE_IKI_VARDIYA, CAKISMA | kararsız risk varken 409 RISKS_PENDING | mandatoryRules.test.js (15 tekrar) |  |
| `LONG_SHIFTS_MAX2_PER_WEEK` | 16/24 saatlik uzun nöbetler haftada en fazla 2 kez verilir. | Yüksek | Bilgi — motor kontrol etmez | — | — | — | — | — | — |  |
| `NIGHT_7_5H_NORM_INFO` | Gece çalışma normu 7.5 saattir (sağlık sektörü istisna olabilir). | Düşük | Bilgi — motor kontrol etmez | — | — | — | — | — | — |  |
| `LEAVE_BLOCK_AN_FIRSTDAY` | AN kodu olan personele yeni ayın ilk günü nöbet yazılmaz. | Katı | Bilgi — motor kontrol etmez | — | — | — | — | — | — |  |
| `LEAVE_BLOCK_GENERIC` | İzin/rapor kodlu günlere atama yapılmaz; bazıları çalışılmış sayılır. (Bİ, Dİ, E, Eİ, G, U, H, R, RE, S, Sİ, İ, İİ, Üİ, Y vb.) | Katı | Motor uygular | LEAVE_BLOCK | leaveBlock.rule.js | IZIN_GUNU (yeni) + izin çakışması | IZIN_GUNU (yeni) | kararsız risk varken 409 RISKS_PENDING | mandatoryRules, riskAuditExtra, E2E F7, K12 |  |
| `NIGHT_FAIR_DISTRIBUTION` | Gece nöbetleri personel arasında adil dağıtılır. | Yüksek | Yaklaşık (denge) | — | adalet sayaçları / tercih cezası | — | TERCIH (tercih kuralları için) | — | Adillik raporu; fairness testleri |  |
| `NO_CONSEC_NIGHTS` | Arka arkaya iki gece nöbeti yazılmaz. | Katı | Bilgi — motor kontrol etmez | — | — | — | — | — | — |  |
| `WEEKEND_NIGHTS_FAIR` | Hafta sonu gece nöbetleri adil paylaşılır. | Yüksek | Yaklaşık (denge) | — | adalet sayaçları / tercih cezası | — | TERCIH (tercih kuralları için) | — | Adillik raporu; fairness testleri |  |
| `NIGHT_BALANCE_MONTH_YEAR` | Gece nöbet sayıları aylık/yıllık dengelenir. | Orta | Bilgi — motor kontrol etmez | — | — | — | — | — | — |  |
| `AN_CONSIDER_FOR_NIGHTS` | AN kodu olanlar yeni ayda gece dağılımında dikkate alınır. | Orta | Bilgi — motor kontrol etmez | — | — | — | — | — | — |  |
| `EQUAL_NIGHTS_EXCEPT_EXEMPT` | Muaf/kıdem özel durumlar dışında herkes eşit sıklıkta geceye girer. | Orta | Bilgi — motor kontrol etmez | — | — | — | — | — | — |  |
| `VOLUNTEERS_MORE_NIGHTS_IF_FAIR` | Gönüllü olanlara daha fazla gece verilebilir; adalet korunur. | Düşük | Bilgi — motor kontrol etmez | — | — | — | — | — | — |  |
| `HOLIDAY_EQUAL` | Resmi/dini bayram nöbetleri eşit dağıtılır. | Yüksek | Bilgi — motor kontrol etmez | — | — | — | — | — | — | KARAR: bayram eşitliği yıllık mı, aylık mı sayılır; adalet puanına ağırlığı. |
| `HOLIDAY_SIMILAR_COUNT_YEAR` | Yıl genelinde herkese benzer sayıda tatil nöbeti düşer. | Orta | Bilgi — motor kontrol etmez | — | — | — | — | — | — | KARAR: aynı. |
| `HOLIDAY_RESPECT_PREFS` | Tatil günlerinde tercihlere mümkün olduğunca uyulur. | Orta | Bilgi — motor kontrol etmez | — | — | — | — | — | — |  |
| `HOLIDAY_NO_CONSEC_ALL_DAYS` | Bir bayramın tüm günleri aynı kişiye yazılmaz (ardışık gün yasağı). | Yüksek | Bilgi — motor kontrol etmez | — | — | — | — | — | — |  |
| `HOLIDAY_ROTATE_SPECIAL_DAYS` | Yılbaşı/bayram 1. gün gibi özel nöbetler dönüşümlü verilir. | Orta | Bilgi — motor kontrol etmez | — | — | — | — | — | — |  |
| `HOLIDAY_BEFORE_AFTER_ATTENTION` | Tatil öncesi/sonrası nöbetler dikkatle planlanır. | Düşük | Bilgi — motor kontrol etmez | — | — | — | — | — | — |  |
| `NO_MULTIPLE_ASSIGNMENTS_PER_DAY` | Aynı günde birden fazla nöbet atanamaz. | Katı | Motor uygular | ONE_SHIFT_PER_DAY | oneShiftPerDay.rule.js, constraints.js | GUNDE_IKI_VARDIYA, CAKISMA + aynı gün çakışma kontrolü | GUNDE_IKI_VARDIYA, CAKISMA | kararsız risk varken 409 RISKS_PENDING | mandatoryRules.test.js (15 tekrar) |  |
| `NO_DOUBLE_BOOKING` | Aynı anda iki görevde olunamaz. | Katı | Motor uygular | ONE_SHIFT_PER_DAY | oneShiftPerDay.rule.js, constraints.js | GUNDE_IKI_VARDIYA, CAKISMA + aynı gün çakışma kontrolü | GUNDE_IKI_VARDIYA, CAKISMA | kararsız risk varken 409 RISKS_PENDING | mandatoryRules.test.js (15 tekrar) |  |
| `NO_SPLIT_SHIFT` | Bölünmüş vardiya uygulanmaz. | Katı | Bilgi — motor kontrol etmez | — | — | — | — | — | — |  |
| `NIGHT_NEXT_DAY_OFF` | Gece nöbeti tutan kişi ertesi gün izinlidir. | Katı | Motor uygular | NIGHT_NEXT_DAY_OFF | restAfterNight.rule.js, constraints.js | GECE_SONRASI_GUN | GECE_SONRASI_GUN | kararsız risk varken 409 RISKS_PENDING | scheduler.restAfterNight, monthBoundary, E2E K8, K13 |  |
| `LONG16_NEXT_DAY_LIGHT` | 16 saatlik vardiya sonrası ertesi gün ağır/erken görevlere yazılmaz. | Yüksek | Bilgi — motor kontrol etmez | — | — | — | — | — | — |  |
| `NIGHT_OFF_PLANNED` | Gece sonrası izin önceden planlanır. | Orta | Bilgi — motor kontrol etmez | — | — | — | — | — | — |  |
| `END_OF_MONTH_WEEKEND_NEXT_DAY_OFF` | Ay sonu/hafta sonu nöbetlerinden sonra ertesi gün izin uygulanır. | Düşük | Bilgi — motor kontrol etmez | — | — | — | — | — | — |  |
| `NO_IMMEDIATE_NEXT_NIGHT_AFTER_NIGHT` | Gece nöbetinden hemen sonra tekrar gece nöbeti verilmez. | Katı | Motor uygular | NIGHT_NEXT_DAY_OFF | restAfterNight.rule.js, constraints.js | GECE_SONRASI_GUN | GECE_SONRASI_GUN | kararsız risk varken 409 RISKS_PENDING | scheduler.restAfterNight, monthBoundary, E2E K8, K13 |  |
| `NO_OVERLAP_SHIFTS` | Vardiyalar birbiriyle çakışamaz. | Katı | Yaklaşık (denge) | — | adalet sayaçları / tercih cezası | — | TERCIH (tercih kuralları için) | — | Adillik raporu; fairness testleri |  |
| `MIN_GAP_12H` | Vardiyalar arasında en az 12 saat boşluk olmalıdır. | Katı | Motor uygular | MIN_REST_HOURS | constraints.js (gece yarısını aşan vardiya dahil) | DINLENME_12S | DINLENME_12S | kararsız risk varken 409 RISKS_PENDING | monthBoundary.test.js, E2E K13 |  |
| `NO_OVERLAP_ANY` | Hiçbir vardiya başka vardiya ile üst üste gelmez. | Katı | Yaklaşık (denge) | — | adalet sayaçları / tercih cezası | — | TERCIH (tercih kuralları için) | — | Adillik raporu; fairness testleri |  |
| `SMOOTH_DAY_NIGHT_TRANSITIONS` | Gündüz–gece geçişleri çakışma olmayacak biçimde planlanır. | Orta | Bilgi — motor kontrol etmez | — | — | — | — | — | — |  |
| `TRY_RESPECT_OFF_REQUESTS` | Boş gün (B) isteği olan personele o gün nöbet yazmamaya çalış. | Orta | Bilgi — motor kontrol etmez | — | — | — | — | — | — | KARAR: onaylı boşluk isteği (B) izin gibi kesin engel mi, tercih mi? Şu an tercih cezası + risk panelinde TERCIH. |
| `CONSIDER_PREFERRED_SHIFTS` | Tercih ettiği vardiyalar dikkate alınır. | Düşük | Yaklaşık (denge) | — | adalet sayaçları / tercih cezası | — | TERCIH (tercih kuralları için) | onaylı tercih ihlali kararı ister | Adillik raporu; fairness testleri |  |
| `AVOID_MAZERET_DAYS` | Mazeret günlerine nöbet yazmamaya çalış. | Orta | Yaklaşık (denge) | — | adalet sayaçları / tercih cezası | — | TERCIH (tercih kuralları için) | onaylı tercih ihlali kararı ister | Adillik raporu; fairness testleri |  |
| `ALLOW_SWAP_BY_RULES` | Karşılıklı nöbet değişimleri kurallara uygun yapılır. | Orta | Bilgi — motor kontrol etmez | — | — | — | — | — | — |  |
| `FAIR_ON_MULTI_REQUESTS` | Çoklu talepte adalet sağlanır. | Orta | Bilgi — motor kontrol etmez | — | — | — | — | — | — |  |
| `COMMUNICATE_DURING_PLANNING` | Planlama sürecinde personele danış, iletişim kur. | Düşük | Bilgi — motor kontrol etmez | — | — | — | — | — | — |  |
| `ALLOW_REASONABLE_FLEX` | Moral/motivasyon için makul esneklik tanınır. | Düşük | Bilgi — motor kontrol etmez | — | — | — | — | — | — |  |
| `SENIOR_MAY_EXEMPT` | Kıdemli personel bazı nöbetlerden muaf olabilir. | Orta | Bilgi — motor kontrol etmez | — | — | — | — | — | — |  |
| `TEAM_LEAD_SHARED_AMONG_SENIORS` | Ekip sorumluluğu kıdemliler arasında dönüşümlü paylaşılır. | Orta | Bilgi — motor kontrol etmez | — | — | — | — | — | — |  |
| `PREGNANT_NO_NIGHTS` | Hamile/emziren personel gece nöbetine yazılmaz. | Katı | Bilgi — motor kontrol etmez | — | — | — | — | — | — | KARAR: personel kartında sağlık/gebelik bilgisi tutulacak mı, kim görür (KVKK m.6 özel nitelikli veri). Teknik hazırlık: "gece yok" kısıtı alanı. |
| `HEALTH_LIMITED_SHIFTS` | Sağlık raporu olan personel kısıtlı vardiyalara yazılır. | Katı | Bilgi — motor kontrol etmez | — | — | — | — | — | — | KARAR: aynı (KVKK m.6). Önerilen alanlar: nightAllowed, onlyDayShifts, maxShiftsPerMonth. |
| `SENIOR_PREFERENCES` | Kıdemli personelin belirli tercih hakları tanınabilir. | Düşük | Bilgi — motor kontrol etmez | — | — | — | — | — | — |  |
| `SENIOR_JUNIOR_BALANCE` | Kıdem–genç dengesi gözetilir. | Orta | Bilgi — motor kontrol etmez | — | — | — | — | — | — |  |
| `NO_TITLE_CONFLICTS` | Unvan çatışması olmamalıdır. | Katı | Bilgi — motor kontrol etmez | — | — | — | — | — | — |  |
| `NO_ASSIGN_WITHOUT_TRAINING` | Gerekli eğitim/oryantasyon olmadan atama yapılmaz. | Katı | Bilgi — motor kontrol etmez | — | — | — | — | — | — |  |
| `FAIR_TOTAL_LOAD` | Toplam yük (vardiya/saat) adil dağıtılır. | Orta | Yaklaşık (denge) | — | adalet sayaçları / tercih cezası | — | TERCIH (tercih kuralları için) | — | Adillik raporu; fairness testleri |  |
