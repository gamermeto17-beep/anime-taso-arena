# ANIME TASO ARENA — Aşama 1 + 2 + 3

Klasik taso oyunundan esinlenen, anime koleksiyonlu, **gerçek çevrim içi iki oyunculu** web oyunu.

## Durum (dürüst özet)

**Çalışıyor**
- İki farklı tarayıcı/cihaz arasında gerçek eşleşme (aynı odayı seçen iki oyuncu), Socket.IO ile anlık güncelleme
- **Yetkili sunucu**: sıra, atış zamanlaması, çevirme sonucu, taso transferi ve devam kararı sunucuda; istemci yalnızca "ibreyi şu süre sonra durdurdum" der
- Taso seçimi iki taraf onaylayınca kilitlenir; ilk atış rastgele; atışlar sırayla
- Tur sonu DEVAM ET / OYUNU BİTİR (20 sn, süre dolunca "bitir"), ikisi devam derse aynı odada yeni tur
- Yeniden bağlanma: sayfa yenilenince / bağlantı kopunca aktif maça dönülür; 60 sn dönmeyen oyuncu maçı terk etmiş sayılır
- Tasolar masada **üst üste yığın** halinde başlar, atış vurunca **dağılır**; çevrilenler kazananın tarafına gider
- Arka yüz seriye özel sembol taşır (Naruto: spiral, One Piece: kafatası + kemikler — ikisi de bu proje için çizilmiş genel semboller, resmi logo değildir)
- Ön yüzde karakter görseli: **sen görselleri ekleyince** otomatik gösterilir (aşağıya bak); yoksa şık geçici yüz görünür
- Katalog: Naruto 250 + One Piece 250 kayıt, saf TypeScript oyun motoru, denge parametreleri `src/engine/balance.ts`
- Günlük ücretsiz kurtarma (tasosu 4'ün altına düşenler, 24 saatte bir)
- 20 test (motor, transfer, sunucu entegrasyonu)

**Henüz YOK**
- Hesap güvenliği sınırları: parola sıfırlama / e-posta doğrulama yok (parolanı unutursan hesap kurtarılamaz); giriş denemeleri IP ve hesap başına sınırlıdır
- Jeton, çark, paket, günlük görevler, maç ödülleri (Aşama 4)
- Müzik, ileri animasyonlar, performans (Aşama 5)
- Karakter görselleri **projeye dahil değil** (telifli); aşağıdaki araçla kendi/lisanslı görsellerini ekle

**Bilinen sınırlar**
- Zamanlama barı istemcide çalışır; sunucu süreyi makul pencereye sıkıştırır ve çevirme sonucunu kendisi çizer, ama bar bilgisini bilen hileli bir istemciyi tamamen engelleyemez (kırmızı bölge ekranda görünmek zorunda). Çevirme şansı ve taso transferi güvenlidir.
- Transferler bellekte bölünemez adımda yapılır, veritabanına tek PostgreSQL işlemiyle yazılır (bir taso satırının tek sahibi vardır, çift işlenemez)
- Birden çok sunucu kopyası çalıştırılamaz (eşleşme ve maçlar bellekte)

## Kurulum

```bash
npm install
npm run dev        # sunucu :3001 + istemci :5173 (tarayıcıda http://localhost:5173)
npm test           # tüm testler
npm run build && npm start   # üretim: tek süreç, http://localhost:3001
```

İki oyuncuyla denemek: iki ayrı tarayıcı (veya biri gizli pencere) aç, farklı adlarla giriş yap, ikisi de aynı odayı seç.

## Karakter görseli eklemek (kendi / lisanslı görsellerin)

```bash
npm run katalog:csv                              # katalog.csv: her taso için beklenen dosya adı
npm run gorsel:ice -- ./benim-gorsellerim naruto # klasörü kataloğa eşleyip kopyalar + manifest üretir
npm run gorsel:manifest                          # dosyaları elle koyduysan manifesti yeniler
```
Dosya adı `naruto-001.png`, `001.png`, `Sasuke Uchiha Genin.png` ya da `Itachi Uchiha.png` olabilir (webp/png/jpg). Görseller `public/assets/tasos/<seri>/` altına gider; sayfayı yenilemen yeterli.

## Yeni anime eklemek
1. `src/data/series.ts` içine seri ekle (renk, desen, sembol)
2. `src/data/<seri>Raw.ts` içine 250 satır (`Karakter;Form;c|r|e|l`)
3. `src/data/catalog.ts` içindeki `RAW_BY_SERIES`'e bağla

## Klasörler
```
server/        Express + Socket.IO yetkili oyun sunucusu (+ entegrasyon testi)
src/engine     denge, zamanlama, RNG, maç motoru (istemci ve sunucu ortak kullanır)
src/net        ortak protokol tipleri, istemci bağlantı kancası
src/screens    giriş, menü, oda, kuyruk, taso seçimi, masa, sonuç
src/components Taso, TimingBar, Emblem
scripts/       görsel içe aktarma / katalog CSV
server/         Express + Socket.IO, db.ts (pg / PGlite), store.ts (SQL), auth.ts (scrypt, oturum)
```

## Yayınlama (en kolay yol: Render, ücretsiz)
1. Projeyi bir GitHub deposuna yükle (github.com → New repository → "uploading an existing file" ile klasör içeriğini sürükle).
2. render.com'a GitHub ile giriş yap → **New → Blueprint** → depoyu seç → **Apply**. `render.yaml` her şeyi kendisi kurar.
3. Birkaç dakika sonra Render sana `https://anime-taso-arena-xxxx.onrender.com` gibi bir adres verir. Arkadaşına bu linki gönder; ikiniz de linke tıklayıp oynarsınız.

Notlar: ücretsiz planda sunucu 15 dk işlem olmazsa uyur (ilk açılış ~30 sn sürer) ve yeniden başlayınca koleksiyonlar sıfırlanır (kalıcı veritabanı Aşama 3). Docker kullanan herhangi bir yerde `Dockerfile` da hazırdır. `PORT` ortam değişkeni otomatik okunur.


## Aşama 3 (tamamlandı)
- Kalıcı hesaplar: kayıt/giriş (scrypt ile parola, hash'lenmiş oturum belirteçleri, 30 gün), PostgreSQL envanteri
- XP ve seviye (1-500, her 100 seviyede +3 puan çevirme şansı, en fazla +15), kopya tasoyu XP'ye dönüştürme (onaylı), kilit/favori, koleksiyon ve profil ekranları, seviye atlama animasyonu
- `DATABASE_URL` varsa PostgreSQL, yoksa yerel PGlite (`./data/pglite`) kullanılır
- **Dürüst sınırlar:** Render ÜCRETSİZ Postgres veritabanı ~30 gün sonra sona erer (süre dolmadan ücretli plana geçilmeli ya da yeni veritabanına taşınmalı, yoksa hesaplar silinir). Ücretsiz web servisi 15 dk işlem olmazsa uyur; uyurken/yeniden başlarken devam eden maçlar bellekte olduğu için kaybolur (tasolar maç sırasında sahibinde kalır, hesaplar kaybolmaz). Karakter görselleri henüz sizin sağlayacağınız dosyalardır.
