# UNVERCO mobil QA sistemi

## Tek komut

```bash
qa/telefon-test.sh              # web + Android (~5 dk), main'in guncel hali
qa/telefon-test.sh --ios        # + iOS Simulatoru ve iOS WebKit isi (macOS kuyrugu 0-15+ dk, isteğe bağlı)
qa/telefon-test.sh 627f280      # uygulama klasorlerini bu commit/etiketten sina
```

**iPhone kapsami:** varsayilan kosuda iPhone, web iste **WebKit iPhone profilleriyle** (iPhone 13/14/15/16, yatay; Masaustu taklidi) saglanir.
Gercek iOS Simulatoru yalnizca `--ios` ile kosar; macOS kuyrugu 15 dk'yi asarsa cikis kodu 2 DEGIL, "iOS atlandi: macOS kuyrugu" bilgisi verilir.

Komut web + Android (+ istenirse iOS) workflow'larini REST ile tetikler, run kimliklerini bulur, bitene kadar yoklar (en fazla 25 dk) ve
**artifact'a ihtiyac duymadan** (yalniz `gh run view --log`) tek tablo basar: is bazinda sure, GEÇTİ/KALDI/UYARI/ATLANDI sayisi ve [KALDI] satirlari.
Gereken: `gh` (giris yapmis), `jq`, `python3`. Ortam degiskenleri: `QA_REF`, `QA_ONLY=web,android`, `QA_TIMEOUT`, `QA_QUEUE_LIMIT`, `QA_MACOS`.

| Cikis kodu | Anlami |
|---|---|
| 0 | Hepsi gecti |
| 1 | Urun hatasi (en az bir KALDI) |
| 2 | Altyapi ya da zaman asimi (urun hatasi yok): runner kuyrugu, emulator acilmadi, log okunamadi |

macOS kuyrugu 15 dk'yi (`QA_QUEUE_LIMIT`) asarsa o kosu iptal edilir ve "ALTYAPI: macOS kuyruğu" olarak ayri raporlanir; urun hatasi sayilmaz.

### Sureler (olculen)

| Is | Sure |
|---|---|
| web (3 motor paralel, 11 profil, 2 uygulama) | ~4-5 dk |
| Android API 28 / API 34 (paralel) | ~3,5 / ~3,8 dk onbellek olusturma kosusunda; onbellekli kosu icin asagidaki olcum |
| iOS Playwright WebKit (iPhone profilleri) | ~9 dk (macOS) |
| iOS Simulatoru + Mobile Safari | ~2,5 dk (acilis 41 sn) |
| macOS kuyrugu | degisken: 0-10+ dk (ucretsiz havuz); toplam sure buna bagli |

### Taban alti tarayici (Chrome 80 / iOS 14 tabani)

Urunlerin spec tabani Chrome/WebView 80 ve iOS 14'tur. Taban altindaki tarayicida (ornegin Android 9 emulatorundeki Chrome 69) beklenen sonuc
uygulamanin acilmasi degil, 5 dilli `#boot-warning` uyarisinin (`role=alert`, dolu metin) en gec ~6 sn icinde gorunmesidir.
Bu bir gevsetme degil spec'in kendisidir: Chrome surumu 80'in altindaysa `run_android.py` Ana yolculuk / Bos ekran / Konsol yerine tek denetim kosar:
**"Eski tarayici uyarisi gorunur"** (P0). Uyari gorunmezse KALDI. Kanit: ekran goruntusu piksel istatistigi + DOM metni log'a yazilir.

### Ortam turu etiketleri

- **Masaustu taklidi**: Playwright (gercek Chromium/Firefox/WebKit motoru, taklit mobil boyut). Gercek telefon DEGIL.
- **Emulator**: Android emulatoru (API 28 Chrome 69 ve API 34 Chrome 113) + gercek Chrome.
- **Simulator**: iOS Simulatoru (iPhone, Xcode'un son iOS'u) + gercek Mobile Safari.

> **Gercek cihaz OLMADIGI icin** iOS yazdirma penceresi, dokunma hissi, bildirimler ve yuklenebilir PWA davranisi hala elle gercek iPhone/Android'de dogrulanmalidir.

### Workflow tasarimi (neden boyle)

- `concurrency`: yeni **push** yalnizca **ayni workflow'un eski push/PR kosusunu** iptal eder (eski commit'in sonucu degersiz, macOS kuyrugu yigilmaz).
  `workflow_dispatch` kosulari (telefon-test.sh, elle) benzersiz grupta: hicbir push onu iptal etmez; farkli workflow'lar birbirini iptal etmez.
- Tetikleyici yollar dar: yalniz uygulama klasorleri ve ilgili `qa/**` yollari.
- Android: AVD + snapshot `actions/cache` ile saklanir (`avd-v1-api<N>-...`); ilk kosu onbellegi olusturur, sonrakiler snapshot'tan acilir. API 28/34 matris, paralel.
- Playwright tarayicilari `actions/cache` ile saklanir; pip bagimliliklari `qa/requirements-*.txt` ile onbelleklenir.
- Her is kendi logunda tam raporu basar; `telefon-test.sh` artifact indirmeden okur (artifact indirme bazi ortamlarda engelli).
- iOS runner etiketi `macos_runner` girdisiyle (`QA_MACOS=macos-15|macos-14`) secilebilir.

### iOS simulatoru

`qa/ios/run_sim.py`: `simctl boot` + `bootstatus`, `simctl openurl` ile Mobile Safari'de acar, `simctl io screenshot` ile ekran goruntusu alir,
Safari'nin gercekten acildigini ana ekranla piksel farkindan dogrular ve bos ekrani goruntu analiziyle denetler. **Calisiyor.**
safaridriver + Selenium (`safari:useSimulator`) yolu denendi: "The 'macOS' platform is incompatible with requested capability: safari:useSimulator" hatasiyla reddediliyor (calisma 46037055325); varsayilan kapali (`QA_SAFARIDRIVER=1` ile denenebilir).
Sonuc: simulatorde yalniz **acilis + bos ekran** denetlenir; yolculuk, kalicilik, yazdirma iOS'ta Playwright WebKit'ten gelir.

Tek dosya / ES modül PWA uygulamaları için tamamen ücretsiz, yeniden kullanılabilir otomatik kalite denetimi.
Pilot uygulamalar: Habit Tracker (`habit-tracker-2027/`) ve Daily Budget Planner (`daily-budget-planner/`).

> **Önemli:** Bu sistemde **gerçek cihaz testi YOKTUR.** Sonuçlar üç ortam türünden gelir ve her satırda belirtilir:
> **Masaüstü taklidi** (Playwright; gerçek tarayıcı motoru, taklit mobil görünüm), **Emülatör** (Android emülatörü + Chrome),
> **Gerçek motor/simülatör** (iOS Simülatörü + Mobile Safari). Gerçek iPhone/Android doğrulaması (özellikle iOS yazdırma penceresi,
> dokunma hissi, bildirimler) hâlâ elle yapılmalıdır.

## Ne denetlenir

| Denetim | Öncelik | Açıklama |
|---|---|---|
| Ana yolculuk | P0 | `apps.json` içindeki adımlar baştan sona çalışıyor mu |
| Boş ekran | P0 | Ana içerik alanı boş mu (metin + görünür öğe sayısı; Android/iOS'ta ayrıca ekran görüntüsü analizi) |
| Ana eylem erişilebilir | P0 | Kalıcılık adımındaki ana düğmeye (ör. harcama ekle) gerçekten dokunulabiliyor mu |
| Veri kalıcılığı | P0 | Veri girip sayfayı yenileyince aynı ekran/veri duruyor mu |
| Konsol hataları | P1 | `console.error`, yakalanmamış istisna, HTTP 4xx/5xx |
| Çevrimdışı açılış | P1 | Sunucu kapatılınca (gerçek çevrimdışı) service worker'dan açılıyor mu |
| Yazdırma sayfa sayısı | P1 | Chromium PDF; Letter, A4, 8.5x10.8in kâğıt (iOS'ta 2. sayfa hatasını yakalamak için) |
| Yatay taşma | P2 | Sayfa genişliği ekrandan büyük mü, hangi öğe taşıyor |
| Kırpılmış metin | P3 (uyarı) | `overflow:hidden` ile kesilen metin |
| Dokunma hedefi 44px | P3 (uyarı) | 44x44 CSS px'ten küçük düğme/bağlantı |

Profiller (`profiles.json`): iPhone 13/14/15/16, iPhone 15 yatay, Android 360x640 / 393x851 / 412x915, tablet 768x1024, masaüstü 1280x800.

## Workflow'lar

| Dosya | Runner | Ne yapar | Ortam türü |
|---|---|---|---|
| `qa-web.yml` | ubuntu-latest | Playwright Chromium + Firefox + WebKit, tüm profiller, iki uygulama | Masaüstü taklidi |
| `qa-ios.yml` | macos-latest | (a) Playwright WebKit, iPhone profilleri (b) iOS Simülatörü + Mobile Safari (simctl + safaridriver/Selenium) | Masaüstü taklidi / Gerçek motor/simülatör |
| `qa-android.yml` | ubuntu-latest (KVM) | Android 9 (API 28) ve Android 14 (API 34) emülatörü + Chrome (adb + Chrome DevTools) | Emülatör |

Üçü de `push` (uygulama klasörü ya da `qa/` değişince), `pull_request` ve `workflow_dispatch` ile tetiklenir.
Her çalıştırma **job özetine** GEÇTİ/KALDI tablosu yazar; artifact olarak ekran görüntüleri, hata günlükleri, yeniden üretme adımları,
öncelikli hata listesi ve mobil uyumluluk raporu (`mobil-uyumluluk-raporu.md`, `tum-sonuclar.json`) yüklenir (14 gün saklanır).
Ürün hatası bulunursa (KALDI) çalıştırma kırmızı olur; altyapı hatası (emülatör açılmadı vb.) ayrıca belirgin bir adım hatasıdır.

## Yeni uygulama nasıl eklenir

`qa/apps.json` içindeki `apps` listesine **bir nesne** ekleyin. Başka dosyaya dokunmanız gerekmez:

```json
{
  "id": "autolog",                  // kısa kimlik (workflow girdisinde kullanılır)
  "name": "AutoLog",
  "dir": "autolog",                 // depodaki klasör
  "version_file": "sw.js", "version_regex": "VERSION\\s*=\\s*\"([^\"]+)\"",
  "main": "#screen",                // ana içerik alanının CSS seçicisi (boş ekran denetimi buna bakar)
  "journey": [                      // ana yolculuk; check:true olan adımda yerleşim denetimleri çalışır
    {"label": "Açılış", "wait": "#start", "check": true, "shot": "01-acilis"},
    {"label": "Örnek veri", "click": "#sample"},
    {"label": "Ana ekran", "wait": "#home", "check": true, "shot": "02-ana"}
  ],
  "persistence": {"label": "Kayıt ekle, yenile", "steps": [{"click": "#add"}], "probe": "#screen", "ready": "#home"},
  "offline": {"ready": "#home"},
  "print": [ {"label": "Yazdır", "steps": [{"click": "#print"}], "pages": 1, "papers": ["Letter"]} ]
}
```

Adım alanları: `goto` (`#/yol`), `click` (seçici ya da masaüstü/mobil için seçici listesi `["#tab-x","#nav-x"]`),
`wait`, `waitGone`, `select` (`["#secici","değer"]`), `sleep` (ms), `shot` (ekran görüntüsü adı), `check` (yerleşim denetimi),
`rapid:true` (tık korumasını beklemeden tıkla, ör. tuş takımı). `print` isteğe bağlıdır (tek sayfa vaat eden yazdırmalar için).

Yerelde denemek:

```bash
pip install playwright pypdf pillow && python -m playwright install chromium
python qa/selftest.py                                   # denetimlerin kendisini bozuk örnek sayfalarla sınar
python qa/web/run_web.py --engine chromium --apps budget --profiles iphone-15,masaustu --out qa-out/yerel
python qa/report/make_report.py --in qa-out/yerel --out qa-out/rapor
```

## Elle tetikleme

GitHub > Actions > ilgili workflow (`qa-web`, `qa-ios`, `qa-android`) > **Run workflow**.
Komut satırı: `qa/telefon-test.sh` (önerilen) ya da `gh workflow run qa-web.yml` (`-f apps=habit` tek uygulama, `-f app_ref=19ff9a6` uygulama klasörlerini eski bir commit'ten alıp
o sürümü sınamak için; ör. 1.0.2'nin Android 9 boş ekranını yeniden üretmek). Sonuç: `gh run watch`, `gh run view --log`.
Artifact: Actions sayfasında çalıştırmanın altında ya da `gh run download <id>`.

## Maliyet notu

Bu depo **herkese açık** olduğundan GitHub'ın standart runner'ları (ubuntu-latest, macos-latest) **ücretsizdir**; ek servis, anahtar ya da
secret kullanılmaz. Larger runner kullanılmaz. Depo **özel** yapılırsa dakikalar aylık ücretsiz kotadan düşer ve macOS dakikaları 10 kat
sayıldığı için kısa sürede ücretlenmeye başlanabilir; o durumda önce `qa-ios.yml` kapatılmalı ya da yalnız elle tetiklenmelidir.
Ayrıca depoda `qa/` klasörü GitHub Pages ile birlikte yayınlanır (zararsız, test sayfalarıdır).

## Bilinen sınırlar

- Playwright WebKit gerçek iOS değildir; yazdırma sayfa sayısı yalnız Chromium'da ölçülür (`page.pdf`). iOS yazdırma penceresi gerçek cihazda bakılmalıdır.
- iOS Simülatöründe yalnız açılış ve boş ekran denetlenir (Safari WebDriver simülatörde çalışmıyor).
- Yazdırma sayfa sayısı her kâğıt boyutu için akış baştan başlatılarak ölçülür (afterprint sonrası sahte 2 sayfa kusuru giderildi).
- Android'de tıklamalar DevTools üzerinden JavaScript `click()` ile yapılır (gerçek dokunuş değildir).
- Dokunma hedefi ve kırpılmış metin denetimleri sezgiseldir; "UYARI" olarak raporlanır, çalıştırmayı kırmızı yapmaz.
