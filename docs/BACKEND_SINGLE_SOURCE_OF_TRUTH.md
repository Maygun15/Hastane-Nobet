# Backend Single Source Of Truth

Son güncelleme: 11 Mart 2026

## Karar
- Çizelge verisinde tek otorite backend (`/api/schedules/monthly`, `/api/schedules/assign`).
- Frontend localStorage sadece fallback/cache amaçlı; backend verisi varsa local kaynaklar override etmez.

## Event Sözleşmesi (Frontend)
- `planner:changed`: Plan/çizelge tarafında lokal değişiklik sinyali.
- `schedule:built`: Çalışma çizelgesi üretimi tamamlandı.
- `schedule:saved`: Backend aylık çizelge kaydı güncellendi.

Kaldırılan eski kanal:
- `planner:dpResult` (deprecated ve kaldırıldı)

## Kaldırılan Eski Lokal Kaynaklar
- `dpResultLast` (okuma/yazma kaldırıldı)
- `assignmentsBuffer` (okuma/yazma kaldırıldı)

## Kalan Fallback Kaynakları
- `scheduleRowsV2`
- `generatedRosterFlat`

Not: Bu fallback’ler yalnızca backend verisi yok/hata durumunda devreye girer.

## Smoke Test
Kalıcı yazma/okuma testi:

```bash
SMOKE_IDENTIFIER="admin@admin.com" \
SMOKE_PASSWORD="1234" \
SMOKE_PERSON_ID="<personId>" \
npm run smoke:e2e
```

Alternatif:
- Token ile: `SMOKE_TOKEN="<jwt>"`
- Yazma yapmadan doğrulama: `npm run smoke:e2e -- --dry-run`
