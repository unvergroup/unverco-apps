# Lora yazi tipi: kaynak ve saglama

Bu klasordeki dort `Lora-*.ttf` dosyasi, yazi tipinin yukari akis deposundaki resmi, DEGISTIRILMEMIS sabit agirlikli dosyalardir.
Hicbiri bu projede uretilmedi, kirpilmadi, alt kumeye indirilmedi ve yeniden adlandirilmadi (OFL "Reserved Font Name Lora").

- Depo: https://github.com/cyrealtype/Lora-Cyrillic
- Surum: 3.021 (dosyalarin `name` tablosunda "Version 3.021; ttfautohint (v1.8.4.7-5d5b)")
- Alinan commit: 2d53b449b60e185b39f671b44fded83e0910ad30 (depo ucu, 22 Kasim 2026; dallar `master` ve `main` ayni dosyalari verir)
- Adres: `https://raw.githubusercontent.com/cyrealtype/Lora-Cyrillic/2d53b449b60e185b39f671b44fded83e0910ad30/fonts/ttf/<dosya>`
- Lisans: SIL Open Font License 1.1 (`OFL.txt`; depodaki OFL.txt ile ayni, satir sonu karakterleri disinda)

| Dosya | Agirlik | Bayt | sha256 |
|---|---|---|---|
| Lora-Regular.ttf | 400 | 198380 | c72a925082ba55885e7b4ead25d34a3c91fa44edda72a16a3a2983fc7fa7cef3 |
| Lora-Medium.ttf | 500 | 224604 | 0342ce54e8f3ce352e01cc056e0c355ec6190b6da2eaad815400211eebba1f9a |
| Lora-SemiBold.ttf | 600 | 218792 | a9f5bbcebb6b53d53b6d7d571b2076f3db4931026693397200f69801b6701a81 |
| Lora-Bold.ttf | 700 | 218640 | 32baf740eac1bf3f257904a6cf89e4e067ca1566b375bf22f743a26fc88b3791 |

Kullanilan agirliklar: 400 (cift adi, tabela govdesi, yemek firmasi tablosu), 500 (yer karti adi), 600 (tabela basligi), 700 (harf basliklari, yemek firmasi basliklari ve toplamlar).
Italik dosya yoktur; yemek firmasi tablosundaki "Not seated" satiri tarayicinin yapay egimiyle yazilir (eski degisken dosya da yalniz dik harfti).

Neden sabit dosyalar: degisken (`fvar`) dosya Chrome'da PDF'e "Type 3" yazi tipi olarak gomuluyordu; baski dukkanlarinin on denetimi bunu reddedebilir.
Sabit dosyalar PDF'te TrueType olarak gomulur (`pdffonts`: "TrueType (CID)").

Kapsam siniri (B12): Lora Latin, Latin Genisletilmis ve Kiril harflerini kapsar; Arapca gibi baska yazi sistemlerinin harflerini kapsamaz. Boyle adlar baskida
aygitin yedek yazi tipiyle cikar (denetimde Arapca adlar PDF'te DejaVuSans'a dustu) ve yazi tipi degistirilmez / eklenmez. Urun bunu Licenses ekraninda tek
cumleyle soyler: "Names in scripts the built-in font does not cover print in your device's fallback font."
