// 2 · Rota sonuçları: nereden–nereye, sıralama seçenekleri ve güzergâh kartları.

import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Platform, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInRight,
  FadeInUp,
  FadeOut,
  FadeOutDown,
  FadeOutLeft,
  FadeOutUp,
  LayoutAnimationConfig,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Pressable } from '@/components/dokun';
import { Blok, Parilti } from '@/components/iskelet';
import { KayanMetin } from '@/components/kayan-metin';
import { ModalSayfa } from '@/components/modal-sayfa';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  BacakZinciri,
  canliRenk,
  CevrimdisiSerit,
  GeriCubugu,
  HataKutusu,
  Ikon,
  NabizNoktasi,
  SureSeridi,
  useStiller,
  type IkonAdi,
  esdegerKodlari,
} from '@/components/ulasim';
import { bacakCanli } from '@/lib/canli';
import { kopruyeIlgiBildir, OtpHatasi, rotaPlanlaYedekli, type Guzergah, type Konum, type RotaTercihi } from '@/lib/otp';
import {
  bacakHatlari,
  benzerleriAyikla,
  esdegerAnahtari,
  gosterimSirasi,
  rotaBolumu,
  rotalariSirala,
  type RotaBolumu,
} from '@/lib/rota-secimi';
import { VASITA_ADLARI, type VasitaTuru } from '@/lib/vasita';
import { rotaSecenekleriKaydet, useKayitlar } from '@/lib/kayitlar';
import { tazeKonum } from '@/lib/konum';
import { useCanliAralik } from '@/lib/canli-aralik';
import { guzergahlariSakla } from '@/lib/secim';
import { ozelGunBul, ozelGunNotu } from '@/lib/ozel-gunler';
import { OZEL_GUNLER } from '@/lib/ozel-gun-verisi';
import { ucretKisa, yolculukUcreti } from '@/lib/ucret';
import { baslikYap, hatEtiketi, useTema, type Tema } from '@/lib/tema';
import {
  gunEtiketi,
  gunTarihi,
  istanbulSaat,
  istanbulSimdi,
  andanSecim,
  istanbulZamanYap,
  saatDakikaYaz,
  secimdenAn,
  saatYaz,
  sureYaz,
} from '@/lib/zaman';
import { secimTiki } from '@/lib/dokunsal';
import { ekranAc } from '@/lib/gezinti';

type Parametreler = { kLat: string; kLon: string; kAd: string; vLat: string; vLon: string; vAd: string };
type Sirali = { g: Guzergah; sira: number };
type Grup = {
  ana: Sirali;
  sonrakiler: Sirali[];
  /** Her araç bacağında ananınki dışındaki eşdeğer hatlar ("97M / 141M"). */
  alternatifler: Guzergah['legs'][number]['route'][][];
  /** Her araç bacağında gruptaki bütün hatlar: detay ekranı "141M de olur" desin. */
  hatlar: Guzergah['legs'][number]['route'][][];
};

const SONRAKI_SAYISI = 3;
/** Ekran açıkken liste bu aralıkla sessizce tazelenir (yalnız "şimdi" aramasında). */
const TAZELEME_MS = 60_000;
/** Kartlar yer değiştirince (tazelemede sıra değişti) yaylı kayar. */
const KART_YERLESIMI = LinearTransition.springify().damping(20).stiffness(180);

/** Zaman seçiminde kaç gün ileri gidilebilir (bugün dahil). */
const GUN_SAYISI = 7;
const DAKIKALAR = [0, 15, 30, 45];

/** Rota motoruna gönderilen arama tercihleri. */
const TERCIHLER: { anahtar: RotaTercihi; ad: string; kisa: string; aciklama: string; simge: IkonAdi }[] = [
  {
    anahtar: 'dengeli',
    ad: 'Önerilen',
    kisa: 'Önerilen',
    aciklama:
      'Süre, yürüme ve aktarma birlikte tartılır. Trafiğe takılmayan metro, Marmaray, tramvay ve vapur biraz öne alınır.',
    simge: 'sparkles-outline',
  },
  {
    anahtar: 'hizli',
    ad: 'En hızlı',
    kisa: 'En hızlı',
    aciklama: 'Yalnız varış süresine bakılır. Liste süreye göre sıralanır.',
    simge: 'flash-outline',
  },
  {
    anahtar: 'azYurume',
    ad: 'Az yürüyeyim',
    kisa: 'Az yürüme',
    aciklama: 'Yürüme rota motorunda daha maliyetli sayılır ve liste yürüme süresine göre sıralanır.',
    simge: 'walk-outline',
  },
  {
    anahtar: 'azAktarma',
    ad: 'Az aktarma yapayım',
    kisa: 'Az aktarma',
    aciklama: 'Her aktarma 15 dakikalık ceza sayılır ve liste aktarma sayısına göre sıralanır.',
    simge: 'git-compare-outline',
  },
  {
    anahtar: 'rayli',
    ad: 'Raylı sistem ve vapur',
    kisa: 'Raylı öncelikli',
    aciklama: 'Metro, Marmaray, tramvay ve vapur tercih edilir; otobüs ancak belirgin biçimde kısaysa seçilir.',
    simge: 'subway-outline',
  },
];

/**
 * Kullanıcının seçtiği zaman. null ise "şimdi yola çıkıyorum".
 * tur 'varis' ise saat, hedefte en geç olunması gereken an ("9:00'da orada olmalıyım").
 */
type ZamanTuru = 'kalkis' | 'varis';
type ZamanSecimi = { tur: ZamanTuru; gun: number; saat: number; dakika: number } | null;


function binisSaati(g: Guzergah): string | null {
  const ilk = g.legs.find((b) => b.transitLeg);
  return ilk ? (ilk.start.estimated?.time ?? ilk.start.scheduledTime) : g.start;
}

/**
 * Aynı duraktan binip aynı durakta inen güzergâhlar tek kart: aynı hattın sonraki
 * kalkışları da, aynı yolu giden başka hatlar da ("97M / 141M › 41ST", Moovit gibi).
 * Kartta en erken kalkan; öbürleri "sonraki kalkışlar"da. Yalnız yürüyüş kendi başına.
 */
function gruplandir(guzergahlar: Guzergah[]): Grup[] {
  const gruplar = new Map<string, Sirali[]>();
  guzergahlar.forEach((g, sira) => {
    const anahtar = esdegerAnahtari(g);
    gruplar.set(anahtar, [...(gruplar.get(anahtar) ?? []), { g, sira }]);
  });
  return [...gruplar.values()].map((liste) => {
    // Aynı hatla aynı anda binen iki güzergâh (rota motoru bazen sonrasını farklı yürüyüşle
    // ikinci kez veriyor) tek kalkış: varışı erken olan kalır. Yoksa "M3 21:26" iki kez
    // çıkıyor, hap anahtarları da çakışıyordu (React: two children with the same key).
    const binis = (x: Sirali) => `${x.g.legs.find((b) => b.transitLeg)?.route?.shortName ?? ''}|${binisSaati(x.g) ?? ''}`;
    const enIyi = new Map<string, Sirali>();
    for (const x of liste) {
      const o = enIyi.get(binis(x));
      if (!o || Date.parse(x.g.end ?? '') < Date.parse(o.g.end ?? '')) enIyi.set(binis(x), x);
    }
    const siralanmis = [...enIyi.values()].sort((a, b) => Date.parse(a.g.start ?? '') - Date.parse(b.g.start ?? ''));
    const ana = siralanmis[0];
    const hatlar = bacakHatlari(siralanmis.map((x) => x.g));
    const anaHatlari = ana.g.legs.filter((b) => b.transitLeg).map((b) => b.route?.shortName);
    const alternatifler = hatlar.map((liste, k) => liste.filter((r) => r?.shortName !== anaHatlari[k]));
    return { ana, sonrakiler: siralanmis.slice(1, 1 + SONRAKI_SAYISI), alternatifler, hatlar };
  });
}



/** Önerilen listedeki bölüm başlıkları (Moovit'teki gibi). */
const BOLUM_BASLIKLARI: Record<Exclude<RotaBolumu, 'genel'>, string> = {
  trafiksiz: 'TRAFİĞE GİRMEYEN GÜZERGÂHLAR',
  minibus: 'MİNİBÜS VE DOLMUŞ',
};

// Rota motorunun İngilizce hata kodları için Türkçe açıklamalar.
const HATA_METINLERI: Record<string, string> = {
  NO_TRANSIT_CONNECTION: 'Bu iki nokta arasında toplu taşıma bağlantısı bulunamadı.',
  NO_TRANSIT_CONNECTION_IN_SEARCH_WINDOW: 'Seçilen saatte uygun sefer yok. Biraz sonra tekrar dene.',
  OUTSIDE_SERVICE_PERIOD: 'Seçilen tarih, sefer tarifesinin kapsamı dışında.',
  OUTSIDE_BOUNDS: 'Seçilen nokta haritanın kapsamı dışında.',
  LOCATION_NOT_FOUND: 'Başlangıç ya da varış noktası yol ağına bağlanamadı. Yakındaki bir durağı seçmeyi dene.',
  NO_STOPS_IN_RANGE: 'Yürüme mesafesinde durak bulunamadı.',
  WALKING_BETTER_THAN_TRANSIT: 'Bu mesafe için yürümek toplu taşımadan daha hızlı.',
};

export default function RotaEkrani() {
  const kenar = useSafeAreaInsets();
  const tema = useTema();
  const s = useStiller(stiller);
  const p = useLocalSearchParams<Parametreler>();
  const [guzergahlar, setGuzergahlar] = useState<Guzergah[] | null>(null);
  const [bilgi, setBilgi] = useState<string | null>(null);
  /** Rota yok çünkü Ayarlar'da kapatılan türler olmadan gidilemiyor. */
  const [kapaliUyarisi, setKapaliUyarisi] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [cevrimdisi, setCevrimdisi] = useState<number | null>(null);
  const [aramaSaati, setAramaSaati] = useState(istanbulSaat());
  const [zaman, setZaman] = useState<ZamanSecimi>(null);
  // Aranan gün bayram ya da resmî tatilse: hangi tarife, neler ücretsiz.
  const ozelGun = ozelGunBul(
    OZEL_GUNLER,
    zaman ? Date.parse(istanbulZamanYap(zaman.gun, zaman.saat, zaman.dakika)) : Date.now(),
  );
  const [zamanAcik, setZamanAcik] = useState(false);
  const [taslak, setTaslak] = useState<{ tur: ZamanTuru; gun: number; saat: number; dakika: number }>({
    tur: 'kalkis',
    gun: 0,
    saat: 8,
    dakika: 0,
  });

  const { ucretTuru, rotaSecenekleri: kayitliSecenekler, yuklendi } = useKayitlar();
  // Kayıtlar her okunuşta yeni bir nesne geliyor (bir favori eklenince bile); aramayı
  // yalnız tercihin kendisi değişince yenile. Eskiden ekran her açılışta iki kez arıyordu:
  // önce varsayılanla, kayıt okununca bir daha.
  const { tercih, erisilebilir } = kayitliSecenekler;
  // Kapalı vasıta türleri (Ayarlar) her okumada yeni dizi; içeriği değişince yenilensin.
  const kapaliAnahtar = kayitliSecenekler.kapali.join(',');
  const rotaSecenekleri = useMemo(
    () => ({ tercih, erisilebilir, kapali: kapaliAnahtar ? (kapaliAnahtar.split(',') as VasitaTuru[]) : [] }),
    [tercih, erisilebilir, kapaliAnahtar],
  );
  const [tercihAcik, setTercihAcik] = useState(false);
  const nereden: Konum = useMemo(() => ({ ad: p.kAd ?? 'Konumum', lat: Number(p.kLat), lon: Number(p.kLon) }), [p.kAd, p.kLat, p.kLon]);
  const nereye: Konum = useMemo(() => ({ ad: p.vAd ?? 'Hedef', lat: Number(p.vLat), lon: Number(p.vLon) }), [p.vAd, p.vLat, p.vLon]);

  // Yalnız en son aramanın sonucu ekrana yazılır. Konum ilk açılışta bir kez daha
  // inceldiğinde arama yeniden başlıyor; öncekinin geç gelen hatası yenisinin
  // sonuçlarının üstüne kırmızı kutu olarak düşüyordu.
  const sonArama = useRef(0);
  // Liste ekrandayken yapılan tazeleme (dakikalık ya da aşağı çekince) listeyi silmez;
  // sonuç gelince kartlar yerinde güncellenir, değişen saatler kayar ve renklenir.
  const listeVar = useRef(false);
  listeVar.current = !!guzergahlar?.length;
  const [sessizGeldi, setSessizGeldi] = useState(false);

  const ara = useCallback(
    async (sinyal?: AbortSignal, sessizIstendi = false) => {
      const no = ++sonArama.current;
      const eski = () => no !== sonArama.current || !!sinyal?.aborted;
      if ([nereden.lat, nereden.lon, nereye.lat, nereye.lon].some((d) => !Number.isFinite(d))) {
        setHata('Başlangıç ya da varış noktası eksik. Geri dönüp tekrar seç.');
        return;
      }
      const sessiz = sessizIstendi && listeVar.current;
      if (!sessiz) {
        setGuzergahlar(null);
        setHata(null);
        setBilgi(null);
        setKapaliUyarisi(false);
        // Çevrimdışı şeridi sonuç gelene kadar kalır: arada silinirse "bağlantı geri geldi"
        // diye yanlış bir an gösterirdi.
      }
      setAramaSaati(istanbulSaat());
      try {
        const aramaZamani = zaman
          ? { tur: zaman.tur, an: istanbulZamanYap(zaman.gun, zaman.saat, zaman.dakika) }
          : { tur: 'kalkis' as const, an: istanbulSimdi() };
        // "Konumum" başlangıcı: önceki ekranın aldığı nokta eskimiş ya da kaba olabilir
        // (evde açılıp sokakta aranan rota). Başlangıç bulunulan yer olsun diye o an yeniden soruluyor.
        let baslangic = nereden;
        if (nereden.ad === 'Konumum') {
          const simdiki = await tazeKonum();
          if (eski()) return;
          if (simdiki) baslangic = { ...nereden, lat: simdiki.latitude, lon: simdiki.longitude };
        }
        if (__DEV__) {
          // Geliştirirken: aynı aramayı bilgisayarda tanı aracıyla tekrarlamak için hazır komut.
          const saat = aramaZamani.an.slice(11, 16);
          console.log(
            `[rota] npm run rota-tani -- ${baslangic.lat.toFixed(5)},${baslangic.lon.toFixed(5)} ${nereye.lat.toFixed(5)},${nereye.lon.toFixed(5)} ${rotaSecenekleri.tercih} ${saat}`,
          );
        }
        const sonuc = await rotaPlanlaYedekli(baslangic, nereye, aramaZamani, rotaSecenekleri, sinyal);
        if (eski()) return;
        // Sessiz tazelemede sonuç boşsa (bağlantı koptu, sefer bitti) eldeki liste kalır.
        if (sessiz && sonuc.guzergahlar.length === 0) return;
        setSessizGeldi(sessiz);
        setGuzergahlar(sonuc.guzergahlar);
        if (sessiz) {
          setHata(null);
          setBilgi(null);
          setKapaliUyarisi(false);
        }
        // Listedeki otobüs hatlarını canlı veri köprüsüne bildir: otobüsleri birkaç dakika
        // içinde tanınır, kartlar ve yolculuk ekranı tarife yerine canlı saati gösterir.
        kopruyeIlgiBildir(
          sonuc.guzergahlar.flatMap((g) =>
            g.legs.filter((b) => b.transitLeg && (b.mode ?? '').toUpperCase() === 'BUS').map((b) => b.route?.shortName),
          ),
        );
        setCevrimdisi(sonuc.cevrimdisi);
        if (sonuc.guzergahlar.length === 0 && sonuc.kapaliYuzunden) {
          setKapaliUyarisi(true);
        } else if (sonuc.guzergahlar.length === 0) {
          const kod = sonuc.hatalar[0]?.code;
          const temel = (kod && HATA_METINLERI[kod]) ?? 'Bu saatte uygun bir rota bulunamadı.';
          // Tercihler sonucu daraltmış olabilir; kullanıcı neyi gevşetebileceğini bilsin.
          const ipucu = rotaSecenekleri.erisilebilir
            ? ' Basamaksız güzergâh açık; kapatırsan daha çok seçenek çıkabilir.'
            : rotaSecenekleri.tercih !== 'dengeli'
              ? ' Rota tercihini "Önerilen"e almayı deneyebilirsin.'
              : '';
          setBilgi(temel + ipucu);
        } else if (sonuc.yurumeAsildi) {
          setBilgi('20 dakikadan az yürümeli bir rota bulunamadı; en az yürüyenler gösteriliyor.');
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError' || eski()) return;
        // Sessiz tazeleme başarısızsa eldeki liste kalır, hata kutusu çıkmaz.
        if (sessiz) return;
        setHata(e instanceof OtpHatasi ? e.message : 'Rota aranırken beklenmeyen bir sorun oluştu.');
      }
    },
    [nereden, nereye, zaman, rotaSecenekleri],
  );

  useEffect(() => {
    if (!yuklendi) return;
    const iptal = new AbortController();
    ara(iptal.signal);
    return () => iptal.abort();
  }, [ara, yuklendi]);

  // Ekran açıkken dakikada bir sessiz tazeleme: canlı saatler, geçen kalkışlar. İleri bir
  // saat için aranmışsa gerek yok; ekran arkadayken çalışmaz (useCanliAralik).
  useCanliAralik(() => ara(undefined, true), TAZELEME_MS, yuklendi && !zaman && !!guzergahlar?.length);

  const gruplar = useMemo(() => {
    if (!guzergahlar) return [];
    const liste = gruplandir(guzergahlar);
    // Sıralama ayrı bir seçim değil: seçilen tercihin karşılığı. "Az yürüme" diyen biri
    // listenin de yürümeye göre sıralanmasını bekler (rota-secimi.ts).
    // Aynı hatlarla birkaç dakika arayla kalkan neredeyse aynı seçeneklerden yalnız en iyisi.
    const sirali = gosterimSirasi(
      benzerleriAyikla(
        rotalariSirala(
          liste.map((x) => x.ana.g),
          rotaSecenekleri.tercih,
          rotaSecenekleri.kapali,
        ),
      ),
      rotaSecenekleri.tercih,
    );
    return sirali.map((g) => liste.find((x) => x.ana.g === g)!);
  }, [guzergahlar, rotaSecenekleri.tercih, rotaSecenekleri.kapali]);


  /** Başlangıç ya da varış alanına dokununca arama ekranı açılır; seçim buraya geri döner. */
  const yerSec = (alan: 'baslangic' | 'varis') =>
    ekranAc({
      pathname: '/ara',
      params: {
        alan,
        kLat: p.kLat ?? '',
        kLon: p.kLon ?? '',
        kAd: p.kAd ?? '',
        vLat: p.vLat ?? '',
        vLon: p.vLon ?? '',
        vAd: p.vAd ?? '',
      },
    });

  // Değiştir düğmesi her basışta yarım tur döner.
  const degistirAci = useSharedValue(0);
  const degistirStili = useAnimatedStyle(() => ({ transform: [{ rotate: `${degistirAci.value}deg` }] }));
  const yerDegistir = () =>
    router.setParams({ kLat: p.vLat, kLon: p.vLon, kAd: p.vAd, vLat: p.kLat, vLon: p.kLon, vAd: p.kAd });

  // Ücret hesabı bacak dizisine bakıyor; kart başına bir kez hesaplanıp saklanıyor.
  const ucretler = useMemo(() => {
    const tablo: Record<number, string> = {};
    for (const { ana, sonrakiler } of gruplar) {
      for (const { g, sira } of [ana, ...sonrakiler]) {
        tablo[sira] = ucretKisa(yolculukUcreti(g.legs, ucretTuru, OZEL_GUNLER));
      }
    }
    return tablo;
  }, [gruplar, ucretTuru]);

  const detayaGit = (sira: number, hatlar: Grup['hatlar']) => {
    if (!guzergahlar) return;
    guzergahlariSakla(guzergahlar);
    // Seçilen kalkışın kendi hattı dışındaki eşdeğer hatlar, bacak bacak: "141M|41Ş,41E".
    const kendi = guzergahlar[sira]?.legs.filter((b) => b.transitLeg).map((b) => b.route?.shortName) ?? [];
    const esdeger = hatlar
      .map((liste, k) => esdegerKodlari(liste.filter((r) => r?.shortName !== kendi[k]), 99).join(','))
      .join('|');
    ekranAc({
      pathname: '/rota-detay',
      params: { sira: String(sira), hedef: nereye.ad, ...(esdeger.replace(/\|/g, '') ? { esdeger } : {}) },
    });
  };

  return (
    <View style={s.kok}>
      <View style={[s.ust, { paddingTop: kenar.top + 4 }]}>
        <GeriCubugu baslik="Rota seçenekleri" />
        <View style={s.nerede}>
          <View style={s.noktalar}>
            <View style={s.baslangicNokta} />
            <View style={s.kesik} />
            <View style={s.bitisNokta} />
          </View>
          <View style={{ flex: 1, gap: 6 }}>
            {/* Değiştirince adresler birbirinin üstünden kayarak yer değiştirir: üstteki yeni
                ad aşağıdan, alttaki yukarıdan gelir. */}
            <Pressable style={s.alanKutu} onPress={() => yerSec('baslangic')} accessibilityRole="button" accessibilityLabel="Başlangıcı değiştir">
              <Animated.Text
                key={`k-${nereden.ad}`}
                entering={FadeInDown.duration(300)}
                exiting={FadeOutDown.duration(220)}
                style={s.alan}
                numberOfLines={1}
              >
                {baslikYap(nereden.ad)}
              </Animated.Text>
            </Pressable>
            <Pressable style={s.alanKutu} onPress={() => yerSec('varis')} accessibilityRole="button" accessibilityLabel="Varışı değiştir">
              <Animated.Text
                key={`v-${nereye.ad}`}
                entering={FadeInUp.duration(300)}
                exiting={FadeOutUp.duration(220)}
                style={s.alan}
                numberOfLines={1}
              >
                {baslikYap(nereye.ad)}
              </Animated.Text>
            </Pressable>
          </View>
          <Pressable
            hitSlop={4}
            style={s.degistir}
            onPress={() => {
              degistirAci.value = withSpring(degistirAci.value + 180, { damping: 14, stiffness: 180 });
              yerDegistir();
            }}
            accessibilityLabel="Başlangıç ve varışı değiştir"
          >
            <Animated.View style={degistirStili}>
              <Ikon ad="swap-vertical" boyut={18} renkKodu={tema.soluk} />
            </Animated.View>
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filtreler}>
          <Pressable hitSlop={6}
            style={[s.filtre, s.filtreKoyu]}
            onPress={() => {
              setTaslak(
                zaman ?? {
                  tur: 'kalkis',
                  gun: 0,
                  saat: Number(istanbulSaat().slice(0, 2)),
                  dakika: Number(istanbulSaat().slice(3, 5)),
                },
              );
              setZamanAcik(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Kalkış ya da varış zamanını seç"
          >
            <Text style={[s.filtreYazi, { color: tema.zemin }]}>
              {zaman
                ? `${gunEtiketi(zaman.gun, true)} · ${zaman.tur === 'varis' ? 'varış ' : ''}${saatDakikaYaz(zaman.saat, zaman.dakika)}`
                : `Şimdi · ${aramaSaati}`}
            </Text>
          </Pressable>
          <Pressable hitSlop={6}
            style={[s.filtre, s.filtreSecili]}
            onPress={() => setTercihAcik(true)}
            accessibilityRole="button"
            accessibilityLabel="Rota tercihlerini değiştir"
          >
            <Text style={[s.filtreYazi, { color: tema.vurgu }]}>{tercihEtiketi(rotaSecenekleri)}</Text>
          </Pressable>
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={[s.sonuclar, { paddingBottom: kenar.bottom + 20 }]}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => ara(undefined, true)} tintColor={tema.vurgu} />}
      >
        <CevrimdisiSerit zaman={cevrimdisi} tekrarDene={() => ara()} />
        {hata && <HataKutusu mesaj={hata} tekrarDene={() => ara()} />}
        {!hata && !guzergahlar && <IskeletListesi />}
        {bilgi && <Text style={s.bilgi}>{bilgi}</Text>}
        {kapaliUyarisi && (
          <View style={s.kapaliUyari}>
            <View style={s.kapaliUyariUst}>
              <Ikon ad="alert-circle-outline" boyut={20} renkKodu={tema.uyari} />
              <Text style={s.kapaliUyariBaslik}>Kapalı vasıta türleri yüzünden rota yok</Text>
            </View>
            <Text style={s.kapaliUyariYazi}>
              {`Bu yolculuk ancak kapattığın türlerle yapılabiliyor: ${rotaSecenekleri.kapali
                .map((t) => VASITA_ADLARI[t])
                .join(', ')}. Vasıta tercihlerinden birini açarsan rotalar görünür.`}
            </Text>
            <Pressable style={s.kapaliUyariDugme} onPress={() => router.navigate('/ayarlar')} accessibilityRole="button">
              <Text style={s.kapaliUyariDugmeYazi}>Vasıta tercihlerini aç</Text>
            </Pressable>
          </View>
        )}
        {ozelGun && (
          <View style={s.ozelGun} accessible accessibilityLabel={ozelGunNotu(ozelGun)}>
            <Ikon ad="flag-outline" boyut={16} renkKodu={tema.vurgu} />
            <Text style={s.ozelGunYazi}>{ozelGunNotu(ozelGun)}</Text>
          </View>
        )}
        {/* Yeni aramada liste silinirken kartlar çıkış animasyonu oynatmasın. */}
        {!!guzergahlar && (
        <LayoutAnimationConfig skipExiting>
        {gruplar.map(({ ana: { g, sira }, sonrakiler, alternatifler, hatlar }, i) => {
          const cokHatli = alternatifler.some((a) => a.length > 0);
          const ilkArac = g.legs.find((b) => b.transitLeg);
          const dengeli = rotaSecenekleri.tercih === 'dengeli';
          const oneri = i === 0 && dengeli;
          // Önerilende geri kalanlar bölüm bölüm (Moovit gibi): trafiğe girmeyenler ve
          // minibüslüler kendi başlığı altında. Başlık bölüm değişince bir kez.
          const bolum = dengeli && i > 0 ? rotaBolumu(g) : null;
          const oncekiBolum = dengeli && i > 1 ? rotaBolumu(gruplar[i - 1].ana.g) : null;
          const baslik = bolum && bolum !== 'genel' && bolum !== oncekiBolum ? BOLUM_BASLIKLARI[bolum] : null;
          const etiket = oneri ? 'ÖNERİLEN' : null;
          return (
            <Animated.View
              // Aynı yol (aynı biniş ve iniş, aynı hatlar) tazelemede aynı kart kalır.
              key={esdegerAnahtari(g)}
              entering={
                sessizGeldi
                  ? FadeIn.duration(300)
                  : FadeInDown.delay(60 + Math.min(i, 8) * 60)
                      .duration(380)
                      .easing(Easing.out(Easing.cubic))
              }
              exiting={FadeOut.duration(200)}
              layout={KART_YERLESIMI}
            >
            {baslik && <Text style={s.bolumBaslik}>{baslik}</Text>}
            <Pressable style={[s.kart, oneri && s.kartOneri]} onPress={() => detayaGit(sira, hatlar)}>
              <View style={s.kartUst}>
                <KayanMetin metin={sureYaz(g.duration)} style={s.sure} />
                {etiket ? (
                  <Text style={s.etiket}>{etiket}</Text>
                ) : (
                  <KayanMetin metin={`${saatYaz(g.start)}–${saatYaz(g.end)}`} style={s.saat} />
                )}
              </View>
              <BacakZinciri bacaklar={g.legs} alternatifler={alternatifler} />
              <SureSeridi bacaklar={g.legs} akar gecikme={sessizGeldi ? 0 : 200 + Math.min(i, 8) * 60} />
              <View style={s.kartAlt}>
                {etiket && <KayanMetin metin={`${saatYaz(g.start)}–${saatYaz(g.end)}`} style={[s.altYazi, s.kalin]} />}
                <Text style={s.altYazi}>{sureYaz(g.walkTime)} yürüme</Text>
                <Text style={s.altYazi}>{g.numberOfTransfers === 0 ? 'Aktarmasız' : `${g.numberOfTransfers} aktarma`}</Text>
                {ucretler[sira] && <Text style={[s.altYazi, s.ucret]}>{ucretler[sira]}</Text>}
              </View>
              {ilkArac &&
                (() => {
                  const canli = bacakCanli(ilkArac.start.scheduledTime, ilkArac.start.estimated?.time);
                  const saat = saatYaz(ilkArac.start.estimated?.time ?? ilkArac.start.scheduledTime);
                  // Aynı yolu giden başka hatlar da varsa hepsi yazılır ve "ilk gelene bin" denir:
                  // rozetteki "97M / 141M" ikisinden birinin seçileceğini söylüyor.
                  const ilkEk = esdegerKodlari(alternatifler[0], 99);
                  const hatlarYazisi = ilkEk.length
                    ? [hatEtiketi(ilkArac.route?.shortName, ilkArac.route?.mode ?? ilkArac.mode, ilkArac.route?.agency?.name).rozet, ...ilkEk].join(' ya da ')
                    : hatYazisi(ilkArac);
                  const bas = `${hatlarYazisi} · ${baslikYap(ilkArac.from.name)} durağından `;
                  const ilkGelen = ilkEk.length ? ' · hangisi önce gelirse' : '';
                  if (!canli) {
                    // Otobüsün ara duraklardaki saati İETT tarifesinde yok, uç duraklardan
                    // tahmin ediliyor: canlı veri gelmemişse saat yaklaşık olarak yazılır.
                    const otobus = (ilkArac.mode ?? '').toUpperCase() === 'BUS';
                    return (
                      <Text style={s.ilkArac}>
                        {bas}
                        {otobus ? `~${saat}` : saat}
                        {ilkGelen}
                        {otobus && <Text style={s.tarifeNotu}> · tarifeye göre</Text>}
                      </Text>
                    );
                  }
                  const renk = canliRenk(canli.sinif, tema);
                  // İlk bacak canlıyken sonraki araçların hangisinin tahmin olduğunu söyle.
                  const tarifeli = g.legs.filter((b) => b.transitLeg && b !== ilkArac && !b.start.estimated);
                  return (
                    <CanliVurgu
                      kimlik={ilkArac.trip?.gtfsId ?? null}
                      an={Date.parse(ilkArac.start.estimated?.time ?? ilkArac.start.scheduledTime ?? '')}
                    >
                    <View style={s.canliBlok}>
                      <View style={s.canliSatir}>
                        <NabizNoktasi renk={renk} />
                        <Text style={[s.ilkArac, s.esnek]} numberOfLines={2}>
                          {bas}
                          <Text style={{ color: renk, fontWeight: '700' }}>{`${saat} · ${canli.metin}`}</Text>
                          {ilkGelen}
                        </Text>
                      </View>
                      {tarifeli.length > 0 && (
                        <Text style={s.tarifeNotu} numberOfLines={1}>
                          {`${[...new Set(tarifeli.map((b) => hatEtiketi(b.route?.shortName, b.route?.mode ?? b.mode, b.route?.agency?.name).rozet))].join(', ')} aktarması tarifeye göre`}
                        </Text>
                      )}
                    </View>
                    </CanliVurgu>
                  );
                })()}
              {sonrakiler.length > 0 && (
                <View style={s.sonraki}>
                  <Text style={s.sonrakiBaslik}>{ilkArac ? 'AYNI YOLDA SONRAKİ KALKIŞLAR' : 'SONRAKİ SEÇENEKLER'}</Text>
                  <View style={s.hapiSatiri}>
                    {sonrakiler.map((x) => {
                      const saat = binisSaati(x.g);
                      // Hapın altında bu kalkışla varış saati. Eskiden "şimdiden kaç dakika
                      // sonra" yazıyordu; ileri bir saat için arandığında "6 sa 30 dk" gibi
                      // anlamsız bir sayı çıkıyordu.
                      const varis = x.g.end ? saatYaz(x.g.end) : null;
                      // Birden çok hat aynı yolu gidiyorsa kalkışın hangi hatla olduğu.
                      const hat = cokHatli ? x.g.legs.find((b) => b.transitLeg)?.route?.shortName : null;
                      return (
                        <Animated.View
                          // Geçen kalkış sola çekilip kaybolur, yenisi sağdan gelir.
                          key={`${hat ?? ''}${saat ?? x.sira}`}
                          entering={sessizGeldi ? FadeInRight.duration(300) : undefined}
                          exiting={FadeOutLeft.duration(220)}
                          layout={LinearTransition.duration(300)}
                        >
                        <Pressable hitSlop={5}
                          style={s.hap}
                          onPress={() => detayaGit(x.sira, hatlar)}
                          accessibilityRole="button"
                          accessibilityLabel={`${hat ? `${hat}, ` : ''}${saatYaz(saat)} kalkışı${varis ? `, varış ${varis}` : ''}. Detayını aç`}
                        >
                          {hat && <Text style={s.hapHat}>{hat}</Text>}
                          <Text style={s.hapSaat}>{saatYaz(saat)}</Text>
                          {varis && <Text style={s.hapDakika}>{`varış ${varis}`}</Text>}
                        </Pressable>
                        </Animated.View>
                      );
                    })}
                  </View>
                </View>
              )}
            </Pressable>
            </Animated.View>
          );
        })}
        </LayoutAnimationConfig>
        )}
        {guzergahlar && guzergahlar.length > 0 && (
          <Text style={s.not}>
            Otobüs, Metrobüs, minibüs, metro, Marmaray, tramvay, füniküler ve vapur dahildir. Marmaray'ın ve İDO
            vapurlarının saatleri yaklaşıktır.
          </Text>
        )}
      </ScrollView>

      {/* Zaman seçimi: gece metrosu gibi ileri saatler ya da "şu saatte orada olmalıyım". */}
      <ModalSayfa acik={zamanAcik} kapat={() => setZamanAcik(false)}>
        <View style={[s.zamanSayfa, { paddingBottom: kenar.bottom + 16 }]}>
          <View style={s.zamanTutamac} />
          <View style={s.zamanUst}>
            <Text style={[s.zamanBaslik, s.zamanUstBaslik]} numberOfLines={1}>
              {taslak.tur === 'varis' ? 'Ne zaman orada olmalısın?' : 'Ne zaman yola çıkıyorsun?'}
            </Text>
            <Pressable
              style={[s.simdiHap, !zaman && s.simdiSecili]}
              onPress={() => {
                setZaman(null);
                setZamanAcik(false);
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Şimdi yola çık"
              accessibilityState={{ selected: !zaman }}
            >
              <Ikon ad="flash" boyut={14} renkKodu={tema.vurgu} />
              <Text style={s.simdiHapYazi}>Şimdi</Text>
            </Pressable>
          </View>

          <View style={s.turSecici} accessibilityRole="tablist">
            {(
              [
                ['kalkis', 'Çıkış saati'],
                ['varis', 'Varış saati'],
              ] as const
            ).map(([tur, etiket]) => (
              <Pressable hitSlop={5}
                key={tur}
                style={[s.turDugme, taslak.tur === tur && s.turSecili]}
                onPress={() => {
                  secimTiki();
                  setTaslak((t) => ({ ...t, tur }));
                }}
                accessibilityRole="tab"
                accessibilityState={{ selected: taslak.tur === tur }}
              >
                <Text style={[s.turYazi, taslak.tur === tur && { color: tema.yazi }]}>{etiket}</Text>
              </Pressable>
            ))}
          </View>

          {Platform.OS === 'ios' ? (
            // iOS'un kendi çarkı (Saat uygulamasındaki alarmla aynı bileşen): gün, saat ve
            // dakika tek bakışta; titreşim, dakikanın dönmesi ve VoiceOver kendiliğinden.
            <DateTimePicker
              value={secimdenAn(taslak.gun, taslak.saat, taslak.dakika)}
              mode="datetime"
              display="spinner"
              locale="tr-TR"
              timeZoneName="Europe/Istanbul"
              minimumDate={secimdenAn(0, 0, 0)}
              maximumDate={secimdenAn(GUN_SAYISI - 1, 23, 59)}
              themeVariant={tema.koyu ? 'dark' : 'light'}
              textColor={tema.yazi}
              onChange={(_, an) => {
                if (an) setTaslak((t) => ({ ...t, ...andanSecim(an) }));
              }}
              style={s.cark}
            />
          ) : (
            <>
              <Text style={s.zamanAltBaslik}>GÜN</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.zamanSatiri}>
                {Array.from({ length: GUN_SAYISI }, (_, g) => (
                  <Pressable
                    key={g}
                    style={[s.zamanHap, taslak.gun === g && s.zamanHapSecili]}
                    onPress={() => setTaslak((t) => ({ ...t, gun: g }))}
                    accessibilityState={{ selected: taslak.gun === g }}
                  >
                    <Text style={[s.zamanHapYazi, taslak.gun === g && { color: tema.vurgu }]}>{gunEtiketi(g, true)}</Text>
                  </Pressable>
                ))}
              </ScrollView>

              <Text style={s.zamanAltBaslik}>SAAT</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.zamanSatiri}>
                {Array.from({ length: 24 }, (_, h) => (
                  <Pressable
                    key={h}
                    style={[s.zamanHap, taslak.saat === h && s.zamanHapSecili]}
                    onPress={() => setTaslak((t) => ({ ...t, saat: h }))}
                    accessibilityState={{ selected: taslak.saat === h }}
                  >
                    <Text style={[s.zamanHapYazi, taslak.saat === h && { color: tema.vurgu }]}>
                      {String(h).padStart(2, '0')}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>

              <Text style={s.zamanAltBaslik}>DAKİKA</Text>
              <View style={s.zamanSatiri}>
                {DAKIKALAR.map((d) => (
                  <Pressable
                    key={d}
                    style={[s.zamanHap, taslak.dakika === d && s.zamanHapSecili]}
                    onPress={() => setTaslak((t) => ({ ...t, dakika: d }))}
                    accessibilityState={{ selected: taslak.dakika === d }}
                  >
                    <Text style={[s.zamanHapYazi, taslak.dakika === d && { color: tema.vurgu }]}>
                      {String(d).padStart(2, '0')}
                    </Text>
                  </Pressable>
                ))}
              </View>

            </>
          )}

          <Text style={s.zamanOzet}>
            {`${gunTarihi(taslak.gun)}, ${saatDakikaYaz(taslak.saat, taslak.dakika)}`}
            {taslak.tur === 'varis' ? ' · en geç bu saatte varan rotalar' : ''}
            {taslak.saat < 5 ? '  ·  gece metrosu yalnız cuma ve cumartesi geceleri çalışır' : ''}
          </Text>

          <Pressable style={s.zamanOnayla} onPress={() => { setZaman(taslak); setZamanAcik(false); }} accessibilityRole="button">
            <Text style={s.zamanOnaylaYazi}>{taslak.tur === 'varis' ? 'Bu saatte varacak şekilde ara' : 'Bu saate göre ara'}</Text>
          </Pressable>
        </View>
      </ModalSayfa>

      <ModalSayfa acik={tercihAcik} kapat={() => setTercihAcik(false)}>
        <View style={[s.zamanSayfa, { paddingBottom: kenar.bottom + 16 }]}>
          <View style={s.zamanTutamac} />
          <Text style={s.zamanBaslik}>Rota tercihleri</Text>

          <Text style={s.zamanAltBaslik}>NEYE GÖRE ARANSIN</Text>
          <View style={s.tercihListesi}>
            {TERCIHLER.map((x) => {
              const secili = rotaSecenekleri.tercih === x.anahtar;
              return (
                <Pressable
                  key={x.anahtar}
                  style={[s.tercihSatiri, secili && s.tercihSecili]}
                  onPress={() => {
                    secimTiki();
                    rotaSecenekleriKaydet({ ...rotaSecenekleri, tercih: x.anahtar });
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: secili }}
                >
                  <Ikon ad={x.simge} boyut={19} renkKodu={secili ? tema.vurgu : tema.soluk} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.tercihBaslik, secili && { color: tema.vurgu }]}>{x.ad}</Text>
                    <Text style={s.tercihAlt}>{x.aciklama}</Text>
                  </View>
                  {secili && <Ikon ad="checkmark" boyut={18} renkKodu={tema.vurgu} />}
                </Pressable>
              );
            })}
          </View>

          <Text style={s.zamanAltBaslik}>ERİŞİLEBİLİRLİK</Text>
          <View style={s.tercihAnahtari}>
            <View style={{ flex: 1 }}>
              <Text style={s.tercihBaslik}>Basamaksız güzergâh</Text>
              <Text style={s.tercihAlt}>
                Merdivenli yollardan ve basamaklı araçlardan (T2, T3 nostaljik tramvay) kaçınılır; metro, Marmaray ve
                modern tramvay istasyonları öne alınır. Otobüs ve vapurun erişim bilgisi yok: elenmez, geride sayılır.
              </Text>
            </View>
            <Switch
              value={rotaSecenekleri.erisilebilir}
              onValueChange={(v) => rotaSecenekleriKaydet({ ...rotaSecenekleri, erisilebilir: v })}
              trackColor={{ true: tema.vurgu }}
            />
          </View>

          {rotaSecenekleri.kapali.length > 0 && (
            <>
              <Text style={s.zamanAltBaslik}>VASITA TÜRLERİ</Text>
              <Pressable
                style={s.tercihAnahtari}
                onPress={() => {
                  setTercihAcik(false);
                  router.navigate('/ayarlar');
                }}
                accessibilityRole="button"
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.tercihBaslik}>
                    {`Kullanılmıyor: ${rotaSecenekleri.kapali.map((t) => VASITA_ADLARI[t]).join(', ')}`}
                  </Text>
                  <Text style={s.tercihAlt}>
                    Bu türler rotalarda hiç kullanılmaz. Değiştirmek için Ayarlar › Vasıta türü tercihleri.
                  </Text>
                </View>
                <Ikon ad="chevron-forward" boyut={16} renkKodu={tema.soluk} />
              </Pressable>
            </>
          )}

          <Pressable style={s.zamanOnayla} onPress={() => setTercihAcik(false)} accessibilityRole="button">
            <Text style={s.zamanOnaylaYazi}>Bu tercihlerle ara</Text>
          </Pressable>
        </View>
      </ModalSayfa>

    </View>
  );
}

/**
 * Kart altındaki "hangi araç" satırı.
 * Minibüs ve dolmuşta kısa ad güzergâhın tamamı olduğu için rozet araç tipini yazıyor;
 * burada güzergâhı da ekliyoruz, yoksa hangi minibüs olduğu anlaşılmıyor.
 */
/**
 * Canlı satırın arkası: aynı seferin canlı tahmini tazelemede en az 45 sn kaydıysa bir an
 * renklenir (gecikme turuncu, erkene çekilme yeşil). Sefer değiştiyse renklenmez.
 */
function CanliVurgu({ kimlik, an, children }: { kimlik: string | null; an: number; children: React.ReactNode }) {
  const tema = useTema();
  const s = useStiller(stiller);
  const [d, setD] = useState({ kimlik, an, n: 0, gec: true });
  if (d.kimlik !== kimlik || d.an !== an) {
    const fark = an - d.an;
    const flas = !!kimlik && kimlik === d.kimlik && Math.abs(fark) >= 45_000 && Math.abs(fark) <= 30 * 60_000;
    setD({ kimlik, an, n: flas ? d.n + 1 : d.n, gec: flas ? fark > 0 : d.gec });
  }
  const p = useSharedValue(0);
  useEffect(() => {
    if (d.n === 0) return;
    p.value = withSequence(withTiming(1, { duration: 150 }), withDelay(500, withTiming(0, { duration: 1100 })));
  }, [d.n, p]);
  const zemin = useAnimatedStyle(() => ({ opacity: p.value }));
  return (
    <View>
      <Animated.View
        pointerEvents="none"
        style={[s.vurguZemin, { backgroundColor: d.gec ? tema.uyariAcik : tema.vurguAcik }, zemin]}
      />
      {children}
    </View>
  );
}

/** Hesaplanırken: kart biçiminde gri kutular, üstlerinden bir parıltı geçer. */
function IskeletListesi() {
  const s = useStiller(stiller);
  return (
    <View style={{ gap: 10 }} accessible accessibilityLabel="En uygun rotalar hesaplanıyor">
      <Text style={s.iskeletYazi}>En uygun rotalar hesaplanıyor…</Text>
      {[0, 1, 2].map((i) => (
        <IskeletKart key={i} />
      ))}
    </View>
  );
}

function IskeletKart() {
  const s = useStiller(stiller);
  return (
    <View style={[s.kart, s.iskelet]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <View style={s.iskeletUst}>
        <Blok en={70} boy={24} />
        <Blok en={84} boy={14} />
      </View>
      <Blok en="60%" boy={20} />
      <Blok en="100%" boy={6} />
      <Blok en="75%" boy={12} />
      <Blok en="90%" boy={12} />
      <Parilti />
    </View>
  );
}

function hatYazisi(bacak: Guzergah['legs'][number]): string {
  const e = hatEtiketi(bacak.route?.shortName, bacak.route?.mode ?? bacak.mode, bacak.route?.agency?.name, bacak.route?.longName);
  return [e.rozet, e.ayrinti].filter(Boolean).join(' · ');
}

/** Tercih hapındaki etiket: seçili tercih ne ise onu yazar. */
function tercihEtiketi(secenekler: { tercih: RotaTercihi; erisilebilir: boolean; kapali: VasitaTuru[] }): string {
  const ad = TERCIHLER.find((x) => x.anahtar === secenekler.tercih)?.kisa ?? 'Önerilen';
  // Ayarlar'da kapatılan vasıta türleri: sonuçlar neden farklı, hap söylesin.
  const kapali = secenekler.kapali.length ? `${secenekler.kapali.length} tür kapalı` : '';
  return [ad, secenekler.erisilebilir ? 'basamaksız' : '', kapali].filter(Boolean).join(' · ');
}

const stiller = (t: Tema) =>
  StyleSheet.create({
  kok: { flex: 1, backgroundColor: t.zemin },
  ust: { backgroundColor: t.yuzey, paddingHorizontal: 14, paddingBottom: 12, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.cizgi },
  nerede: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  noktalar: { width: 18, alignItems: 'center', gap: 3 },
  baslangicNokta: { width: 11, height: 11, borderRadius: 6, borderWidth: 3, borderColor: t.vurgu },
  kesik: { width: 2, height: 18, backgroundColor: t.cizgi },
  bitisNokta: { width: 10, height: 10, borderRadius: 3, backgroundColor: t.yazi },
  alanKutu: { backgroundColor: t.zemin, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, overflow: 'hidden' },
  alan: { fontWeight: '600', fontSize: 14, color: t.yazi },
  degistir: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: t.cizgi, alignItems: 'center', justifyContent: 'center' },
  tercihListesi: { gap: 7 },
  tercihSatiri: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 12,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.cizgi,
    backgroundColor: t.zemin,
  },
  tercihSecili: { borderColor: t.vurgu, backgroundColor: t.vurguAcik },
  tercihBaslik: { fontSize: 14.5, fontWeight: '700', color: t.yazi },
  tercihAlt: { fontSize: 12, color: t.soluk, lineHeight: 17, marginTop: 2 },
  tercihAnahtari: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingRight: 2 },
  filtreler: { gap: 6, paddingRight: 14 },
  filtre: { borderWidth: 1, borderColor: t.cizgi, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  filtreKoyu: { backgroundColor: t.yazi, borderColor: t.yazi },
  filtreSecili: { borderColor: t.vurgu, backgroundColor: t.vurguAcik },
  filtreYazi: { fontSize: 12.5, fontWeight: '600', color: t.soluk },
  sonuclar: { padding: 12, gap: 10 },
  bilgi: { color: t.soluk, textAlign: 'center', padding: 20, lineHeight: 20 },
  kapaliUyari: {
    margin: 16,
    padding: 14,
    gap: 8,
    borderRadius: 14,
    backgroundColor: t.uyariAcik,
  },
  kapaliUyariUst: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kapaliUyariBaslik: { flex: 1, fontSize: 15.5, fontWeight: '700', color: t.yazi },
  kapaliUyariYazi: { fontSize: 13.5, lineHeight: 19, color: t.yazi },
  kapaliUyariDugme: {
    alignSelf: 'flex-start',
    marginTop: 2,
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 19,
    justifyContent: 'center',
    backgroundColor: t.vurgu,
  },
  kapaliUyariDugmeYazi: { fontSize: 14, fontWeight: '700', color: t.vurguYazi },
  ozelGun: {
    flexDirection: 'row',
    gap: 9,
    marginHorizontal: 14,
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: t.vurguAcik,
  },
  ozelGunYazi: { flex: 1, fontSize: 12.5, lineHeight: 18, color: t.yazi },
  kart: { backgroundColor: t.yuzey, borderRadius: 16, padding: 14, gap: 10, borderWidth: 1, borderColor: t.cizgi },
  kartOneri: { borderColor: t.vurgu, borderWidth: 2 },
  kartUst: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  sure: { fontSize: 24, fontWeight: '800', color: t.yazi, letterSpacing: -0.5 },
  saat: { fontSize: 13.5, fontWeight: '600', color: t.soluk, fontVariant: ['tabular-nums'] },
  etiket: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, color: t.vurgu, backgroundColor: t.vurguAcik, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, overflow: 'hidden' },
  kartAlt: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  altYazi: { fontSize: 12.5, color: t.soluk, fontVariant: ['tabular-nums'] },
  kalin: { color: t.yazi, fontWeight: '700' },
  ucret: { color: t.vurgu, fontWeight: '700' },
  ilkArac: { fontSize: 12.5, color: t.yazi, fontWeight: '600' },
  canliBlok: { gap: 3 },
  vurguZemin: { position: 'absolute', top: -3, bottom: -3, left: -6, right: -6, borderRadius: 8 },
  iskelet: { overflow: 'hidden' },
  iskeletUst: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  iskeletYazi: { fontSize: 12.5, color: t.soluk, textAlign: 'center', marginBottom: 2 },
  canliSatir: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: -3 },
  esnek: { flex: 1, minWidth: 0 },
  tarifeNotu: { fontSize: 11.5, color: t.soluk, paddingLeft: 16 },
  not: { fontSize: 12, color: t.soluk, textAlign: 'center', paddingTop: 6 },
  sonraki: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.cizgi, paddingTop: 10, gap: 7 },
  sonrakiBaslik: { fontSize: 11, letterSpacing: 0.6, color: t.soluk, fontWeight: '700' },
  bolumBaslik: { fontSize: 12, letterSpacing: 0.8, color: t.soluk, fontWeight: '700', marginTop: 10, marginBottom: 6, marginLeft: 4 },
  hapiSatiri: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  hap: { flexDirection: 'row', alignItems: 'baseline', gap: 4, borderWidth: 1, borderColor: t.cizgi, backgroundColor: t.zemin, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
  hapSaat: { fontSize: 13, fontWeight: '700', color: t.yazi, fontVariant: ['tabular-nums'] },
  hapHat: { fontSize: 11.5, fontWeight: '800', color: t.vurgu },
  hapDakika: { fontSize: 11, color: t.soluk },
    zamanSayfa: {
      backgroundColor: t.yuzey,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      paddingHorizontal: 16,
      paddingTop: 8,
      gap: 4,
    },
    zamanTutamac: { width: 38, height: 5, borderRadius: 3, backgroundColor: t.cizgi, alignSelf: 'center', marginBottom: 10 },
    zamanBaslik: { fontSize: 18, fontWeight: '800', color: t.yazi, marginBottom: 10 },
    turSecici: {
      flexDirection: 'row',
      padding: 3,
      borderRadius: 12,
      backgroundColor: t.cizgi,
      marginBottom: 10,
    },
    turDugme: { flex: 1, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
    turSecili: { backgroundColor: t.yuzey },
    turYazi: { fontSize: 14, fontWeight: '700', color: t.soluk },
    simdiSecili: { borderColor: t.vurgu, backgroundColor: t.vurguAcik },
    simdiYazi: { fontSize: 15, fontWeight: '700', color: t.soluk },
    zamanUst: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
    zamanUstBaslik: { flex: 1, marginBottom: 0 },
    simdiHap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      height: 32,
      paddingHorizontal: 12,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: t.cizgi,
      backgroundColor: t.yuzeyIkincil,
    },
    simdiHapYazi: { fontSize: 13.5, fontWeight: '700', color: t.vurgu },
    cark: { alignSelf: 'stretch', height: 216, marginTop: 2 },
    zamanAltBaslik: { fontSize: 11, letterSpacing: 0.8, fontWeight: '700', color: t.soluk, marginTop: 14, marginBottom: 6 },
    zamanSatiri: { flexDirection: 'row', gap: 7, paddingRight: 8 },
    zamanHap: {
      minWidth: 46,
      height: 38,
      paddingHorizontal: 12,
      borderRadius: 11,
      borderWidth: 1,
      borderColor: t.cizgi,
      backgroundColor: t.yuzeyIkincil,
      alignItems: 'center',
      justifyContent: 'center',
    },
    zamanHapSecili: { borderColor: t.vurgu, backgroundColor: t.vurguAcik },
    zamanHapYazi: { fontSize: 14, fontWeight: '600', color: t.yazi, fontVariant: ['tabular-nums'] },
    zamanOzet: { fontSize: 12.5, color: t.soluk, marginTop: 14 },
    zamanOnayla: {
      height: 50,
      borderRadius: 14,
      backgroundColor: t.vurgu,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 12,
    },
    zamanOnaylaYazi: { fontSize: 16, fontWeight: '700', color: t.vurguYazi },
  });
