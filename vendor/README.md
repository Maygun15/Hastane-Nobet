# Vendor paketleri

## xlsx-0.20.3.tgz (SheetJS Community Edition)
- Kaynak: https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz (SheetJS'in resmî dağıtımı; npm kayıt defterindeki `xlsx` 0.18.5'te kalmıştır)
- SHA-256: `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`
- npm integrity (package-lock): `sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==`
- Giderilen açıklar (0.18.5'te vardı):
  - CVE-2023-30533 / GHSA-4r6h-8v6p-xvw6 — özel hazırlanmış dosya okunurken prototip kirlenmesi; ≤0.19.2 etkilenir, 0.19.3'te düzeltildi
  - CVE-2024-22363 / GHSA-5pgg-2g8v-p4x9 — düzenli ifade hizmet engeli (ReDoS); ≤0.20.1 etkilenir, 0.20.2'de düzeltildi
- Bağımlılığı yok, kurulum betiği yok. Kullanıcıya giden pakete girer (`dist/assets/xlsx_vendor-*.js`, `.version="0.20.3"`).
- Güncelleme: SheetJS duyurularını izleyin (https://cdn.sheetjs.com/advisories/), yeni tarball'ı buraya koyup `npm i --save-exact file:vendor/xlsx-<sürüm>.tgz`.
