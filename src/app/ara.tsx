// 2 · Hedef arama: yer ve durak araması, kategori kısayolları, Ev/İş kaydetme.
//
// İki kaynak birlikte aranır: rota motorundaki duraklar ve uygulamanın içindeki
// OpenStreetMap ilgi noktaları (hastane, okul, eczane, benzinlik, kırtasiye…).
// "eczane" gibi bir kategori adı yazılırsa tek tek isim aramak yerine yakındakiler listelenir.

import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  Keyframe,
  LinearTransition,
  ZoomIn,
  ZoomOut,
} from 'react-native-reanimated';
import { Pressable } from '@/components/dokun';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { KaydirmaliSatir } from '@/components/kaydirmali-satir';
import { GeriCubugu, HataKutusu, Ikon, useStiller, Yukleniyor, type IkonAdi } from '@/components/ulasim';
import { mesafeMetre } from '@/lib/cografya';
import { aramaKaydet, aramalariTemizle, aramaSil, useKayitlar, yerKaydet, type YerTuru } from '@/lib/kayitlar';
import { useKonum } from '@/lib/konum';
import { adTekrariniEle } from '@/lib/istasyon';
import { durakAra, OtpHatasi, type Durak, type Konum } from '@/lib/otp';
import {
  kategoriEslesmesi,
  poiAra,
  poiHazirla,
  poiSimgesi,
  poiTureGore,
  sadelestir,
  type PoiSonuc,
  type PoiTuru,
} from '@/lib/poi';
import { baslikYap, trBuyuk, useTema, yonYaz, type Tema } from '@/lib/tema';
import { mesafeYaz } from '@/lib/zaman';
import { vurus } from '@/lib/dokunsal';
import { geriDon } from '@/lib/gezinti';

type Parametreler = {
  kLat?: string;
  kLon?: string;
  kAd?: string;
  vLat?: string;
  vLon?: string;
  vAd?: string;
  kaydet?: YerTuru;
  /** Rota ekranından gelindiyse hangi alan doldurulacak. Yoksa varış seçiliyor. */
  alan?: 'baslangic' | 'varis';
};

const YER_ADI: Record<YerTuru, string> = { ev: 'Ev', is: 'İş' };

// Boş ekranda "Yakınımda ne var?" kategorileri, gruplu. Çipe dokunmak kategori aramasını
// başlatır: yazı, veritabanındaki türün adıyla ya da adının bir sözcüğüyle aynı olmalı
// ("Benzin" → "Benzin istasyonu"); kategoriEslesmesi böyle eşleştiriyor.
const KATEGORI_GRUPLARI: { ad: string; ogeler: { tur: string; ad: string }[] }[] = [
  {
    ad: 'Sağlık',
    ogeler: [
      { tur: 'eczane', ad: 'Eczane' },
      { tur: 'hastane', ad: 'Hastane' },
      { tur: 'klinik', ad: 'Klinik' },
      { tur: 'dis', ad: 'Diş hekimi' },
      { tur: 'veteriner', ad: 'Veteriner' },
    ],
  },
  {
    ad: 'Yeme içme',
    ogeler: [
      { tur: 'restoran', ad: 'Restoran' },
      { tur: 'kafe', ad: 'Kafe' },
      { tur: 'firin', ad: 'Fırın' },
      { tur: 'bufe', ad: 'Büfe' },
    ],
  },
  {
    ad: 'Alışveriş',
    ogeler: [
      { tur: 'market', ad: 'Market' },
      { tur: 'bakkal', ad: 'Bakkal' },
      { tur: 'avm', ad: 'AVM' },
      { tur: 'pazar', ad: 'Pazar' },
      { tur: 'kitapci', ad: 'Kitapçı' },
      { tur: 'kirtasiye', ad: 'Kırtasiye' },
    ],
  },
  {
    ad: 'Para ve hizmetler',
    ogeler: [
      { tur: 'atm', ad: 'ATM' },
      { tur: 'banka', ad: 'Banka' },
      { tur: 'postane', ad: 'Postane' },
      { tur: 'kuafor', ad: 'Kuaför' },
      { tur: 'polis', ad: 'Polis' },
    ],
  },
  {
    ad: 'Araç',
    ogeler: [
      { tur: 'benzinlik', ad: 'Benzin' },
      { tur: 'sarj', ad: 'Şarj' },
      { tur: 'otopark', ad: 'Otopark' },
      { tur: 'tamirci', ad: 'Oto tamir' },
    ],
  },
  {
    ad: 'Gezi ve spor',
    ogeler: [
      { tur: 'park', ad: 'Park' },
      { tur: 'muze', ad: 'Müze' },
      { tur: 'sinema', ad: 'Sinema' },
      { tur: 'gezi', ad: 'Gezilecek yer' },
      { tur: 'spor_salonu', ad: 'Spor salonu' },
    ],
  },
];
const SON_ARAMA_SINIRI = 5;

type DurakSonucu = Durak & { mesafe: number };

export default function AraEkrani() {
  const kenar = useSafeAreaInsets();
  const tema = useTema();
  const s = useStiller(stiller);
  const p = useLocalSearchParams<Parametreler>();
  const { yerler, favoriYerler, aramalar } = useKayitlar();
  const konum = useKonum();

  const [metin, setMetin] = useState('');
  const [duraklar, setDuraklar] = useState<DurakSonucu[] | null>(null);
  const [yerSonuclari, setYerSonuclari] = useState<PoiSonuc[] | null>(null);
  const [kategori, setKategori] = useState<PoiTuru | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  // Durak araması sunucuda: ulaşılamazsa yerler yine gelir, ama bunu söylemek gerekiyor
  // (eskiden sessizce boş dönüyordu, hiç yer yoksa "sonuç bulunamadı" yazıyordu).
  const [durakHatasi, setDurakHatasi] = useState(false);
  // "Tekrar dene": aynı metinle aramayı yeniden çalıştırır.
  const [deneme, setDeneme] = useState(0);
  // "+6 mahalle daha" ile açılan sokaklar (sade adla); arama değişince kapanır.
  const [acikSokaklar, setAcikSokaklar] = useState<Set<string>>(new Set());
  useEffect(() => setAcikSokaklar(new Set()), [metin]);

  // Aramanın ölçüldüğü nokta: rota başlangıcı verilmişse o, yoksa kullanıcının konumu.
  const merkez = useMemo(() => {
    const lat = Number(p.kLat);
    const lon = Number(p.kLon);
    return Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0
      ? { latitude: lat, longitude: lon }
      : konum.nokta;
  }, [p.kLat, p.kLon, konum.nokta]);

  // Veritabanını ekran açılır açılmaz hazırla; ilk aramada bekleme olmasın.
  useEffect(() => poiHazirla(), []);

  useEffect(() => {
    const aranan = metin.trim();
    if (aranan.length < 3) {
      setDuraklar(null);
      setYerSonuclari(null);
      setKategori(null);
      setHata(null);
      setDurakHatasi(false);
      return;
    }
    const iptal = new AbortController();
    const zamanlayici = setTimeout(async () => {
      setYukleniyor(true);
      try {
        const kat = await kategoriEslesmesi(aranan);
        setKategori(kat);
        let durakAranamadi = false;
        // Yer araması telefonda yapılır, durak araması sunucuya gider: ikisi paralel.
        const [yerler, durakListesi] = await Promise.all([
          kat ? poiTureGore(kat.anahtar, merkez, 25) : poiAra(aranan, merkez, 40),
          durakAra(trBuyuk(aranan), iptal.signal).catch((e) => {
            if (e instanceof OtpHatasi) {
              durakAranamadi = true;
              return [] as Durak[];
            }
            throw e;
          }),
        ]);
        if (iptal.signal.aborted) return;
        setYerSonuclari(yerler);
        setDuraklar(duraklariHazirla(durakListesi, merkez));
        setDurakHatasi(durakAranamadi);
        setHata(null);
      } catch (e) {
        if ((e as Error).name !== 'AbortError' && !iptal.signal.aborted) {
          setHata(e instanceof OtpHatasi ? e.message : 'Arama yapılamadı.');
        }
      } finally {
        setYukleniyor(false);
      }
    }, 300);
    return () => {
      clearTimeout(zamanlayici);
      iptal.abort();
    };
  }, [metin, merkez, deneme]);

  const hedefSec = useCallback(
    async (hedef: Konum, alt?: string) => {
      if (p.kaydet) {
        await yerKaydet(p.kaydet, hedef);
        geriDon();
        return;
      }
      // Seçilen hedef Kayıtlı sekmesindeki "son aramalar" listesine girer.
      aramaKaydet({ ad: hedef.ad, lat: hedef.lat, lon: hedef.lon, alt });
      const secilen = { lat: String(hedef.lat), lon: String(hedef.lon), ad: hedef.ad };
      // Rota ekranından gelindiyse yığında zaten bir rota ekranı var: yenisini üstüne
      // koymak yerine ona dönüp parametrelerini güncelliyoruz, yoksa geri tuşu eski
      // aramayı gösteriyor.
      const git = p.alan ? router.dismissTo : router.replace;
      git({
        pathname: '/rota',
        params:
          p.alan === 'baslangic'
            ? {
                kLat: secilen.lat,
                kLon: secilen.lon,
                kAd: secilen.ad,
                vLat: p.vLat ?? '',
                vLon: p.vLon ?? '',
                vAd: p.vAd ?? '',
              }
            : {
                kLat: p.kLat ?? '',
                kLon: p.kLon ?? '',
                kAd: p.kAd ?? 'Konumum',
                vLat: secilen.lat,
                vLon: secilen.lon,
                vAd: secilen.ad,
              },
      });
    },
    [p.kaydet, p.alan, p.kLat, p.kLon, p.kAd, p.vLat, p.vLon, p.vAd],
  );

  /** Başlangıç seçerken "kendi konumuma dön" kısayolu. */
  const konumaDon = useCallback(() => {
    router.dismissTo({
      pathname: '/rota',
      params: {
        kLat: String(konum.nokta.latitude),
        kLon: String(konum.nokta.longitude),
        kAd: konum.tur === 'gercek' ? 'Konumum' : 'Kadıköy (örnek konum)',
        vLat: p.vLat ?? '',
        vLon: p.vLon ?? '',
        vAd: p.vAd ?? '',
      },
    });
  }, [konum.nokta.latitude, konum.nokta.longitude, konum.tur, p.vLat, p.vLon, p.vAd]);

  const kaydetSor = (hedef: Konum) => {
    vurus();
    // Kayıtlı adresin üstüne yazılacaksa bunu söyle.
    const eskiler = (['ev', 'is'] as YerTuru[])
      .filter((t) => yerler[t])
      .map((t) => `${YER_ADI[t]}: ${baslikYap(yerler[t]!.ad)}`);
    const not = eskiler.length ? `\n\nSeçtiğin, kayıtlı adresin yerine geçer (${eskiler.join(', ')}).` : '';
    Alert.alert(hedef.ad, `Ev ya da İş olarak kaydedilsin mi?${not}`, [
      { text: 'Ev olarak kaydet', onPress: () => yerKaydet('ev', hedef) },
      { text: 'İş olarak kaydet', onPress: () => yerKaydet('is', hedef) },
      { text: 'Vazgeç', style: 'cancel' },
    ]);
  };

  const baslik = p.kaydet
    ? `${YER_ADI[p.kaydet]} adresini seç`
    : p.alan === 'baslangic'
      ? 'Nereden yola çıkıyorsun?'
      : 'Nereye gidiyorsun?';
  const kisa = metin.trim().length < 3;
  // Arama bitmiş olmalı (sonuçlar null değil): yoksa 3. harfte, istek gitmeden bir an
  // "sonuç bulunamadı" yanıp sönüyordu.
  const aramaBitti = yerSonuclari !== null && duraklar !== null;
  const hicSonucYok = !kisa && !yukleniyor && !hata && aramaBitti && yerSonuclari.length === 0 && duraklar.length === 0;
  const bosSonuc = hicSonucYok && !durakHatasi;
  const durakAranamadiKutusu = hicSonucYok && durakHatasi;
  const durakAranamadiSeridi = !kisa && !hata && durakHatasi && (yerSonuclari?.length ?? 0) > 0;

  // Tek bir listede iki bölüm: önce yerler, sonra duraklar.
  type Satir =
    | { tip: 'baslik'; anahtar: string; yazi: string }
    | { tip: 'yer'; anahtar: string; veri: PoiSonuc }
    | { tip: 'dahaFazla'; anahtar: string; ad: string; sayi: number }
    | { tip: 'durak'; anahtar: string; veri: DurakSonucu };

  const satirlar = useMemo<Satir[]>(() => {
    const liste: Satir[] = [];
    // Metro, tramvay, Marmaray istasyonları ve iskeleler en üstte: "Kirazlı" yazan çoğu
    // zaman istasyonu kastediyor, semtin haritadaki orta noktasını değil (o nokta iki
    // istasyonun arasında kalıyor, rota da en yakın ama tuhaf olanına götürüyordu).
    const istasyonlar = kategori ? [] : (duraklar ?? []).filter(istasyonMu);
    const otobusDuraklari = (duraklar ?? []).filter((d) => !istasyonlar.includes(d));
    if (istasyonlar.length) {
      liste.push({ tip: 'baslik', anahtar: 'b-istasyon', yazi: 'İSTASYONLAR VE İSKELELER' });
      for (const d of istasyonlar) liste.push({ tip: 'durak', anahtar: `d${d.gtfsId}`, veri: d });
    }
    // Yerler türüne göre bölümlere ayrılır: adresler, sokaklar, yerler, binalar. Bölümlerin
    // sırası en iyi sonuçlarının sırası: "bağdat cad 312" yazınca önce adres, "kadıköy" yazınca
    // önce yer. Aynı sokak birçok mahallede: ilk üçü, sonra "+N mahalle daha".
    const bolumler = new Map<Bolum, PoiSonuc[]>();
    for (const y of yerSonuclari ?? []) {
      const b = bolumOf(y.tur);
      bolumler.set(b, [...(bolumler.get(b) ?? []), y]);
    }
    for (const [b, ogeler] of bolumler) {
      liste.push({
        tip: 'baslik',
        anahtar: `b-${b}`,
        yazi: b === 'yer' && kategori ? `YAKININDAKİ ${trBuyuk(kategori.ad)}` : BOLUM_ADLARI[b],
      });
      if (b !== 'sokak') {
        for (const y of ogeler.slice(0, BOLUM_SINIRI[b])) liste.push({ tip: 'yer', anahtar: `y${y.id}`, veri: y });
        continue;
      }
      const adlar = new Map<string, PoiSonuc[]>();
      for (const y of ogeler) {
        const a = sadelestir(y.ad);
        adlar.set(a, [...(adlar.get(a) ?? []), y]);
      }
      let yazilan = 0;
      for (const [a, parcalar] of adlar) {
        if (yazilan >= BOLUM_SINIRI.sokak) break;
        const gorunen = acikSokaklar.has(a) ? parcalar : parcalar.slice(0, SOKAK_PARCASI);
        for (const y of gorunen) liste.push({ tip: 'yer', anahtar: `y${y.id}`, veri: y });
        yazilan += gorunen.length;
        if (parcalar.length > gorunen.length) {
          liste.push({ tip: 'dahaFazla', anahtar: `f${a}`, ad: a, sayi: parcalar.length - gorunen.length });
        }
      }
    }
    if (otobusDuraklari.length) {
      liste.push({ tip: 'baslik', anahtar: 'b-durak', yazi: 'DURAKLAR' });
      for (const d of otobusDuraklari) liste.push({ tip: 'durak', anahtar: `d${d.gtfsId}`, veri: d });
    }
    return liste;
  }, [yerSonuclari, duraklar, kategori, acikSokaklar]);

  return (
    <View style={[s.kok, { paddingTop: kenar.top + 4 }]}>
      <View style={s.ust}>
        <GeriCubugu
          baslik={baslik}
          sag={
            p.kaydet ? (
              // Kaydetme modundan normal aramaya dön (geri gitmek aramayı kapatıyordu).
              <Pressable hitSlop={10} onPress={() => router.setParams({ kaydet: undefined })} accessibilityRole="button">
                <Text style={s.vazgec}>Vazgeç</Text>
              </Pressable>
            ) : undefined
          }
        />
        <Animated.View style={s.girdi} entering={GIRDI_GIRISI}>
          <Ikon ad="search" renkKodu={tema.soluk} />
          <TextInput
            id="hedef-arama"
            value={metin}
            onChangeText={setMetin}
            placeholder="Yer, adres ya da durak ara"
            placeholderTextColor={tema.soluk}
            style={s.girdiYazi}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
          />
          {metin.length > 0 && (
            <Animated.View entering={ZoomIn.springify().damping(12)} exiting={ZoomOut.duration(150)}>
              <Pressable hitSlop={10} onPress={() => setMetin('')} accessibilityRole="button" accessibilityLabel="Aramayı temizle">
                <Ikon ad="close-circle" boyut={18} renkKodu={tema.soluk} />
              </Pressable>
            </Animated.View>
          )}
        </Animated.View>
      </View>

      {kisa && (
        <Animated.ScrollView
          entering={FadeInDown.delay(120).duration(320).easing(Easing.out(Easing.cubic))}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{ paddingBottom: kenar.bottom + 20 }}
        >
          {!!p.kaydet && (
            <View style={s.ipucu}>
              <Ikon ad={p.kaydet === 'ev' ? 'home-outline' : 'briefcase-outline'} boyut={16} renkKodu={tema.vurgu} />
              <Text style={s.ipucuYazi}>{`Aradığın yere dokun: ${YER_ADI[p.kaydet]} olarak kaydedilir.`}</Text>
            </View>
          )}
          {p.alan === 'baslangic' && (
            <Pressable style={s.satir} onPress={konumaDon} accessibilityRole="button">
              <View style={s.satirIkon}>
                <Ikon ad="locate" boyut={18} renkKodu={tema.vurgu} />
              </View>
              <View style={s.satirMetin}>
                <Text style={s.satirBaslik}>Konumum</Text>
                <Text style={s.satirAlt}>
                  {konum.tur === 'gercek' ? 'Bulunduğun noktadan yola çık' : 'Konum alınamadı; örnek konum kullanılıyor'}
                </Text>
              </View>
            </Pressable>
          )}

          {/* Haritadan "Buradan yol tarifi" ile gelindi: başlangıç seçilen nokta, varış kendi konumun olabilir. */}
          {!p.kaydet && !p.alan && !!p.kLat && !!p.kAd && p.kAd !== 'Konumum' && (
            <Pressable
              style={s.satir}
              onPress={() =>
                router.replace({
                  pathname: '/rota',
                  params: {
                    kLat: p.kLat ?? '',
                    kLon: p.kLon ?? '',
                    kAd: p.kAd ?? '',
                    vLat: String(konum.nokta.latitude),
                    vLon: String(konum.nokta.longitude),
                    vAd: konum.tur === 'gercek' ? 'Konumum' : 'Kadıköy (örnek konum)',
                  },
                })
              }
              accessibilityRole="button"
            >
              <View style={s.satirIkon}>
                <Ikon ad="locate" boyut={18} renkKodu={tema.vurgu} />
              </View>
              <View style={s.satirMetin}>
                <Text style={s.satirBaslik}>Konumum</Text>
                <Text style={s.satirAlt}>
                  {konum.tur === 'gercek' ? 'Bulunduğun yere dön' : 'Konum alınamadı; örnek konum kullanılıyor'}
                </Text>
              </View>
            </Pressable>
          )}

          {/* Ev ve İş yan yana: yer kazanır, son aramalar ilk bakışta görünür. */}
          {!p.kaydet && (
            <View style={s.evIs}>
              {(['ev', 'is'] as YerTuru[]).map((tur) => {
                const yer = yerler[tur];
                return (
                  <Pressable
                    key={tur}
                    style={s.evIsKart}
                    onPress={() => (yer ? hedefSec(yer) : router.setParams({ kaydet: tur }))}
                    accessibilityRole="button"
                    accessibilityLabel={`${YER_ADI[tur]}: ${yer ? baslikYap(yer.ad) : 'kaydetmek için dokun'}`}
                  >
                    <View style={s.satirIkon}>
                      <Ikon ad={tur === 'ev' ? 'home' : 'briefcase'} boyut={18} renkKodu={tema.vurgu} />
                    </View>
                    <View style={s.satirMetin}>
                      <Text style={s.satirBaslik}>{YER_ADI[tur]}</Text>
                      <Text style={[s.satirAlt, !yer && s.ekleYazi]} numberOfLines={1}>
                        {yer ? baslikYap(yer.ad) : 'Ekle'}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}

          {aramalar.length > 0 && (
            <>
              <View style={s.bolumSatiri}>
                <Text style={[s.bolumBaslik, s.bolumBaslikEsnek]}>SON ARAMALAR</Text>
                <Pressable
                  hitSlop={8}
                  onPress={() =>
                    Alert.alert(
                      'Son aramalar silinsin mi?',
                      `${aramalar.length} arama kaydı silinecek. Ev, İş, favori yerlerin ve durakların yerinde kalır.`,
                      [
                        { text: 'Vazgeç', style: 'cancel' },
                        { text: 'Sil', style: 'destructive', onPress: () => aramalariTemizle() },
                      ],
                    )
                  }
                  accessibilityRole="button"
                  accessibilityLabel="Son aramaların tümünü temizle"
                >
                  <Text style={s.tumu}>Tümünü temizle</Text>
                </Pressable>
              </View>
              {/* Sola kaydırınca silinir. Anahtar kayda bağlı: sıra numarası olsaydı silinen satırın
                  kapanmış yüksekliği alttaki kayda geçerdi. */}
              {aramalar.slice(0, SON_ARAMA_SINIRI).map((a) => (
                <KaydirmaliSatir key={`${a.lat},${a.lon},${a.ad}`} onSil={() => aramaSil(a)} silEtiketi="Aramayı sil">
                  <Pressable
                    style={s.satir}
                    onPress={() => hedefSec({ ad: a.ad, lat: a.lat, lon: a.lon }, a.alt)}
                    accessibilityRole="button"
                  >
                    <View style={[s.satirIkon, s.satirIkonGri]}>
                      <Ikon ad="time-outline" boyut={17} renkKodu={tema.soluk} />
                    </View>
                    <View style={s.satirMetin}>
                      <Text style={s.satirBaslik} numberOfLines={1}>
                        {a.ad}
                      </Text>
                      {!!a.alt && (
                        <Text style={s.satirAlt} numberOfLines={1}>
                          {a.alt}
                        </Text>
                      )}
                    </View>
                    {/* Adı kutuya yazar: aramayı değiştirip yeniden arayabilirsin. */}
                    <Pressable
                      hitSlop={14}
                      onPress={() => setMetin(a.ad)}
                      accessibilityRole="button"
                      accessibilityLabel={`${a.ad} adını arama kutusuna yaz`}
                    >
                      <View style={s.kutuyaYaz}>
                        <Ikon ad="arrow-up-outline" boyut={17} renkKodu={tema.soluk} />
                      </View>
                    </Pressable>
                  </Pressable>
                </KaydirmaliSatir>
              ))}
              {aramalar.length > SON_ARAMA_SINIRI && (
                <Pressable style={s.dahaFazla} onPress={() => router.navigate('/kayitli')} accessibilityRole="button">
                  <Text style={s.dahaFazlaYazi}>+ {aramalar.length - SON_ARAMA_SINIRI} arama daha</Text>
                </Pressable>
              )}
            </>
          )}

          {!p.kaydet && favoriYerler.length > 0 && (
            <>
              <Text style={s.bolumBaslik}>FAVORİ YERLER</Text>
              {favoriYerler.map((y) => (
                <Pressable
                  key={`${y.lat},${y.lon}`}
                  style={s.satir}
                  onPress={() => hedefSec({ ad: y.ad, lat: y.lat, lon: y.lon }, y.alt)}
                  accessibilityRole="button"
                >
                  <View style={s.satirIkon}>
                    <Ikon ad="star" boyut={17} renkKodu={tema.vurgu} />
                  </View>
                  <View style={s.satirMetin}>
                    <Text style={s.satirBaslik} numberOfLines={1}>
                      {y.ad}
                    </Text>
                    {!!y.alt && (
                      <Text style={s.satirAlt} numberOfLines={1}>
                        {y.alt}
                      </Text>
                    )}
                  </View>
                </Pressable>
              ))}
            </>
          )}

          <Text style={s.bolumBaslik}>YAKINDA NE VAR?</Text>
          {KATEGORI_GRUPLARI.map((g) => (
            <View key={g.ad}>
              <Text style={s.grupAdi}>{g.ad}</Text>
              <View style={s.kisayollar}>
                {g.ogeler.map((k) => (
                  <Pressable
                    hitSlop={4}
                    key={k.tur}
                    style={s.kisayol}
                    onPress={() => setMetin(k.ad)}
                    accessibilityRole="button"
                  >
                    <Ikon ad={poiSimgesi(k.tur) as IkonAdi} boyut={15} renkKodu={tema.vurgu} />
                    <Text style={s.kisayolYazi}>{k.ad}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}

          {!p.kaydet && (
            <View style={s.ipucu}>
              <Ikon ad="bulb-outline" boyut={16} renkKodu={tema.soluk} />
              <Text style={s.ipucuYazi}>Bir sonuca basılı tutarsan Ev ya da İş olarak kaydedilir.</Text>
            </View>
          )}
        </Animated.ScrollView>
      )}

      {hata && <HataKutusu mesaj={hata} tekrarDene={() => setDeneme((x) => x + 1)} />}
      {yukleniyor && satirlar.length === 0 && <Yukleniyor metin="Aranıyor…" />}
      {bosSonuc && <Text style={s.bos}>“{metin.trim()}” için sonuç bulunamadı.</Text>}
      {durakAranamadiSeridi && (
        <View style={s.durakSeridi}>
          <Ikon ad="cloud-offline-outline" boyut={16} renkKodu={tema.soluk} />
          <Text style={s.durakSeridiYazi}>Duraklar şu an aranamıyor; yalnız yerler gösteriliyor.</Text>
          <Pressable hitSlop={8} onPress={() => setDeneme((x) => x + 1)} accessibilityRole="button">
            <Text style={s.tekrarYazi}>Tekrar dene</Text>
          </Pressable>
        </View>
      )}
      {durakAranamadiKutusu && (
        <View style={s.durakKutusu}>
          <Text style={s.durakKutusuBaslik}>Duraklar aranamadı</Text>
          <Text style={s.durakKutusuYazi}>
            Sunucuya ulaşılamıyor. Yer ve adres araması internetsiz çalışıyor; durak araması için bağlantı gerekiyor.
          </Text>
          <Pressable hitSlop={8} onPress={() => setDeneme((x) => x + 1)} accessibilityRole="button">
            <Text style={[s.tekrarYazi, { marginTop: 8 }]}>Tekrar dene</Text>
          </Pressable>
        </View>
      )}

      {!kisa && (
        <Animated.FlatList
          data={satirlar}
          // Yazdıkça kalan sonuçlar yerinde kalır ya da kayar, yeniler belirir, düşenler solar.
          itemLayoutAnimation={LinearTransition.duration(220)}
          keyExtractor={(x) => x.anahtar}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{ paddingBottom: kenar.bottom + 20 }}
          renderItem={({ item }) => (
            <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)}>
              {satirCiz(item)}
            </Animated.View>
          )}
        />
      )}
    </View>
  );

  /** VoiceOver'da satırın eylemleri: basılı tutmanın yerine "Ev / İş olarak kaydet". */
  function kaydetmeEylemleri(hedef: Konum) {
    return {
      accessibilityRole: 'button' as const,
      accessibilityActions: [
        { name: 'ev', label: 'Ev olarak kaydet' },
        { name: 'is', label: 'İş olarak kaydet' },
      ],
      onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => {
        const t = e.nativeEvent.actionName;
        if (t === 'ev' || t === 'is') yerKaydet(t, hedef);
      },
    };
  }

  function satirCiz(item: (typeof satirlar)[number]) {
    if (item.tip === 'baslik') return <Text style={s.bolumBaslik}>{item.yazi}</Text>;

    if (item.tip === 'dahaFazla') {
      return (
        <Pressable
          style={s.dahaFazla}
          onPress={() => setAcikSokaklar((x) => new Set(x).add(item.ad))}
          accessibilityRole="button"
        >
          <Text style={s.dahaFazlaYazi}>{`+ ${item.sayi} mahalle daha`}</Text>
        </Pressable>
      );
    }

    if (item.tip === 'yer') {
      const y = item.veri;
      const hedef: Konum = { ad: y.ad, lat: y.lat, lon: y.lon };
      // Adres ve sokakta tür adı yazılmaz: "Bağdat Caddesi · Caddebostan Mah., Kadıköy".
      const tur = y.tur === 'adres' || y.tur === 'sokak' ? '' : y.turAdi;
      return (
        <Pressable
          style={s.satir}
          onPress={() => hedefSec(hedef, [tur, y.semt].filter(Boolean).join(' · '))}
          onLongPress={() => kaydetSor(hedef)}
          {...kaydetmeEylemleri(hedef)}
        >
          <View style={s.satirIkon}>
            <Ikon ad={poiSimgesi(y.tur) as IkonAdi} boyut={18} renkKodu={tema.vurgu} />
          </View>
          <View style={s.satirMetin}>
            <Vurgulu metin={y.ad} aranan={metin} style={s.satirBaslik} renk={tema.vurgu} />
            <Text style={s.satirAlt} numberOfLines={1}>
              {[tur, y.semt, mesafeYaz(y.mesafe)].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <Ikon ad="chevron-forward" boyut={16} renkKodu={tema.yurume} />
        </Pressable>
      );
    }

    const d = item.veri;
    const hedef: Konum = { ad: baslikYap(d.name), lat: d.lat!, lon: d.lon! };
    const istasyon = istasyonMu(d) ? ISTASYON_TURLERI[(d.vehicleMode ?? '').toUpperCase()] : null;
    return (
      <Pressable
        style={s.satir}
        onPress={() => hedefSec(hedef, istasyon?.ad ?? 'Durak')}
        onLongPress={() => kaydetSor(hedef)}
        {...kaydetmeEylemleri(hedef)}
      >
        <View style={[s.satirIkon, { backgroundColor: tema.vurguAcik }]}>
          <Ikon ad={istasyon?.ikon ?? 'bus-outline'} boyut={18} renkKodu={tema.vurgu} />
        </View>
        <View style={s.satirMetin}>
          <Vurgulu metin={hedef.ad} aranan={metin} style={s.satirBaslik} renk={tema.vurgu} />
          <Text style={s.satirAlt} numberOfLines={1}>
            {[istasyon?.ad, mesafeYaz(d.mesafe), istasyon ? '' : yonYaz(d.desc), d.code && !istasyon ? `Durak kodu ${d.code}` : '']
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        <Ikon ad="chevron-forward" boyut={16} renkKodu={tema.yurume} />
      </Pressable>
    );
  }
}

type Bolum = 'adres' | 'sokak' | 'yer' | 'bina';
const BOLUM_ADLARI: Record<Bolum, string> = {
  adres: 'ADRESLER',
  sokak: 'SOKAKLAR VE CADDELER',
  yer: 'YERLER',
  bina: 'BİNALAR VE SİTELER',
};
const BOLUM_SINIRI: Record<Bolum, number> = { adres: 6, sokak: 12, yer: 20, bina: 6 };
/** Aynı adlı sokağın bu kadar mahallesi gösterilir, gerisi "+N mahalle daha". */
const SOKAK_PARCASI = 3;
function bolumOf(tur: string): Bolum {
  if (tur === 'adres') return 'adres';
  if (tur === 'sokak') return 'sokak';
  if (tur === 'bina' || tur === 'apartman' || tur === 'ishani' || tur === 'site') return 'bina';
  return 'yer';
}

/** Arama kutusu ana sayfadaki yerinden (biraz yukarıdan) kendi yerine kayar. */
const GIRDI_GIRISI = new Keyframe({
  0: { transform: [{ translateY: -40 }] },
  100: { transform: [{ translateY: 0 }], easing: Easing.out(Easing.cubic) },
}).duration(320);

/** Sonuç adında aranan harfler vurgulu ("Kadı" → **Kadı**köy). */
function Vurgulu({ metin, aranan, style, renk }: { metin: string; aranan: string; style: object; renk: string }) {
  const q = aranan.trim().toLocaleLowerCase('tr-TR');
  const i = q ? metin.toLocaleLowerCase('tr-TR').indexOf(q) : -1;
  if (i < 0)
    return (
      <Text style={style} numberOfLines={1}>
        {metin}
      </Text>
    );
  return (
    <Text style={style} numberOfLines={1}>
      {metin.slice(0, i)}
      <Text style={{ color: renk, fontWeight: '800' }}>{metin.slice(i, i + q.length)}</Text>
      {metin.slice(i + q.length)}
    </Text>
  );
}

/**
 * Durak sonuçlarını yakınlığa göre sıralar ve aynı yerin tekrarlarını eler.
 *
 * Bir beslemenin içindeki peronları OTP zaten istasyon altında topluyor
 * (veri/durak-birlestir.py); burada kalan iş beslemeler arası tekrar: İETT'nin
 * "MECİDİYEKÖY" durağı ile raylı beslemenin "Mecidiyeköy" istasyonu. Sıralama
 * eleme öncesinde yapılmalı ki en yakın olan kalsın.
 */
/** Raylı sistem istasyonları ve iskeleler: aramada otobüs duraklarından ayrı, en üstte. */
const ISTASYON_TURLERI: Record<string, { ad: string; ikon: IkonAdi }> = {
  SUBWAY: { ad: 'Metro istasyonu', ikon: 'subway-outline' },
  MONORAIL: { ad: 'Metro istasyonu', ikon: 'subway-outline' },
  RAIL: { ad: 'Tren istasyonu', ikon: 'train-outline' },
  TRAM: { ad: 'Tramvay durağı', ikon: 'train-outline' },
  FUNICULAR: { ad: 'Füniküler istasyonu', ikon: 'train-outline' },
  CABLE_CAR: { ad: 'Teleferik istasyonu', ikon: 'train-outline' },
  GONDOLA: { ad: 'Teleferik istasyonu', ikon: 'train-outline' },
  FERRY: { ad: 'İskele', ikon: 'boat-outline' },
};

function istasyonMu(d: Durak): boolean {
  return !!ISTASYON_TURLERI[(d.vehicleMode ?? '').toUpperCase()];
}

function duraklariHazirla(liste: Durak[], merkez: { latitude: number; longitude: number }): DurakSonucu[] {
  // İstasyonlar önce: aynı adlı otobüs durağı (Kirazlı Metro) istasyonun yerine geçmesin ve
  // 15'lik sınıra takılmasın.
  const sirali = liste
    .filter((d) => d.lat != null && d.lon != null)
    .map((d) => ({ ...d, mesafe: mesafeMetre(merkez, { latitude: d.lat!, longitude: d.lon! }) }))
    .sort((a, b) => Number(istasyonMu(b)) - Number(istasyonMu(a)) || a.mesafe - b.mesafe);
  return adTekrariniEle(sirali).slice(0, 15);
}

const stiller = (t: Tema) =>
  StyleSheet.create({
    kok: { flex: 1, backgroundColor: t.zemin },
    ust: {
      backgroundColor: t.yuzey,
      paddingHorizontal: 14,
      paddingBottom: 12,
      gap: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.cizgi,
    },
    girdi: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: t.zemin,
      borderRadius: 12,
      paddingHorizontal: 12,
      height: 46,
    },
    girdiYazi: { flex: 1, fontSize: 16, color: t.yazi },
    bolumBaslik: {
      fontSize: 11.5,
      letterSpacing: 0.8,
      fontWeight: '700',
      color: t.soluk,
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 7,
    },
    satir: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: t.yuzey,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.cizgi,
    },
    satirIkon: {
      width: 34,
      height: 34,
      borderRadius: 10,
      backgroundColor: t.vurguAcik,
      alignItems: 'center',
      justifyContent: 'center',
    },
    satirMetin: { flex: 1, gap: 2 },
    satirIkonGri: { backgroundColor: t.cizgi },
    evIs: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingTop: 4 },
    evIsKart: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 11,
      borderRadius: 14,
      backgroundColor: t.yuzey,
    },
    bolumSatiri: { flexDirection: 'row', alignItems: 'flex-end', paddingRight: 16 },
    bolumBaslikEsnek: { flex: 1 },
    tumu: { fontSize: 13, fontWeight: '700', color: t.vurgu, paddingBottom: 7 },
    // "↖": yukarı ok sola yatırılır (Ionicons'ta çapraz ok yok).
    kutuyaYaz: { transform: [{ rotate: '-45deg' }] },
    grupAdi: { fontSize: 12, fontWeight: '600', color: t.soluk, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
    dahaFazla: {
      paddingLeft: 62,
      paddingVertical: 11,
      backgroundColor: t.yuzey,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.cizgi,
    },
    dahaFazlaYazi: { fontSize: 13.5, fontWeight: '700', color: t.vurgu },
    satirBaslik: { fontSize: 15, fontWeight: '600', color: t.yazi },
    satirAlt: { fontSize: 12.5, color: t.soluk },
    kisayollar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 },
    kisayol: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      height: 36,
      paddingHorizontal: 12,
      borderRadius: 999,
      backgroundColor: t.yuzey,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.cizgi,
    },
    kisayolYazi: { fontSize: 13, fontWeight: '600', color: t.yazi },
    ipucu: { flexDirection: 'row', gap: 8, padding: 16 },
    ipucuYazi: { flex: 1, fontSize: 13, color: t.soluk, lineHeight: 19 },
    vazgec: { fontSize: 15, fontWeight: '600', color: t.vurgu },
    ekleYazi: { color: t.vurgu, fontWeight: '600' },
    durakSeridi: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: 14,
      marginBottom: 6,
      paddingHorizontal: 10,
      paddingVertical: 9,
      borderRadius: 12,
      backgroundColor: t.uyariAcik,
    },
    durakSeridiYazi: { flex: 1, fontSize: 12.5, lineHeight: 17, color: t.yazi },
    tekrarYazi: { fontSize: 13, fontWeight: '700', color: t.vurgu },
    durakKutusu: { margin: 14, padding: 16, borderRadius: 14, backgroundColor: t.uyariAcik, alignItems: 'center' },
    durakKutusuBaslik: { fontSize: 15, fontWeight: '700', color: t.yazi, marginBottom: 4 },
    durakKutusuYazi: { fontSize: 13.5, lineHeight: 19, color: t.yazi, textAlign: 'center' },
    bos: { color: t.soluk, textAlign: 'center', padding: 20 },
  });
