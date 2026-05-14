şimdi ## Aylik Takvim Tuvali Regression Checklist

Bu ekran icin korunacak kurallar:

- Veri kaynagi once `Calisma Cizelgesi` read-model olmalidir.
- Kisi eslesmesi yalnizca gercek `personId` ile yapilmalidir.
- TC/TCKN, personel ID yerine kullanilamaz.
- Saat hesabi `workingHours + defs` zincirinden uretilmelidir.
- `Assignment` bu ekran icin birincil truth degil, destekleyici katmandir.

### Smoke Check

1. Gun kutularinda `176107...` gibi satir ID'leri gorunmemeli.
2. Gun kutusunda anlamli vardiya/gorev etiketi gorunmeli.
3. Kisi secildiginde atamalar dogru kisiye ait olmali.
4. Aylik toplam saat, calisma cizelgesindeki vardiya saatleri ile uyumlu olmali.
5. Resmi tatil ve arife gunlerinde gereken saat hesabi bozulmamali.
6. Hizli yerine atama veya manuel atama sonrasi ekran ayni truth zincirinden yeniden dolmali.

### Degisiklik Sonrasi Zorunlu Kontrol

- `npm run build`
- Takvim tuvalinde tek personel secip 3-4 gun uzerinde gozle kontrol
- Ayni personelin `MonthlyHoursSheet` ve `OvertimeTab` saatleri ile tutarlilik kontrolu
