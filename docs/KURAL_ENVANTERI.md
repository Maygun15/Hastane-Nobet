# Nöbet Kuralları Envanteri (17 Kasım 2026)

"Nöbet Kuralları" ekranında **70 kural** var. Bu belge her kuralın çizelge motorunda **gerçekten** nasıl karşılandığını gösterir. Aynı durum ekranda her kuralın kartında rozet olarak görünür (`src/rules/ruleEnforcement.js`).

| Rozet | Anlamı | Adet |
|---|---|---|
| 🟢 **Motor uygular** | Motor her atamada kontrol eder (`candidateBuilder/ruleRegistry.js`, `rules/dbRuleAdapter.js`) | 11 |
| 🔵 **Şablon/alan ile** | Kural olarak değil; görev satırı kişi sayısı + personelin çalışma alanı ile sağlanır | 12 |
| 🟣 **Yaklaşık (denge)** | Katı değil; adalet sayaçları / tercih cezası ile gözetilir | 7 |
| 🟠 **Bilgi — motor kontrol etmez** | Motor kontrol etmez; yayın öncesi elle bakılmalı | 40 |

## 🟢 Motor uygular
- `ONE_SHIFT_PER_DAY`
- `NO_MULTIPLE_ASSIGNMENTS_PER_DAY`
- `NO_DOUBLE_BOOKING`
- `NIGHT_NEXT_DAY_OFF`
- `NO_IMMEDIATE_NEXT_NIGHT_AFTER_NIGHT`
- `MIN_REST_11H`
- `MIN_GAP_12H`
- `MAX_CONSECUTIVE_6D`
- `WEEKLY_MAX_SHIFTS`
- `MAX_TASK_PER_PERSON`
- `LEAVE_BLOCK_GENERIC`: onaylı izin günü atama yapılmaz

## 🔵 Şablon / çalışma alanı ile
Bunlar için **Çizelge Yapısı**'ndaki görev satırlarının kişi sayısı ve personel kartındaki **çalışma alanları** doğru olmalı:
- `QUAL_ONLY_IN_SPECIALTY`, `NO_UNQUALIFIED_ASSIGN`, `TRIAGE_NURSES_ONLY`
- `RESUS_MIN_TWO`, `RED_YELLOW_CHILD_MIN1`, `GREEN_MIN_STAFF`, `PHARMACY_ONE_PER_24H`
- `SERVICE_LEAD_WEEKDAY_DAY`, `RED_YELLOW_TEAMLEAD_ONE`, `SURGERY_ROOM_MIN2`
- `SUPERVISOR_UNUSED`, `VACCINATION_UNUSED`

## 🟣 Yaklaşık (denge)
Sonucu **Adillik Raporu**'ndan kontrol edin:
- `NIGHT_FAIR_DISTRIBUTION`, `WEEKEND_NIGHTS_FAIR`, `FAIR_TOTAL_LOAD`
- `CONSIDER_PREFERRED_SHIFTS`, `AVOID_MAZERET_DAYS`
- `NO_OVERLAP_SHIFTS`, `NO_OVERLAP_ANY`

## 🟠 Motor kontrol etmez (40)
**Acil pilotu için önemli olanlar.** Yayından önce elle kontrol edilmeli ya da motora eklenmeli:

| Kural | Neden önemli | Öneri |
|---|---|---|
| `PREGNANT_NO_NIGHTS` | Yasal / sağlık | Personel kartına "gece yok" işareti + motor kuralı (**öncelik 1**) |
| `HEALTH_LIMITED_SHIFTS` | Sağlık kısıtı | Aynı mekanizma ("yalnızca gündüz", "en fazla N nöbet") |
| `WEEKLY_MIN_1_OFF` | Dinlenme | Haftada en az 1 boş gün kuralı (motor kuralı, kolay) |
| `WEEKLY_MAX_80H`, `DAILY_MAX_24H` | Mesai sınırı | Haftalık saat sınırı (kolay) |
| `TRY_RESPECT_OFF_REQUESTS` | Personel memnuniyeti | Onaylı "boşluk isteği (B)" izin gibi engellensin |
| `HOLIDAY_EQUAL`, `HOLIDAY_SIMILAR_COUNT_YEAR` | Adalet | Bayram sayacını adalet puanına ekle |
| `MONTHLY_TARGET_CALC`, `OVERTIME_MINIMIZE` | Saat normu (K3) | Aylık hedef saate yaklaştırma |

Diğerleri politika / iletişim notu niteliğinde:
- `COMMUNICATE_DURING_PLANNING`, `ALLOW_REASONABLE_FLEX`, `SENIOR_*`, `ROTATION_APPLIES`, `SUPPORT_ROLES_OPTIONAL`, `HOLIDAY_*` (öncelik / rotasyon), `LONG_*`, `NIGHT_7_5H_NORM_INFO`, `END_OF_MONTH_*`, `NIGHT_OFF_PLANNED`, `LEAVE_BLOCK_AN_FIRSTDAY`, `AN_CONSIDER_FOR_NIGHTS`, `EQUAL_NIGHTS_EXCEPT_EXEMPT`, `VOLUNTEERS_*`, `NIGHT_BALANCE_MONTH_YEAR`, `SMOOTH_DAY_NIGHT_TRANSITIONS`, `FAIR_ON_MULTI_REQUESTS`, `ALLOW_SWAP_BY_RULES`, `CERT_REQUIRED_FOR_CRITICAL`, `NO_TITLE_CONFLICTS`, `NO_ASSIGN_WITHOUT_TRAINING`, `TEAM_LEAD_SHARED_AMONG_SENIORS`, `SENIOR_JUNIOR_BALANCE`

## Sonraki adım
Acil sorumlusuyla "olmazsa olmaz" kurallar seçilir (öneri: hamile/sağlık kısıtı, haftada 1 boş gün, haftalık saat sınırı, boşluk isteği). Her biri motora eklenir ve testle gösterilir. Motor değişince `src/rules/ruleEnforcement.js` ve bu belge birlikte güncellenir.
