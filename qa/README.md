# UNVERCO mobil QA sistemi

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
Komut satırı: `gh workflow run qa-web.yml` (`-f apps=habit` tek uygulama, `-f app_ref=19ff9a6` uygulama klasörlerini eski bir commit'ten alıp
o sürümü sınamak için; ör. 1.0.2'nin Android 9 boş ekranını yeniden üretmek). Sonuç: `gh run watch`, `gh run view --log`.
Artifact: Actions sayfasında çalıştırmanın altında ya da `gh run download <id>`.

## Maliyet notu

Bu depo **herkese açık** olduğundan GitHub'ın standart runner'ları (ubuntu-latest, macos-latest) **ücretsizdir**; ek servis, anahtar ya da
secret kullanılmaz. Larger runner kullanılmaz. Depo **özel** yapılırsa dakikalar aylık ücretsiz kotadan düşer ve macOS dakikaları 10 kat
sayıldığı için kısa sürede ücretlenmeye başlanabilir; o durumda önce `qa-ios.yml` kapatılmalı ya da yalnız elle tetiklenmelidir.
Ayrıca depoda `qa/` klasörü GitHub Pages ile birlikte yayınlanır (zararsız, test sayfalarıdır).

## Bilinen sınırlar

- Playwright WebKit gerçek iOS değildir; yazdırma sayfa sayısı yalnız Chromium'da ölçülür (`page.pdf`). iOS yazdırma penceresi gerçek cihazda bakılmalıdır.
- iOS Simülatöründe ağ kapatılamaz ve Safari WebDriver konsol günlüğü vermez; çevrimdışı ve konsol denetimleri o satırlarda "ATLANDI" görünür.
- Android'de tıklamalar DevTools üzerinden JavaScript `click()` ile yapılır (gerçek dokunuş değildir).
- Dokunma hedefi ve kırpılmış metin denetimleri sezgiseldir; "UYARI" olarak raporlanır, çalıştırmayı kırmızı yapmaz.
