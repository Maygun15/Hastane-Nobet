# Manual Test Checklist

## Authentication
- Login with valid user (`/api/auth/login` returns token and `/api/auth/me` resolves).
- Logout clears session and protected pages redirect.
- Wrong password shows controlled error message (no stack trace).

## Leave Flow
- Add leave in `Toplu İzin Listesi`.
- Verify same leave appears in personal calendar.
- Hard refresh page and verify leave persists.
- Add leave on a day with existing shift and confirm conflict behavior:
  - warning appears
  - if approved, shift is removed and leave remains.

## Schedule Flow
- Build schedule in `Çalışma Çizelgesi`.
- Open `Fazla Mesai Takip Formu` and run `Çizelgeden Doldur`.
- Verify imported hours match shift definitions from parameters (not all `24`).

## Overtime Calculation
- For a person with leave, verify leave days are excluded from worked-hour total.
- Verify credited leave hours (`İzin (ÇS)`) is reflected in required hours (`Gereken`).
- Confirm total overtime equals sum of per-person overtime rows.

## Role & Authorization
- Admin can access `Kullanıcılar`, identity update, and role actions.
- Staff can approve/reject requests in service scope.
- Standard user cannot access admin-only routes/tabs.

## Export/Import
- Export/import leaves file round-trip keeps person/day codes.
- Export/import overtime sheet round-trip keeps title/name/day columns.

## Error Handling
- Simulate backend off: UI shows actionable error without crash.
- Simulate 401 token expiration: user is forced to re-authenticate cleanly.
