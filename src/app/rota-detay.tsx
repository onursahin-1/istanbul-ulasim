// 3 · Rota detayı: haritada güzergâh, adım adım zaman çizelgesi ve yolculuk takibi.
// Her toplu taşıma bacağı açılabilir: içinde geçilen duraklar, seferin sıklığı ve
// günün son seferi uyarısı çıkar.

import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AltYaprak } from '@/components/alt-yaprak';
import { AdimKartlari, AdimSekmeleri, TumAdimlar, type YolTarifiVerisi } from '@/components/canli-yol-tarifi';
import { OtobusIsareti } from '@/components/harita-isaretleri';
import { HatirlatmaSayfasi, type InisBilgisi } from '@/components/hatirlatma';
import { canliRenk, GeriCubugu, HatRozeti, Ikon, useStiller, type IkonAdi } from '@/components/ulasim';
import { bacakCanli } from '@/lib/canli';
import { hemenBildir, izinIste, useHatirlaticilar } from '@/lib/bildirim';
import { useKayitlar } from '@/lib/kayitlar';
import { polylineCoz, type Nokta } from '@/lib/cografya';
import { araclariYerlestir, kalanYaz, yaklasanOtobus, yasYaz, type YerlesikArac } from '@/lib/arac-konum';
import { bacakDuraklari, hatKalkislariGetir, seferAraclariGetir, type Bacak } from '@/lib/otp';
import { guzergahGetir } from '@/lib/secim';
import { seferBilgisi, sikliktanYazi, type SeferBilgisi } from '@/lib/sefer';
import { aracAdi, baslikYap, haritaRengi, hatEtiketi, hatRengi, useTema, type Tema } from '@/lib/tema';
import { TARIFE_TARIHI, UCRET_ADLARI, ucretKisa, ucretYaz, yolculukUcreti } from '@/lib/ucret';
import {
  adimlariKur,
  baslangicDurumu,
  durumuIlerlet,
  type BacakOzeti,
  type YolculukDurumu,
} from '@/lib/yolculuk';
import { adimlariYaz, type DonusTuru } from '@/lib/yuruyus';
import { isodanSaniye, mesafeYaz, saatYaz, saniyedenSaat, sureYaz } from '@/lib/zaman';

type Takip = { bacak: number; kalanDurak: number } | null;

/** Yol tarifi satırlarının simgeleri. */
const DONUS_SIMGELERI: Record<DonusTuru, IkonAdi> = {
  basla: 'walk',
  duz: 'arrow-up',
  sol: 'arrow-back',
  sag: 'arrow-forward',
  hafifSol: 'arrow-back-outline',
  hafifSag: 'arrow-forward-outline',
  keskinSol: 'arrow-back-circle-outline',
  keskinSag: 'arrow-forward-circle-outline',
  geri: 'refresh',
  kavsak: 'sync',
  asansor: 'swap-vertical',
  giris: 'enter-outline',
  cikis: 'exit-outline',
  tabela: 'information-circle-outline',
};

function bacakNoktalari(b: Bacak): Nokta[] {
  const cizgi = polylineCoz(b.legGeometry?.points);
  if (cizgi.length > 1) return cizgi;
  return [
    { latitude: b.from.lat, longitude: b.from.lon },
    { latitude: b.to.lat, longitude: b.to.lon },
  ];
}

export default function RotaDetayEkrani() {
  const kenar = useSafeAreaInsets();
  const tema = useTema();
  const s = useStiller(stiller);
  const { height } = useWindowDimensions();
  const { sira, hedef } = useLocalSearchParams<{ sira: string; hedef?: string }>();
  const guzergah = guzergahGetir(Number(sira));
  const harita = useRef<MapView>(null);

  const [takipAcik, setTakipAcik] = useState(false);
  // Canlı yol tarifi: hangi adımdayız (konum belirliyor) ve hangi adımın kartına bakılıyor.
  const [durum, setDurum] = useState<YolculukDurumu | null>(null);
  const [gorunen, setGorunen] = useState(0);
  const [kartBoyu, setKartBoyu] = useState(0);
  const [tumAdimlarAcik, setTumAdimlarAcik] = useState(false);
  const [simdi, setSimdi] = useState(() => Date.now());
  const sonKonum = useRef<Nokta | null>(null);
  const [acikBacaklar, setAcikBacaklar] = useState<Record<number, boolean>>({});
  const [seferler, setSeferler] = useState<Record<number, SeferBilgisi>>({});
  const [hatirlatAcik, setHatirlatAcik] = useState(false);
  const { hatirlaticilar, yenile: hatirlaticilariYenile } = useHatirlaticilar();
  const { ucretTuru, ekranAcik } = useKayitlar();
  const aboneligi = useRef<Location.LocationSubscription | null>(null);
  const simulasyon = useRef<ReturnType<typeof setInterval> | null>(null);
  const uyarilanlar = useRef(new Set<string>());
  const sorulanlar = useRef(new Set<number>());

  const bacaklar = useMemo(() => guzergah?.legs ?? [], [guzergah]);
  const cizgiler = useMemo(() => bacaklar.map(bacakNoktalari), [bacaklar]);
  const duraklar = useMemo(() => bacaklar.map((b) => (b.transitLeg ? bacakDuraklari(b) : [])), [bacaklar]);

  // Adım adım görünüm için: hangi bacak hangi adım, konumla ilerlemek için bacakların özeti.
  const ozetler = useMemo<BacakOzeti[]>(
    () =>
      bacaklar.map((b, i) => ({
        arac: !!b.transitLeg,
        mesafe: b.distance ?? null,
        bitis: { latitude: b.to.lat, longitude: b.to.lon },
        duraklar: duraklar[i].map((d) => ({ latitude: d.lat, longitude: d.lon })),
      })),
    [bacaklar, duraklar],
  );
  const adimlar = useMemo(() => adimlariKur(ozetler), [ozetler]);
  // Eski liste görünümü (takip dışı) için: içinde bulunulan araç bacağı ve kalan durak.
  const takip: Takip = useMemo(
    () =>
      durum && durum.faz === 'icinde' && adimlar[durum.adim]
        ? { bacak: adimlar[durum.adim].bacak, kalanDurak: durum.kalanDurak ?? 0 }
        : null,
    [durum, adimlar],
  );

  const ucret = useMemo(() => yolculukUcreti(bacaklar, ucretTuru), [bacaklar, ucretTuru]);
  // Yürüme bacaklarının adım adım tarifi; toplu taşıma bacaklarında boş kalır.
  const yolTarifleri = useMemo(() => bacaklar.map((b) => (b.transitLeg ? [] : adimlariYaz(b.steps))), [bacaklar]);
  const ilkTarif = useMemo(
    () => yolTarifleri.map((t) => t.find((x) => x.donus !== 'basla')?.metin ?? t[0]?.metin ?? null),
    [yolTarifleri],
  );

  // Hatırlatıcılar: yola çıkış anı ve her aracın iniş durağına varış anı.
  const hatirlatmaGrubu = `rota-${sira}-${guzergah?.start ?? ''}`;
  const kuruluHatirlatici = hatirlaticilar.filter((h) => h.grup === hatirlatmaGrubu).length;
  const kalkisAni = useMemo(() => {
    const an = Date.parse(guzergah?.start ?? '');
    return Number.isNaN(an) ? null : an;
  }, [guzergah]);
  const inisler = useMemo<InisBilgisi[]>(
    () =>
      bacaklar
        .filter((b) => b.transitLeg)
        .map((b) => ({
          zaman: Date.parse(b.end.estimated?.time ?? b.end.scheduledTime ?? ''),
          durak: baslikYap(b.to.name),
          hat: b.route?.shortName ?? aracAdi(b.route?.mode ?? b.mode),
        }))
        .filter((i) => !Number.isNaN(i.zaman)),
    [bacaklar],
  );

  // Alt yaprak: harita tüm ekranı kaplıyor, yaprak üstünde sürükleniyor (ana ekrandaki gibi).
  // Yaprağın alanı alttaki "Yolculuğu başlat" çubuğunun üstünde bitiyor.
  const [yaprakAlani, setYaprakAlani] = useState(0);
  const [altCubuk, setAltCubuk] = useState(0);
  const [yaprakBoyu, setYaprakBoyu] = useState(Math.round(height * 0.5));

  // Bineceğin otobüsler: henüz binilmemiş her araç bacağı için, o seferi yapan otobüs
  // ve biniş durağına kaç durak kaldığı. Yarım dakikada bir tazeleniyor; alınamazsa
  // sessizce boş kalıyor (canlı konum süs, yolculuk onsuz da planlanmış).
  const [binisOtobusleri, setBinisOtobusleri] = useState<Record<number, { otobus: YerlesikArac; kalan: number }>>({});

  // "Otobüs yaklaşınca haber ver": açık olan bacaklar ve uyarısı atılmış olanlar.
  // Canlı konuma bakarak çalışıyor, bu yüzden yalnız uygulama açıkken; kapalıyken
  // haber vermek sunucudan itme bildirimi ister (sırada).
  const [yaklasmaUyarisi, setYaklasmaUyarisi] = useState<Record<number, boolean>>({});
  const uyarildi = useRef(new Set<number>());
  const yaklasmaUyarisiRef = useRef(yaklasmaUyarisi);
  yaklasmaUyarisiRef.current = yaklasmaUyarisi;
  const uyariDegistir = useCallback(async (i: number) => {
    const acilacak = !yaklasmaUyarisiRef.current[i];
    if (acilacak && !(await izinIste())) {
      Alert.alert('Bildirim izni yok', 'Ayarlar › Bildirimler bölümünden bu uygulamaya izin verebilirsin.');
      return;
    }
    uyarildi.current.delete(i);
    setYaklasmaUyarisi((o) => ({ ...o, [i]: acilacak }));
  }, []);
  useEffect(() => {
    let acik = true;
    const yukle = async () => {
      const simdi = Date.now();
      const sonuc: Record<number, { otobus: YerlesikArac; kalan: number }> = {};
      await Promise.all(
        bacaklar.map(async (b, i) => {
          const sefer = b.trip?.gtfsId;
          const duraklar = b.trip?.pattern?.stops ?? [];
          const binis = Date.parse(b.start.estimated?.time ?? b.start.scheduledTime ?? '');
          if (!b.transitLeg || !sefer || !duraklar.length || !(binis > simdi - 60_000)) return;
          try {
            const araclar = araclariYerlestir(duraklar, await seferAraclariGetir(sefer), simdi);
            const sira = duraklar.findIndex((d) => d.gtfsId === b.from.stop?.gtfsId);
            const y = yaklasanOtobus(araclar, sira, sefer);
            // Yalnız bu seferin otobüsü: başka bir otobüsü "bineceğin" diye göstermek yanıltır.
            if (y && y.otobus.sefer === sefer) sonuc[i] = y;
          } catch {
            // canlı konum alınamadı; bu bacakta gösterilmez
          }
        }),
      );
      if (acik) setBinisOtobusleri(sonuc);
    };
    yukle();
    const zamanlayici = setInterval(yukle, 30_000);
    return () => {
      acik = false;
      clearInterval(zamanlayici);
    };
  }, [bacaklar]);

  useEffect(() => {
    for (const [anahtar, { otobus, kalan }] of Object.entries(binisOtobusleri)) {
      const i = Number(anahtar);
      if (!yaklasmaUyarisi[i] || uyarildi.current.has(i) || kalan > YAKLASMA_ESIGI || otobus.sinif === 'eski') continue;
      uyarildi.current.add(i);
      const b = bacaklar[i];
      const hat = b?.route?.shortName ?? 'Otobüs';
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      hemenBildir(
        `${hat} ${kalanYaz(kalan)}`,
        `${baslikYap(b?.from.name)} durağında ol: otobüs ${kalan === 0 ? 'durakta' : 'geliyor'}.`,
      );
    }
  }, [binisOtobusleri, yaklasmaUyarisi, bacaklar]);

  /** Bacak açıldığında biniş durağının o hatta ait kalkışlarını bir kez çeker. */
  const seferleriYukle = useCallback(
    async (i: number) => {
      if (sorulanlar.current.has(i)) return;
      const b = bacaklar[i];
      const durakId = b?.from.stop?.gtfsId;
      const hatId = b?.route?.gtfsId;
      if (!durakId || !hatId) return;
      sorulanlar.current.add(i);
      try {
        const kalkislar = await hatKalkislariGetir(durakId, hatId);
        const binis = isodanSaniye(b.start.estimated?.time ?? b.start.scheduledTime);
        setSeferler((onceki) => ({ ...onceki, [i]: seferBilgisi(kalkislar, binis) }));
      } catch {
        // Sefer sıklığı süslemedir; alınamazsa ekranın geri kalanı çalışmaya devam eder.
      }
    },
    [bacaklar],
  );

  const bacagiAcKapa = useCallback(
    (i: number) => {
      setAcikBacaklar((onceki) => {
        const yeni = { ...onceki, [i]: !onceki[i] };
        if (yeni[i]) seferleriYukle(i);
        return yeni;
      });
    },
    [seferleriYukle],
  );

  const konumuIsle = useCallback(
    (nokta: Nokta) => {
      sonKonum.current = nokta;
      setDurum((d) => (d ? durumuIlerlet(d, nokta, adimlar, ozetler) : d));
    },
    [adimlar, ozetler],
  );

  // İnişe yaklaşırken titreşim; bir durak kala bildirim ("sıradaki durakta in").
  useEffect(() => {
    if (!takip) return;
    const anahtar = `${takip.bacak}-${takip.kalanDurak}`;
    if (takip.kalanDurak > 2 || uyarilanlar.current.has(anahtar)) return;
    uyarilanlar.current.add(anahtar);
    Haptics.notificationAsync(
      takip.kalanDurak === 0 ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success,
    ).catch(() => {});
    if (takip.kalanDurak === 1) {
      hemenBildir('Sıradaki durakta in', `${baslikYap(bacaklar[takip.bacak]?.to.name)} durağında inmeye hazırlan.`);
    }
  }, [takip, bacaklar]);

  const takibiDurdur = useCallback(() => {
    aboneligi.current?.remove();
    aboneligi.current = null;
    if (simulasyon.current) clearInterval(simulasyon.current);
    simulasyon.current = null;
    setTakipAcik(false);
    setDurum(null);
    setTumAdimlarAcik(false);
    uyarilanlar.current.clear();
  }, []);

  useEffect(() => takibiDurdur, [takibiDurdur]);

  // Takip başlayınca içinde bulunulan bacak kendiliğinden açılır: kullanıcı yoldayken
  // hangi durakta olduğunu görmek için ayrıca dokunmak zorunda kalmasın.
  useEffect(() => {
    if (takip) {
      setAcikBacaklar((onceki) => (onceki[takip.bacak] ? onceki : { ...onceki, [takip.bacak]: true }));
      seferleriYukle(takip.bacak);
    }
  }, [takip, seferleriYukle]);

  /** Adım adım görünümü açar: ilk adım, aktarmalar için sonraki seferler. */
  const yolculuguAc = () => {
    setTakipAcik(true);
    setDurum(baslangicDurumu(adimlar));
    setGorunen(0);
    setSimdi(Date.now());
    bacaklar.forEach((b, i) => b.transitLeg && seferleriYukle(i));
  };

  const takibiBaslat = async () => {
    const izin = await Location.requestForegroundPermissionsAsync();
    if (izin.status !== 'granted') {
      Alert.alert('Konum izni gerekli', 'Yolculuğunu takip edebilmemiz için ayarlardan konum iznini açman gerekiyor.');
      return;
    }
    yolculuguAc();
    aboneligi.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, distanceInterval: 15, timeInterval: 5000 },
      (k) => konumuIsle({ latitude: k.coords.latitude, longitude: k.coords.longitude }),
    );
  };

  // Geliştirme sırasında masadan deneyebilmek için: düğmeye basılı tutunca
  // güzergâhtaki duraklar sırayla "ziyaret edilir".
  const simulasyonuBaslat = () => {
    if (!__DEV__) return;
    // Yürüyüşlerde çizgi üstünden birkaç nokta, araçta duraklar sırayla "ziyaret edilir".
    const sirali: Nokta[] = bacaklar.flatMap((b, i) => {
      if (b.transitLeg) return duraklar[i].map((d) => ({ latitude: d.lat, longitude: d.lon }));
      const c = cizgiler[i];
      return [c[0], c[Math.floor(c.length / 2)], c[c.length - 1]].filter(Boolean);
    });
    if (!sirali.length) return;
    takibiDurdur();
    yolculuguAc();
    let adim = 0;
    simulasyon.current = setInterval(() => {
      const d = sirali[adim++];
      if (!d) {
        if (simulasyon.current) clearInterval(simulasyon.current);
        simulasyon.current = null;
        return;
      }
      konumuIsle(d);
    }, 1500);
  };

  // Yolculuk sürerken: ekran kararmasın (Ayarlar'dan kapatılabilir) ve saat yazıları tazelensin.
  useEffect(() => {
    if (!takipAcik) return;
    if (ekranAcik) activateKeepAwakeAsync('yolculuk').catch(() => {});
    const saat = setInterval(() => setSimdi(Date.now()), 30_000);
    return () => {
      clearInterval(saat);
      deactivateKeepAwake('yolculuk').catch(() => {});
    };
  }, [takipAcik, ekranAcik]);

  // Adım değişince (konumla), o anda şimdiki adıma bakılıyorsa kart da yenisine geçer.
  // Kullanıcı başka bir adıma bakıyorsa rahatsız edilmez; "şu anki adıma dön" çıkar.
  const oncekiAdim = useRef(0);
  useEffect(() => {
    if (!durum) return;
    if (gorunenRef.current === oncekiAdim.current) setGorunen(durum.adim);
    oncekiAdim.current = durum.adim;
  }, [durum?.adim]); // eslint-disable-line react-hooks/exhaustive-deps
  const gorunenRef = useRef(gorunen);
  gorunenRef.current = gorunen;

  // Harita bakılan adıma odaklanır: yürürken yol, beklerken durak ve gelen otobüs,
  // otobüsteyken kalan güzergâh. Konum her geldiğinde değil, adım/evre değişince.
  useEffect(() => {
    if (!durum || !kartBoyu) return;
    const a = adimlar[gorunen];
    if (!a) return;
    const i = a.bacak;
    const b = bacaklar[i];
    const simdiki = gorunen === durum.adim;
    let noktalar: Nokta[];
    if (simdiki && durum.faz === 'vardi') {
      noktalar = [{ latitude: b.to.lat, longitude: b.to.lon }];
    } else if (a.tur === 'yuru') {
      noktalar = cizgiler[i];
    } else if (simdiki && durum.faz === 'icinde') {
      const liste = duraklar[i];
      const bas = Math.max(0, liste.length - 1 - (durum.kalanDurak ?? liste.length - 1));
      noktalar = liste.slice(bas).map((d) => ({ latitude: d.lat, longitude: d.lon }));
    } else {
      const otobus = binisOtobusleri[i]?.otobus;
      noktalar = [
        { latitude: b.from.lat, longitude: b.from.lon },
        ...(otobus ? [{ latitude: otobus.lat, longitude: otobus.lon }] : []),
      ];
    }
    if (simdiki && sonKonum.current) noktalar = [...noktalar, sonKonum.current];
    if (noktalar.length === 1) {
      const P = 0.002;
      noktalar = [
        { latitude: noktalar[0].latitude - P, longitude: noktalar[0].longitude - P },
        { latitude: noktalar[0].latitude + P, longitude: noktalar[0].longitude + P },
      ];
    }
    harita.current?.fitToCoordinates(noktalar, {
      edgePadding: { top: kenar.top + 70, right: 50, bottom: kartBoyu + 30, left: 50 },
      animated: true,
    });
    // binisOtobusleri bilerek yok: her tazelemede harita zıplamasın.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gorunen, durum?.adim, durum?.faz, kartBoyu, adimlar]);

  // Harita, yaprağın ilk yerleşiminden sonra bir kez daha sığdırılıyor: ilk sığdırmada
  // yaprağın boyu henüz ölçülmemiş oluyor. Sonra kullanıcı haritayı kendisi kaydırır.
  const haritaHazir = useRef(false);
  const sonSigdirma = useRef(false);
  useEffect(() => {
    if (!haritaHazir.current || sonSigdirma.current || !yaprakAlani || !altCubuk) return;
    sonSigdirma.current = true;
    haritayiSigdir();
    // haritayiSigdir her çizimde yeniden kuruluyor; ölçüler yeter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yaprakAlani, altCubuk, yaprakBoyu]);

  const haritayiSigdir = () => {
    haritaHazir.current = true;
    const tum = cizgiler.flat();
    if (tum.length < 2) return;
    harita.current?.fitToCoordinates(tum, {
      edgePadding: { top: kenar.top + 70, right: 40, bottom: yaprakBoyu + altCubuk + 30, left: 40 },
      animated: false,
    });
  };

  if (!guzergah) {
    return (
      <View style={[s.kok, { paddingTop: kenar.top + 4, paddingHorizontal: 14 }]}>
        <GeriCubugu baslik="Rota detayı" />
        <Text style={s.bos}>Bu rota artık bellekte değil. Rota listesine dönüp tekrar seç.</Text>
      </View>
    );
  }

  const aktifBacak = takip?.bacak ?? -1;
  const yolTarifi: YolTarifiVerisi | null = durum
    ? {
        bacaklar,
        duraklar: duraklar.map((l) => l.map((d) => ({ ad: d.ad }))),
        adimlar,
        durum,
        ilkTarif,
        binisOtobusleri,
        seferler,
        yaklasmaUyarisi,
        uyariDegistir,
        hedef,
        simdi,
      }
    : null;

  return (
    <View style={s.kok}>
      <MapView
        ref={harita}
        style={StyleSheet.absoluteFill}
        userInterfaceStyle={tema.haritaStili}
        onMapReady={haritayiSigdir}
        showsUserLocation={takipAcik}
        showsPointsOfInterests={false}
        toolbarEnabled={false}
      >
        {bacaklar.map((b, i) => (
          <Polyline
            key={i}
            coordinates={cizgiler[i]}
            strokeColor={b.transitLeg ? haritaRengi(b.route, tema) : tema.yurume}
            strokeWidth={b.transitLeg ? 5 : 3}
            lineDashPattern={b.transitLeg ? undefined : [2, 6]}
          />
        ))}
        {bacaklar
          .slice(0, -1)
          .filter((b) => b.to.stop)
          .map((b, i) => (
            <Marker
              key={`aktarma-${i}`}
              coordinate={{ latitude: b.to.lat, longitude: b.to.lon }}
              title={baslikYap(b.to.name)}
              pinColor={b.transitLeg ? haritaRengi(b.route, tema) : tema.yurume}
            />
          ))}
        <Marker coordinate={{ latitude: bacaklar[0].from.lat, longitude: bacaklar[0].from.lon }} title="Başlangıç" pinColor={tema.vurgu} />
        {Object.entries(binisOtobusleri).map(([i, { otobus, kalan }]) => (
          <Marker
            key={`otobus-${i}`}
            coordinate={{ latitude: otobus.lat, longitude: otobus.lon }}
            anchor={{ x: 0.5, y: 0.5 }}
            title={`${bacaklar[Number(i)]?.route?.shortName ?? 'Otobüs'} · ${kalanYaz(kalan)}`}
            description={`Konum ${yasYaz(otobus.yasSn)}`}
            zIndex={10}
          >
            <OtobusIsareti
              renk={haritaRengi(bacaklar[Number(i)]?.route, tema)}
              yon={otobus.heading}
              soluk={otobus.sinif === 'eski'}
            />
          </Marker>
        ))}
        <Marker
          coordinate={{ latitude: bacaklar[bacaklar.length - 1].to.lat, longitude: bacaklar[bacaklar.length - 1].to.lon }}
          title={hedef ? baslikYap(hedef) : 'Varış'}
          pinColor={tema.yazi}
        />
      </MapView>

      <View style={[s.geri, { top: kenar.top + 8 }]}>
        <Pressable style={s.yuvarlak} onPress={() => router.back()} accessibilityLabel="Geri">
          <Ikon ad="chevron-back" boyut={22} />
        </Pressable>
      </View>

      {takipAcik && yolTarifi && (
        <View style={[s.sekmeKonumu, { top: kenar.top + 8 }]} pointerEvents="box-none">
          <AdimSekmeleri v={yolTarifi} gorunen={gorunen} sec={setGorunen} />
        </View>
      )}

      <View
        style={{ flex: 1 }}
        pointerEvents="box-none"
        onLayout={(e) => setYaprakAlani(e.nativeEvent.layout.height)}
      >
        {yaprakAlani > 0 && !takipAcik && (
          <AltYaprak
            kapsayiciYukseklik={yaprakAlani}
            ustPay={kenar.top + 60}
            kapaliYukseklik={92}
            ortaOran={0.62}
            onDurum={(_, boy) => setYaprakBoyu(boy)}
            erisilebilirlikEtiketi="Yolculuk adımlarını aç ya da kapat"
            baslik={
              <View style={s.ozet}>
                <View>
                  <Text style={s.sure}>{sureYaz(guzergah.duration)}</Text>
                  <Text style={s.ozetAlt}>
                    {guzergah.numberOfTransfers === 0 ? 'Aktarmasız' : `${guzergah.numberOfTransfers} aktarma`} · {sureYaz(guzergah.walkTime)} yürüme
                  </Text>
                </View>
                <Text style={s.ozetSaat}>{`${saatYaz(guzergah.start)}–${saatYaz(guzergah.end)}`}</Text>
              </View>
            }
          >
            <View style={{ paddingVertical: 10 }}>
              {bacaklar.map((b, i) => {
                const renkKodu = b.transitLeg ? hatRengi(b.route, tema) : tema.yurume;
                const liste = duraklar[i];
                const durakSayisi = Math.max(liste.length - 1, 1);
                const sonYuruyus = !b.transitLeg && i === bacaklar.length - 1;
                const acik = !!acikBacaklar[i];
                const sefer = seferler[i];
                const aktarma = aktarmaSuresi(bacaklar, i);
                // Takip sırasında kullanıcının bulunduğu durağın listedeki sırası.
                const simdikiDurak = aktifBacak === i && takip ? liste.length - 1 - takip.kalanDurak : -1;
                // Canlı veriyle güncellenmiş kalkışın tarifeden sapması (yalnız araç bacakları).
                const canli = b.transitLeg ? bacakCanli(b.start.scheduledTime, b.start.estimated?.time) : null;

                return (
                  <View key={i} style={[s.adim, aktifBacak === i && s.adimAktif]}>
                    <View style={s.adimSaatSutun}>
                      <Text style={s.adimSaat}>{saatYaz(b.start.estimated?.time ?? b.start.scheduledTime)}</Text>
                      {canli && (
                        <Text style={[s.adimSapma, { color: canliRenk(canli.sinif, tema) }]} numberOfLines={1}>
                          {canli.dakika === 0 ? 'canlı' : canli.dakika > 0 ? `+${canli.dakika} dk` : `${canli.dakika} dk`}
                        </Text>
                      )}
                    </View>
                    <View style={s.cizgiSutun}>
                      <View style={[s.adimNokta, { borderColor: renkKodu }]} />
                      <View style={[s.adimCizgi, b.transitLeg ? { backgroundColor: renkKodu } : s.adimCizgiYuru]} />
                    </View>
                    <View style={s.adimIcerik}>
                      {b.transitLeg ? (
                        <>
                          <Text style={s.adimBaslik}>{baslikYap(b.from.name)}</Text>

                          <Pressable
                            onPress={() => bacagiAcKapa(i)}
                            accessibilityRole="button"
                            accessibilityState={{ expanded: acik }}
                            accessibilityLabel={`${b.route?.shortName ?? ''} hattı, ${durakSayisi} durak. ${acik ? 'Durakları gizle' : 'Durakları göster'}`}
                            style={[s.bacakDugme, acik && { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottomWidth: 0 }]}
                          >
                            <HatRozeti hat={b.route} kucuk />
                            <Text style={s.adimAlt} numberOfLines={1}>
                              {[
                                b.headsign ? `${baslikYap(b.headsign)} yönü` : aracAdi(b.route?.mode ?? b.mode),
                                `${durakSayisi} durak`,
                                sureYaz(b.duration),
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </Text>
                            <Ikon ad={acik ? 'chevron-up' : 'chevron-down'} boyut={15} renkKodu={acik ? renkKodu : tema.soluk} />
                          </Pressable>

                          {binisOtobusleri[i] && (
                            <OtobusKutusu
                              kalan={binisOtobusleri[i].kalan}
                              otobus={binisOtobusleri[i].otobus}
                              binis={b.start.estimated?.time ?? b.start.scheduledTime}
                              renk={renkKodu}
                              uyari={!!yaklasmaUyarisi[i]}
                              uyariDegistir={() => uyariDegistir(i)}
                            />
                          )}

                          {acik && (
                            <View style={s.durakPaneli}>
                              {sefer?.aralikDk != null && (
                                <View style={s.siklik}>
                                  <Ikon ad="time-outline" boyut={13} renkKodu={renkKodu} />
                                  <Text style={[s.siklikYazi, { color: renkKodu }]}>{sikliktanYazi(sefer)}</Text>
                                </View>
                              )}
                              {liste.map((d, j) => {
                                const ilk = j === 0;
                                const son = j === liste.length - 1;
                                const burada = j === simdikiDurak;
                                const saat = ilk
                                  ? saatYaz(b.start.estimated?.time ?? b.start.scheduledTime)
                                  : son
                                    ? saatYaz(b.end.estimated?.time ?? b.end.scheduledTime)
                                    : '';
                                return (
                                  <View key={d.gtfsId} style={s.durakSatiri}>
                                    <View style={s.durakCizgi}>
                                      <View
                                        style={[
                                          s.durakCizgiUst,
                                          { backgroundColor: renkKodu },
                                          ilk && { backgroundColor: 'transparent' },
                                        ]}
                                      />
                                      <View
                                        style={[
                                          s.durakCizgiAlt,
                                          { backgroundColor: renkKodu },
                                          son && { backgroundColor: 'transparent' },
                                        ]}
                                      />
                                      {burada ? (
                                        <View style={[s.durakNoktaBurada, { backgroundColor: tema.vurgu, borderColor: tema.yuzey }]} />
                                      ) : ilk || son ? (
                                        <View style={[s.durakNoktaUc, { borderColor: renkKodu, backgroundColor: son ? renkKodu : tema.yuzey }]} />
                                      ) : (
                                        <View style={[s.durakNokta, { borderColor: renkKodu, backgroundColor: tema.yuzey }]} />
                                      )}
                                    </View>
                                    <Text style={[s.durakAd, (ilk || son || burada) && s.durakAdKalin]} numberOfLines={1}>
                                      {baslikYap(d.ad)}
                                    </Text>
                                    {burada ? (
                                      <Text style={[s.durakBurada, { color: tema.vurgu }]}>şu an buradasın</Text>
                                    ) : (
                                      <Text style={s.durakSaat}>{saat}</Text>
                                    )}
                                  </View>
                                );
                              })}
                              {sefer && (sefer.sonSefer || sefer.sonrakiSaniye != null) && (
                                <View style={[s.sonSefer, sefer.sonSefer && { backgroundColor: tema.uyariAcik }]}>
                                  <Ikon
                                    ad={sefer.sonSefer ? 'warning-outline' : 'repeat-outline'}
                                    boyut={13}
                                    renkKodu={sefer.sonSefer ? tema.uyari : tema.soluk}
                                  />
                                  <Text style={[s.sonSeferYazi, sefer.sonSefer && { color: tema.uyari, fontWeight: '700' }]}>
                                    {sefer.sonSefer
                                      ? 'Bu, elimizdeki tarifedeki son sefer'
                                      : `Sonraki sefer ${saniyedenSaat(sefer.sonrakiSaniye ?? 0)}`}
                                  </Text>
                                </View>
                              )}
                            </View>
                          )}

                          {!!hatEtiketi(b.route?.shortName, b.route?.mode ?? b.mode, b.route?.agency?.name).ayrinti && (
                            <Text style={s.hatGuzergah} numberOfLines={2}>
                              {hatEtiketi(b.route?.shortName, b.route?.mode ?? b.mode, b.route?.agency?.name).ayrinti}
                            </Text>
                          )}
                          <Text style={s.adimAlt}>{baslikYap(b.to.name)} durağında in</Text>
                          {aktifBacak === i && takip && (
                            <Text style={s.adimCanli}>
                              {takip.kalanDurak === 0 ? 'Bu durakta in' : `İneceğin durağa ${takip.kalanDurak} durak kaldı`}
                            </Text>
                          )}
                        </>
                      ) : (
                        <>
                          <Text style={s.adimBaslik}>
                            {sonYuruyus ? 'Varış noktasına yürü' : `${baslikYap(b.to.name)} durağına yürü`}
                          </Text>
                          {yolTarifleri[i].length > 0 ? (
                            <Pressable
                              onPress={() => bacagiAcKapa(i)}
                              accessibilityRole="button"
                              accessibilityState={{ expanded: acik }}
                              accessibilityLabel={`${sureYaz(b.duration)} yürüyüş, ${yolTarifleri[i].length} adım. ${
                                acik ? 'Yol tarifini gizle' : 'Yol tarifini göster'
                              }`}
                              style={s.yuruDugme}
                            >
                              <Text style={s.adimAlt}>{`${sureYaz(b.duration)} · ${mesafeYaz(b.distance)}`}</Text>
                              <Ikon ad={acik ? 'chevron-up' : 'chevron-down'} boyut={14} renkKodu={tema.soluk} />
                            </Pressable>
                          ) : (
                            <Text style={s.adimAlt}>{`${sureYaz(b.duration)} · ${mesafeYaz(b.distance)}`}</Text>
                          )}
                          {acik && (
                            <View style={s.yolTarifi}>
                              {yolTarifleri[i].map((adim, j) => (
                                <View key={j} style={s.tarifSatiri}>
                                  <Ikon ad={DONUS_SIMGELERI[adim.donus]} boyut={14} renkKodu={tema.soluk} />
                                  <Text style={s.tarifMetin}>{adim.metin}</Text>
                                  {!!adim.mesafe && <Text style={s.tarifMesafe}>{adim.mesafe}</Text>}
                                </View>
                              ))}
                            </View>
                          )}
                          {aktarma != null && (
                            <View style={[s.aktarma, aktarma.sikisik && { borderLeftColor: tema.uyari, backgroundColor: tema.uyariAcik }]}>
                              <Text style={[s.aktarmaBaslik, aktarma.sikisik && { color: tema.uyari }]}>
                                {aktarma.sikisik
                                  ? `Aktarma sıkışık: ${aktarma.dakika} dakikan var`
                                  : `Aktarma için ${aktarma.dakika} dakikan var`}
                              </Text>
                              <Text style={s.aktarmaAlt}>{`${sureYaz(b.duration)} yürüyüş bu sürenin içinde`}</Text>
                            </View>
                          )}
                        </>
                      )}
                    </View>
                  </View>
                );
              })}
              <View style={s.adim}>
                <Text style={s.adimSaat}>{saatYaz(guzergah.end)}</Text>
                <View style={s.cizgiSutun}>
                  <View style={[s.adimNokta, s.varisNokta]} />
                </View>
                <View style={s.adimIcerik}>
                  <Text style={s.adimBaslik}>Varış{hedef ? ` · ${baslikYap(hedef)}` : ''}</Text>
                </View>
              </View>

              {ucret.toplam > 0 && (
                <View style={s.ucretKutusu}>
                  <View style={s.ucretUst}>
                    <Text style={s.ucretBaslik}>İstanbulkart ücreti</Text>
                    <Text style={s.ucretToplam}>{ucretKisa(ucret)}</Text>
                  </View>
                  {bacaklar.map((b, i) => {
                    const u = ucret.bacaklar[i];
                    if (!u) return null;
                    return (
                      <View key={`ucret-${i}`} style={s.ucretSatiri}>
                        <HatRozeti hat={b.route} kucuk />
                        <Text style={s.ucretAciklama} numberOfLines={1}>
                          {u.aciklama}
                        </Text>
                        <Text style={s.ucretTutar}>{ucretYaz(u.tutar)}</Text>
                      </View>
                    );
                  })}
                  <Text style={s.ucretNot}>{ucretNotu(ucret, ucretTuru)}</Text>
                </View>
              )}
            </View>
          </AltYaprak>
        )}
      </View>

      {takipAcik && yolTarifi ? (
        <>
          <AdimKartlari
            v={yolTarifi}
            gorunen={gorunen}
            sec={setGorunen}
            onBitir={takibiDurdur}
            onTumAdimlar={() => setTumAdimlarAcik(true)}
            onBoy={setKartBoyu}
          />
          <TumAdimlar v={yolTarifi} acik={tumAdimlarAcik} kapat={() => setTumAdimlarAcik(false)} sec={setGorunen} />
        </>
      ) : (
        <View
          style={[s.alt, { paddingBottom: kenar.bottom + 10 }]}
          onLayout={(e) => setAltCubuk(e.nativeEvent.layout.height)}
        >
          <Pressable
            style={[s.zil, kuruluHatirlatici > 0 && s.zilDolu]}
            onPress={() => setHatirlatAcik(true)}
            accessibilityRole="button"
            accessibilityLabel={kuruluHatirlatici > 0 ? `${kuruluHatirlatici} hatırlatıcı kurulu` : 'Hatırlat'}
          >
            <Ikon
              ad={kuruluHatirlatici > 0 ? 'notifications' : 'notifications-outline'}
              boyut={20}
              renkKodu={kuruluHatirlatici > 0 ? tema.vurguYazi : tema.vurgu}
            />
          </Pressable>
          <Pressable
            style={[s.baslat, takipAcik && s.bitir]}
            onPress={takipAcik ? takibiDurdur : takibiBaslat}
            onLongPress={simulasyonuBaslat}
            accessibilityRole="button"
          >
            <Ikon ad={takipAcik ? 'stop-circle' : 'navigate'} boyut={18} renkKodu={takipAcik ? tema.yuzey : tema.vurguYazi} />
            <Text style={[s.baslatYazi, { color: takipAcik ? tema.yuzey : tema.vurguYazi }]}>
              {takipAcik ? 'Yolculuğu bitir' : 'Yolculuğu başlat'}
            </Text>
          </Pressable>
        </View>
      )}

      <HatirlatmaSayfasi
        acik={hatirlatAcik}
        kapat={() => setHatirlatAcik(false)}
        kalkis={kalkisAni}
        inisler={inisler}
        grup={hatirlatmaGrubu}
        kurulu={kuruluHatirlatici}
        degisti={hatirlaticilariYenile}
      />
    </View>
  );
}

/** Otobüs biniş durağına bu kadar durak kalınca haber verilir. */
const YAKLASMA_ESIGI = 3;

/**
 * Bineceğin otobüs: "Otobüs 2 durak uzakta · ~4 dk". Dakika biniş durağından
 * kalkışa kalan süre (canlı gecikmeyle düzeltilmiş); yürümeye ne zaman başlaman
 * gerektiğini söylüyor.
 */
function OtobusKutusu({
  kalan,
  otobus,
  binis,
  renk,
  uyari,
  uyariDegistir,
}: {
  kalan: number;
  otobus: YerlesikArac;
  binis: string | null | undefined;
  renk: string;
  uyari: boolean;
  uyariDegistir: () => void;
}) {
  const tema = useTema();
  const s = useStiller(stiller);
  const dk = binis ? Math.round((Date.parse(binis) - Date.now()) / 60_000) : null;
  const soluk = otobus.sinif === 'eski';
  // Tek satır: yolculuk adımlarının arasında yer kaplamasın.
  return (
    <View style={s.otobusKutu}>
      <View style={[s.otobusSimge, { backgroundColor: soluk ? tema.soluk : renk }]}>
        <Ikon ad="bus" boyut={11} renkKodu="#fff" />
      </View>
      <Text style={s.otobusYazi} numberOfLines={1}>
        <Text style={s.otobusBaslik}>
          {kalanYaz(kalan)}
          {dk != null && dk > 0 ? ` · ~${dk} dk` : ''}
        </Text>
        <Text style={s.otobusAlt}>
          {uyari ? ` · ${YAKLASMA_ESIGI} durak kala haber verilecek` : ` · ${yasYaz(otobus.yasSn)}`}
        </Text>
      </Text>
      <Pressable
        onPress={uyariDegistir}
        hitSlop={10}
        style={[s.otobusZil, uyari && { backgroundColor: renk, borderColor: renk }]}
        accessibilityRole="switch"
        accessibilityState={{ checked: uyari }}
        accessibilityLabel={`Otobüs ${YAKLASMA_ESIGI} durak kalınca haber ver. Uygulama açıkken çalışır.`}
      >
        <Ikon ad={uyari ? 'notifications' : 'notifications-outline'} boyut={14} renkKodu={uyari ? '#fff' : tema.soluk} />
      </Pressable>
    </View>
  );
}

/** Ücret kutusunun altındaki açıklama: tarife, tahmin payı ve gece tarifesi uyarısı. */
function ucretNotu(ucret: ReturnType<typeof yolculukUcreti>, tur: keyof typeof UCRET_ADLARI): string {
  const parcalar = [`${UCRET_ADLARI[tur]} · ${TARIFE_TARIHI} tarifesi`];
  if (ucret.geceTarifesi) parcalar.push('Gece tarifesi (çift ücret) uygulandı');
  if (ucret.yeniYolculuk > 0) parcalar.push('120 dakikalık aktarma süresi dolduğu için ücret yeniden başladı');
  if (ucret.yaklasik) parcalar.push('Vapur ücreti hatta göre değişir; tutar yaklaşıktır');
  return parcalar.join(' · ');
}

/**
 * Bir yürüme bacağı iki toplu taşıma bacağının arasındaysa, aktarma için gerçekte
 * kaç dakika olduğunu verir: önceki aracın iniş saatiyle sonrakinin kalkış saati arası.
 */
function aktarmaSuresi(bacaklar: Bacak[], i: number): { dakika: number; sikisik: boolean } | null {
  const b = bacaklar[i];
  if (b.transitLeg) return null;
  const onceki = bacaklar[i - 1];
  const sonraki = bacaklar[i + 1];
  if (!onceki?.transitLeg || !sonraki?.transitLeg) return null;
  const inis = Date.parse(onceki.end.estimated?.time ?? onceki.end.scheduledTime);
  const kalkis = Date.parse(sonraki.start.estimated?.time ?? sonraki.start.scheduledTime);
  if (Number.isNaN(inis) || Number.isNaN(kalkis)) return null;
  const dakika = Math.round((kalkis - inis) / 60000);
  if (dakika <= 0) return null;
  const yuruyusDakika = Math.round((b.duration ?? 0) / 60);
  return { dakika, sikisik: dakika - yuruyusDakika <= 2 };
}

const stiller = (t: Tema) =>
  StyleSheet.create({
  kok: { flex: 1, backgroundColor: t.zemin },
  bos: { color: t.soluk, padding: 20, textAlign: 'center' },
  geri: { position: 'absolute', left: 14 },
  sekmeKonumu: { position: 'absolute', left: 64, right: 12, alignItems: 'flex-start' },
  yuvarlak: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: t.yuzey,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: t.koyu ? 0.5 : 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  bildirim: {
    position: 'absolute',
    left: 64,
    right: 10,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    backgroundColor: t.yuzey,
    borderRadius: 18,
    padding: 11,
    shadowColor: '#000',
    shadowOpacity: t.koyu ? 0.6 : 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  bildirimIkon: { width: 36, height: 36, borderRadius: 9, backgroundColor: t.vurgu, alignItems: 'center', justifyContent: 'center' },
  bildirimBaslik: { fontSize: 14, fontWeight: '700', color: t.yazi },
  bildirimMetin: { fontSize: 13, color: t.yazi, marginTop: 1 },
  ozet: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.cizgi,
  },
  sure: { fontSize: 24, fontWeight: '800', color: t.yazi, letterSpacing: -0.5 },
  ozetAlt: { fontSize: 12.5, color: t.soluk, fontWeight: '600' },
  ozetSaat: { fontSize: 14, fontWeight: '700', color: t.yazi, fontVariant: ['tabular-nums'] },
  adim: { flexDirection: 'row', gap: 8, borderRadius: 10 },
  adimAktif: { backgroundColor: t.vurguAcik },
  adimSaatSutun: { width: 42, gap: 1 },
  adimSapma: { fontSize: 10.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
  adimSaat: { fontSize: 12.5, fontWeight: '700', color: t.yazi, paddingTop: 1, fontVariant: ['tabular-nums'] },
  cizgiSutun: { width: 16, alignItems: 'center' },
  adimNokta: { width: 14, height: 14, borderRadius: 7, borderWidth: 3, backgroundColor: t.yuzey, marginTop: 2, zIndex: 1 },
  varisNokta: { borderColor: t.yazi, backgroundColor: t.yazi, borderRadius: 3 },
  adimCizgi: { flex: 1, width: 4, borderRadius: 2, marginTop: -2, marginBottom: -4 },
  adimCizgiYuru: { width: 0, borderLeftWidth: 3, borderStyle: 'dotted', borderColor: t.yurume },
  adimIcerik: { flex: 1, paddingBottom: 14, gap: 4 },
  adimBaslik: { fontSize: 14, fontWeight: '700', color: t.yazi },
  adimAlt: { fontSize: 12.5, color: t.soluk, flexShrink: 1, flexGrow: 1 },
  adimCanli: { fontSize: 12.5, fontWeight: '700', color: t.vurgu },
  otobusKutu: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 6, paddingLeft: 2 },
  otobusSimge: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  otobusYazi: { flex: 1, fontSize: 12.5 },
  otobusBaslik: { fontWeight: '700', color: t.yazi },
  otobusAlt: { color: t.soluk },
  otobusZil: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.cizgi,
  },

  bacakDugme: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 3,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.cizgi,
    backgroundColor: t.yuzeyIkincil,
  },
  durakPaneli: {
    borderWidth: StyleSheet.hairlineWidth,
    borderTopWidth: 0,
    borderColor: t.cizgi,
    backgroundColor: t.yuzeyIkincil,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    paddingHorizontal: 10,
    paddingBottom: 8,
    marginBottom: 4,
  },
  siklik: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: 7, paddingBottom: 4 },
  siklikYazi: { fontSize: 12, fontWeight: '700' },
  durakSatiri: { flexDirection: 'row', alignItems: 'center', gap: 9, height: 28 },
  durakCizgi: { width: 14, height: '100%', alignItems: 'center', justifyContent: 'center' },
  durakCizgiUst: { position: 'absolute', top: 0, height: '50%', width: 3 },
  durakCizgiAlt: { position: 'absolute', bottom: 0, height: '50%', width: 3 },
  durakNokta: { width: 9, height: 9, borderRadius: 5, borderWidth: 2 },
  durakNoktaUc: { width: 12, height: 12, borderRadius: 6, borderWidth: 3 },
  durakNoktaBurada: { width: 16, height: 16, borderRadius: 8, borderWidth: 3 },
  durakAd: { flex: 1, fontSize: 13, color: t.soluk },
  durakAdKalin: { color: t.yazi, fontWeight: '700' },
  durakSaat: { fontSize: 12, color: t.soluk, fontVariant: ['tabular-nums'] },
  durakBurada: { fontSize: 11.5, fontWeight: '700' },
  sonSefer: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6, paddingVertical: 5, paddingHorizontal: 7, borderRadius: 8 },
  sonSeferYazi: { fontSize: 11.5, color: t.soluk, flexShrink: 1 },

  aktarma: {
    marginTop: 4,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderLeftWidth: 3,
    borderLeftColor: t.vurgu,
    borderTopRightRadius: 9,
    borderBottomRightRadius: 9,
    backgroundColor: t.vurguAcik,
  },
  aktarmaBaslik: { fontSize: 12.5, fontWeight: '700', color: t.vurgu },
  aktarmaAlt: { fontSize: 11.5, color: t.soluk, marginTop: 1 },

  alt: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 10,
    paddingHorizontal: 16,
    backgroundColor: t.yuzey,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.cizgi,
  },
  baslat: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    backgroundColor: t.vurgu,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  bitir: { backgroundColor: t.yazi },
  ucretKutusu: {
    marginHorizontal: 14,
    marginTop: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: t.yuzeyIkincil,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.cizgi,
    gap: 8,
  },
  ucretUst: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  ucretBaslik: { fontSize: 14.5, fontWeight: '700', color: t.yazi },
  ucretToplam: { fontSize: 17, fontWeight: '800', color: t.vurgu, fontVariant: ['tabular-nums'] },
  ucretSatiri: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  ucretAciklama: { flex: 1, fontSize: 12.5, color: t.soluk },
  ucretTutar: { fontSize: 13.5, fontWeight: '600', color: t.yazi, fontVariant: ['tabular-nums'] },
  ucretNot: { fontSize: 11.5, color: t.soluk, lineHeight: 17 },
  yuruDugme: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 2 },
  hatGuzergah: { fontSize: 12, color: t.soluk, lineHeight: 17, marginTop: 6 },
  yolTarifi: {
    marginTop: 8,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: t.cizgi,
    gap: 7,
  },
  tarifSatiri: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  tarifMetin: { flex: 1, fontSize: 12.5, color: t.yazi, lineHeight: 17 },
  tarifMesafe: { fontSize: 12, color: t.soluk, fontVariant: ['tabular-nums'] },
  zil: {
    width: 50,
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.vurguAcik,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.cizgi,
  },
  zilDolu: { backgroundColor: t.vurgu, borderColor: t.vurgu },
  baslatYazi: { fontWeight: '700', fontSize: 16 },
});
