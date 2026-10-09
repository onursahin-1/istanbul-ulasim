// Hat detayı: seçilen hattın yönleri ve o yöndeki durak sırası.
//
// Bir hattın her yönü rota motorunda ayrı bir "desen" (pattern) olarak durur.
// Bazı hatlarda ring seferi ya da kısa güzergâh gibi ek desenler de bulunur;
// bunlar da yön seçeneği olarak listelenir.
//
// Ekran harita + sürüklenebilir yaprak: haritada güzergâh çizgisi, duraklar ve
// otobüsler; yaprakta durak listesi.
//
// Canlı konum: seçili yöndeki otobüsler haritada ve durak listesinin arasında
// (hangi iki durağın arasında oldukları arac-konum.ts'te hesaplanıyor). Durak
// ekranından gelindiyse o durak işaretleniyor ve harita durağı ile ona yaklaşan
// otobüsü birlikte gösteriyor: "bana en yakın otobüs nerede" bir bakışta okunur.

import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeInLeft,
  Keyframe,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type EntryAnimationsValues,
} from 'react-native-reanimated';
import { Pressable } from '@/components/dokun';
import { KayanMetin } from '@/components/kayan-metin';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AltYaprak } from '@/components/alt-yaprak';
import { DurakIsareti, HareketliOtobus } from '@/components/harita-isaretleri';
import {
  DuyuruKarti,
  HataKutusu,
  HatRozeti,
  Ikon,
  NabizNoktasi,
  tabelaRozetiMi,
  useStiller,
  Yukleniyor,
} from '@/components/ulasim';
import { hattinDuyurulari, type Duyuru } from '@/lib/duyuru';
import {
  araclariYerlestir,
  METROBUS_HIZI_MS,
  OTOBUS_HIZI_MS,
  kalanYaz,
  yaklasanOtobus,
  yasYaz,
  type HamArac,
  type YerlesikArac,
} from '@/lib/arac-konum';
import { polylineCoz, type Nokta } from '@/lib/cografya';
import { metrobusMu, trKucuk } from '@/lib/metin';
import {
  desenRotasi,
  duyurulariGetir,
  hatAraclariGetir,
  hatDetayiKardesleriyle,
  kopruHatAraclari,
  kopruyeIlgiBildir,
  OtpHatasi,
  saatsizHatMi,
  type HatDetayi,
} from '@/lib/otp';
import { hatPencereleri } from '@/lib/siklik-verisi';
import { aracAdi, baslikYap, haritaRengi, hatRengi, useTema, yaziRengi, type Tema } from '@/lib/tema';
import { secimTiki, vurus } from '@/lib/dokunsal';
import { useCanliAralik, useNabizAkisi } from '@/lib/canli-aralik';
import { ekranAc, geriDon } from '@/lib/gezinti';

export default function HatEkrani() {
  const kenar = useSafeAreaInsets();
  const tema = useTema();
  const s = useStiller(stiller);
  // desen, durak, durakAd: durak ekranından gelindiğinde o yön seçilir, o durak işaretlenir.
  const { id, desen, durak: gelinenDurak, durakAd } = useLocalSearchParams<{
    id: string;
    desen?: string;
    durak?: string;
    durakAd?: string;
  }>();

  const [hat, setHat] = useState<(HatDetayi & { kardesler?: string[] }) | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [yon, setYon] = useState<number | null>(null);
  // Köprüden güzergâh (route_id) başına; OTP'den (köprü kapalıyken) desen kodu başına.
  const [araclar, setAraclar] = useState<{ kaynak: 'kopru' | 'otp'; araclar: Record<string, HamArac[]> }>({
    kaynak: 'otp',
    araclar: {},
  });
  const [simdi, setSimdi] = useState(() => Date.now());
  const [tumDuyurular, setTumDuyurular] = useState<Duyuru[]>([]);
  useEffect(() => {
    let acik = true;
    duyurulariGetir().then((l) => acik && setTumDuyurular(l));
    return () => {
      acik = false;
    };
  }, []);
  // Köprü duyuruları 15 dakikada bir İETT'den yeniliyor (biten duyuru listeden düşüyor);
  // ekran açık kaldıkça uygulama da 5 dakikada bir sorar (duyurulariGetir 5 dk önbellekli).
  useCanliAralik(() => {
    duyurulariGetir().then(setTumDuyurular);
  }, 5 * 60_000);
  const liste = useRef<{ kaydir: (y: number) => void }>(null);
  const kaydirildi = useRef(false);
  const harita = useRef<MapView>(null);
  const [alan, setAlan] = useState(0);
  const [yaprakBoyu, setYaprakBoyu] = useState(300);
  const [yaprakAcik, setYaprakAcik] = useState(false);
  const haritaHazir = useRef(false);
  const sigdirilan = useRef('');

  const yukle = useCallback(async () => {
    if (!id) return;
    setHata(null);
    try {
      // İETT her yönü ayrı güzergâh olarak yayımlıyor; ekran hattın bütün yönlerini göstersin.
      const sonuc = await hatDetayiKardesleriyle(id);
      if (!sonuc) setHata('Bu hat bulunamadı.');
      else setHat(sonuc);
    } catch (e) {
      setHata(e instanceof OtpHatasi ? e.message : 'Hat bilgisi yüklenemedi.');
    }
  }, [id]);

  useEffect(() => {
    yukle();
  }, [yukle]);

  // Otobüs konumları köprüden, nabız biter bitmez (useNabizAkisi); yaşları 15 saniyede bir
  // yeniden yazılır. Köprüye ulaşılamazsa OTP'den yarım dakikada bir. Konum alınamazsa
  // sessizce geçilir: canlı konum süs, hat ekranı onsuz da çalışır.
  // Ekran başka ekranın altındayken (durak, yolculuk) ikisi de durur, dönünce tazelenir.
  const kimlikler = useMemo(() => (hat?.kardesler?.length ? hat.kardesler : id ? [id] : []), [hat, id]);
  const kimlikAnahtari = kimlikler.join(',');
  const araclariGetir = useCallback(
    async (sonra: string | null, sinyal: AbortSignal) => {
      const istenen = kimlikAnahtari.split(',');
      const kopru = await kopruHatAraclari(istenen, sonra, sinyal);
      if (kopru) return { nabiz: kopru.nabiz, veri: { kaynak: 'kopru' as const, araclar: kopru.veri } };
      if (sinyal.aborted) return null;
      return { nabiz: null, veri: { kaynak: 'otp' as const, araclar: await hatAraclariGetir(istenen, sinyal) } };
    },
    [kimlikAnahtari],
  );
  const araclariYaz = useCallback((v: { kaynak: 'kopru' | 'otp'; araclar: Record<string, HamArac[]> }) => {
    setAraclar(v);
    setSimdi(Date.now());
  }, []);
  useNabizAkisi(araclariGetir, araclariYaz, kimlikAnahtari);
  // Köprü bu hattı taramada öne alsın: hattı bilinmeyen otobüsleri birkaç dakikada tanır.
  const kisaAd = hat?.shortName;
  useEffect(() => {
    if (kisaAd) kopruyeIlgiBildir([kisaAd]);
  }, [kisaAd]);
  useCanliAralik(() => setSimdi(Date.now()), 15_000);

  // Duraksız desenler listeye girmez; en çok durağı olan desen varsayılan yön olur.
  const desenler = useMemo(() => {
    const liste = (hat?.patterns ?? []).filter((d) => (d.stops?.length ?? 0) > 1);
    return liste.sort((a, b) => (b.stops?.length ?? 0) - (a.stops?.length ?? 0));
  }, [hat]);

  // Seçim yapılmadıysa: durak ekranından gelinen yön, yoksa en uzun desen.
  const baslangicYonu = Math.max(0, desenler.findIndex((d) => d.code === desen));
  const yonNo = Math.min(yon ?? baslangicYonu, Math.max(desenler.length - 1, 0));
  const secili = desenler[yonNo];
  // Açılışta ve yön değişince durak listesi çizilerek gelir (satırlar sırayla, otobüsler
  // en son); bu pencereden sonra yeni gelen otobüs satırı önceki duraktan kayarak iner.
  const desenKodu = secili?.code;
  const [acilis, setAcilis] = useState({ kod: desenKodu, acik: true });
  if (acilis.kod !== desenKodu) setAcilis({ kod: desenKodu, acik: true });
  useEffect(() => {
    if (!acilis.acik || !acilis.kod) return;
    const t = setTimeout(() => setAcilis((a) => ({ ...a, acik: false })), ACILIS_MS);
    return () => clearTimeout(t);
  }, [acilis]);
  const duraklar = useMemo(() => secili?.stops ?? [], [secili]);

  // İşaretlenecek durak: kimliği tutan, tutmuyorsa (istasyondan gelindi) adı tutan.
  const isaretli = useMemo(() => {
    if (!gelinenDurak && !durakAd) return -1;
    const kimlikle = duraklar.findIndex((d) => d.gtfsId === gelinenDurak);
    if (kimlikle >= 0) return kimlikle;
    const ad = trKucuk(durakAd ?? '').trim();
    return ad ? duraklar.findIndex((d) => trKucuk(d.name ?? '').trim() === ad) : -1;
  }, [duraklar, gelinenDurak, durakAd]);

  // Tarife: gelinen durağın (yoksa ilk durağın) bu yöndeki bütün günkü kalkışları.
  // Minibüs ve dolmuşun saati yok; onlarda yerine "Sefer sıklığı" düğmesi var.
  const tarifeVar = !!hat && !saatsizHatMi(hat);
  // Minibüs ve dolmuş: saat yok ama sıklık var; aynı ekran durak seçmeden, yalnız sıklıkla açılır.
  const siklikVar = !!hat && saatsizHatMi(hat) && !!hatPencereleri(hat.shortName, hat.longName);
  const siklikAc = () => {
    if (!hat) return;
    ekranAc({
      pathname: '/tarife',
      params: {
        siklik: '1',
        baslik: baslikYap(hat.longName) || baslikYap(hat.shortName),
        kisaAd: hat.shortName ?? '',
        uzunAd: hat.longName ?? '',
        mod: hat.mode ?? '',
        renk: hat.color ?? '',
        isletmeci: hat.agency?.name ?? '',
      },
    });
  };
  const tarifeDuragi = isaretli >= 0 ? duraklar[isaretli] : duraklar[0];
  const tarifeAc = (d: { gtfsId: string; name: string } | undefined) => {
    if (!d || !secili || !hat) return;
    // Aynı yöndeki bütün desenler (kısa dönüşler dahil); durak bu desenlerde son durak değilse.
    const kodlar = desenler
      .filter((x) =>
        secili.directionId == null ? x.code === secili.code : x.directionId === secili.directionId,
      )
      .filter((x) => (x.stops ?? []).slice(0, -1).some((st) => st.gtfsId === d.gtfsId))
      .map((x) => x.code);
    if (!kodlar.length) return;
    const hedef = baslikYap(secili.headsign) || baslikYap(duraklar[duraklar.length - 1]?.name);
    ekranAc({
      pathname: '/tarife',
      params: {
        durak: d.gtfsId,
        durakAd: d.name,
        desenler: kodlar.join(','),
        baslik: hedef ? `${baslikYap(d.name)} → ${hedef}` : baslikYap(d.name),
        kisaAd: hat.shortName ?? '',
        mod: hat.mode ?? '',
        renk: hat.color ?? '',
        isletmeci: hat.agency?.name ?? '',
        uzunAd: hat.longName ?? '',
      },
    });
  };

  const otobusler = useMemo(
    () =>
      secili
        ? araclariYerlestir(
            duraklar,
            araclar.araclar[araclar.kaynak === 'kopru' ? desenRotasi(secili.code) : secili.code],
            simdi,
            // Liste haritadaki işaretle aynı tahmini yeri göstersin (konumun yaşı kadar ileri).
            metrobusMu(hat?.shortName) ? METROBUS_HIZI_MS : OTOBUS_HIZI_MS,
          )
        : [],
    [secili, duraklar, araclar, simdi, hat?.shortName],
  );
  // Durağın arkasına (durakta ya da ondan sonraki durağa giderken) düşen otobüsler.
  const durakSonrasi = useMemo(() => {
    const m = new Map<number, YerlesikArac[]>();
    for (const o of otobusler) {
      const i = Math.floor(o.konum);
      m.set(i, [...(m.get(i) ?? []), o]);
    }
    return m;
  }, [otobusler]);
  const enTaze = otobusler.length ? Math.min(...otobusler.map((o) => o.yasSn)) : null;
  const yaklasan = useMemo(() => yaklasanOtobus(otobusler, isaretli), [otobusler, isaretli]);

  // Güzergâh çizgisi: OTP'nin yol geometrisi; yoksa duraklardan geçen düz çizgi.
  const cizgi = useMemo<Nokta[]>(() => {
    const yol = polylineCoz(secili?.patternGeometry?.points);
    if (yol.length > 1) return yol;
    return duraklar
      .filter((d) => d.lat != null && d.lon != null)
      .map((d) => ({ latitude: d.lat!, longitude: d.lon! }));
  }, [secili, duraklar]);

  /**
   * Noktaları haritanın yaprak dışında kalan kısmına sığdırır. Tek nokta ise çevresindeki
   * birkaç sokakla birlikte. (Haritanın ortasına koymak yetmez: alt yarısı yaprağın altında.)
   */
  const odakla = useCallback(
    (noktalar: Nokta[], animasyonlu: boolean) => {
      const P = 0.0025;
      const kapsam =
        noktalar.length === 1
          ? [
              { latitude: noktalar[0].latitude - P, longitude: noktalar[0].longitude - P },
              { latitude: noktalar[0].latitude + P, longitude: noktalar[0].longitude + P },
            ]
          : noktalar;
      harita.current?.fitToCoordinates(kapsam, {
        edgePadding: { top: 50, right: 50, bottom: yaprakBoyu + 40, left: 50 },
        animated: animasyonlu,
      });
    },
    [yaprakBoyu],
  );

  /**
   * Haritayı sığdırır. Gelinen durak varsa durak ile ona yaklaşan otobüs; yoksa
   * bütün güzergâh. Her yön ve "otobüs var/yok" durumu için bir kez: sonra harita
   * kullanıcının, her tazelemede zıplamasın.
   */
  const sigdir = useCallback(
    (zorla = false) => {
      if (!haritaHazir.current || !secili || cizgi.length < 2) return;
      const anahtar = `${secili.code}|${yaklasan ? 'otobus' : ''}`;
      if (!zorla && sigdirilan.current === anahtar) return;
      sigdirilan.current = anahtar;
      const durak = isaretli >= 0 ? duraklar[isaretli] : null;
      const noktalar =
        durak?.lat != null && durak.lon != null
          ? [
              { latitude: durak.lat, longitude: durak.lon },
              ...(yaklasan ? [{ latitude: yaklasan.otobus.lat, longitude: yaklasan.otobus.lon }] : []),
            ]
          : cizgi;
      odakla(noktalar, zorla);
    },
    [secili, cizgi, isaretli, duraklar, yaklasan, odakla],
  );

  useEffect(() => {
    sigdir();
  }, [sigdir]);

  const otobuseGit = (o: YerlesikArac) => odakla([{ latitude: o.lat, longitude: o.lon }], true);
  // Durak çizgisi rozetle aynı renkte (koyu temada açılmış ton), başlık şeridi ise
  // hattın resmî rengini kullanır; geniş bir alanı açılmış tonla boyamak göz alıyor.
  const renkKodu = hat ? hatRengi(hat, tema) : tema.vurgu;
  const seritRengi = hat ? haritaRengi(hat, tema) : tema.vurgu;
  // Otobüs ve minibüste başlık yeşil olmaz: tabela rozetinin yeşil alt şeridi zeminde
  // kayboluyor, koyu temada da koyu rozet parlak yeşilin üstünde delik gibi duruyordu.
  // Metro, tramvay, Metrobüs, vapur başlığı hattın rengini korur (rozetleri zeminden ayrışıyor).
  const sadeTepe = !hat || tabelaRozetiMi(hat);
  const tepeRengi = sadeTepe ? tema.yuzey : seritRengi;
  const yaziKodu = sadeTepe ? tema.yazi : yaziRengi(seritRengi);

  const yonAdi = (d: (typeof desenler)[number] | undefined) => {
    if (!d) return '';
    const bitis = d.stops?.[d.stops.length - 1]?.name;
    const ad = baslikYap(d.headsign) || baslikYap(bitis) || baslikYap(d.name);
    return ad ? `${ad} yönü` : '';
  };

  const yonSecici =
    hat && desenler.length > 1 ? (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.yonlar}>
        {desenler.map((d, i) => {
          const aktif = i === yonNo;
          return (
            <Pressable
              key={d.code}
              onPress={() => {
                secimTiki();
                setYon(i);
              }}
              style={[s.yon, aktif && { backgroundColor: tema.vurguAcik, borderColor: tema.vurgu }]}
              accessibilityState={{ selected: aktif }}
            >
              <Text style={[s.yonYazi, aktif && { color: tema.vurgu }]} numberOfLines={1}>
                {yonAdi(d)}
              </Text>
              <Text style={s.yonSayi}>{d.stops?.length ?? 0} durak</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    ) : null;

  return (
    <View style={s.kok}>
      <View style={[s.tepe, sadeTepe && s.tepeSade, { backgroundColor: tepeRengi, paddingTop: kenar.top + 6 }]}>
        <View style={s.tepeSatir}>
          <Pressable onPress={geriDon} accessibilityLabel="Geri" hitSlop={12}>
            <Ikon ad="chevron-back" boyut={24} renkKodu={yaziKodu} />
          </Pressable>
          {hat && <HatRozeti hat={hat} />}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[s.tepeBaslik, { color: yaziKodu }]} numberOfLines={1}>
              {baslikYap(hat?.longName) || hat?.shortName || 'Hat'}
            </Text>
            <Text style={[s.tepeAlt, { color: sadeTepe ? tema.soluk : yaziKodu }]} numberOfLines={1}>
              {[hat?.agency?.name, aracAdi(hat?.mode)].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>
      </View>

      {hata && <HataKutusu mesaj={hata} tekrarDene={yukle} />}
      {!hat && !hata && <Yukleniyor metin="Hat bilgisi yükleniyor…" />}

      {hat && (
        <View style={{ flex: 1 }} onLayout={(e) => setAlan(e.nativeEvent.layout.height)}>
          <MapView
            ref={harita}
            style={StyleSheet.absoluteFill}
            userInterfaceStyle={tema.haritaStili}
            showsUserLocation
            showsPointsOfInterests={false}
            toolbarEnabled={false}
            onMapReady={() => {
              haritaHazir.current = true;
              sigdir();
            }}
          >
            {cizgi.length > 1 && <Polyline coordinates={cizgi} strokeColor={seritRengi} strokeWidth={5} />}
            {duraklar.map((d, i) =>
              d.lat != null && d.lon != null ? (
                <Marker
                  key={`${d.gtfsId}-${i}`}
                  coordinate={{ latitude: d.lat, longitude: d.lon }}
                  anchor={{ x: 0.5, y: 0.5 }}
                  title={baslikYap(d.name)}
                  description="Durağın kalkışları için dokun"
                  onCalloutPress={() => ekranAc({ pathname: '/durak/[id]', params: { id: d.gtfsId } })}
                  tracksViewChanges={false}
                  zIndex={i === isaretli ? 5 : 1}
                >
                  <DurakIsareti renk={seritRengi} isaretli={i === isaretli} />
                </Marker>
              ) : null,
            )}
            {otobusler.map((o) => (
              <HareketliOtobus
                key={o.kimlik}
                otobus={o}
                cizgi={cizgi}
                hiz={metrobusMu(hat?.shortName) ? METROBUS_HIZI_MS : OTOBUS_HIZI_MS}
                renk={seritRengi}
                baslik={`Otobüs ${o.etiket}`}
                aciklama={otobusAciklamasi(o, baslikYap(duraklar[o.durak]?.name))}
              />
            ))}
          </MapView>

          {!yaprakAcik && cizgi.length > 1 && (
            <Pressable
              style={[s.tamami, { bottom: yaprakBoyu + 12 }]}
              onPress={() => odakla(cizgi, true)}
              accessibilityRole="button"
              accessibilityLabel="Hattın tamamını göster"
            >
              <Ikon ad="scan-outline" boyut={16} renkKodu={tema.vurgu} />
              <Text style={s.tamamiYazi}>Hattın tamamı</Text>
            </Pressable>
          )}

          {alan > 0 && (
            <AltYaprak
              kapsayiciYukseklik={alan}
              ustPay={48}
              kapaliYukseklik={80}
              ortaOran={0.5}
              onDurum={(durum, boy) => {
                setYaprakBoyu(boy);
                setYaprakAcik(durum === 'acik');
              }}
              erisilebilirlikEtiketi="Durak listesini aç ya da kapat"
              listeRef={liste}
              baslik={
                <View style={s.yaprakBas}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.yaprakBaslik} numberOfLines={1}>
                      {yonAdi(secili) || 'Duraklar'}
                    </Text>
                    {yaklasan && isaretli >= 0 ? (
                      <View style={s.yaprakAltSatir}>
                        <Text style={s.yaprakAlt}>Durağına en yakın otobüs </Text>
                        <KayanMetin metin={kalanYaz(yaklasan.kalan)} style={s.yaprakAlt} />
                      </View>
                    ) : (
                      <Text style={[s.yaprakAlt, { marginTop: 1 }]} numberOfLines={1}>
                        {`${duraklar.length} durak`}
                      </Text>
                    )}
                  </View>
                  {otobusler.length > 0 && enTaze != null && (
                    <View style={s.canliOzet}>
                      <NabizNoktasi renk={tema.vurgu} boyut={6} />
                      <Text style={s.canliOzetYazi}>{`${otobusler.length} otobüs · ${yasYaz(enTaze)}`}</Text>
                    </View>
                  )}
                </View>
              }
            >
              {hattinDuyurulari(tumDuyurular, hat?.shortName).length > 0 && (
                <View style={s.duyurular}>
                  {hattinDuyurulari(tumDuyurular, hat?.shortName).map((d, i) => (
                    <DuyuruKarti key={i} duyuru={d} />
                  ))}
                </View>
              )}
              {yonSecici}
              {tarifeVar && tarifeDuragi && tarifeDuragi !== duraklar[duraklar.length - 1] && (
                <Pressable
                  style={s.tarifeDugme}
                  onPress={() => tarifeAc(tarifeDuragi)}
                  accessibilityRole="button"
                  accessibilityHint="Bu yönde, bu duraktan bütün günün kalkış saatleri"
                >
                  <Ikon ad="time-outline" boyut={20} renkKodu={tema.vurguYazi} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.tarifeBaslik} numberOfLines={1}>
                      {`${baslikYap(tarifeDuragi.name)} durağından tarife`}
                    </Text>
                    <Text style={s.tarifeAlt} numberOfLines={1}>
                      Hafta içi, Cumartesi, Pazar · bütün gün
                    </Text>
                  </View>
                  <Ikon ad="chevron-forward" boyut={17} renkKodu={tema.vurguYazi} />
                </Pressable>
              )}
              {siklikVar && (
                <Pressable
                  style={s.tarifeDugme}
                  onPress={siklikAc}
                  accessibilityRole="button"
                  accessibilityHint="Hafta içi, Cumartesi ve Pazar günü kaç dakikada bir kalktığı"
                >
                  <Ikon ad="time-outline" boyut={20} renkKodu={tema.vurguYazi} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.tarifeBaslik} numberOfLines={1}>
                      Sefer sıklığı
                    </Text>
                    <Text style={s.tarifeAlt} numberOfLines={1}>
                      Hafta içi, Cumartesi, Pazar · bütün gün
                    </Text>
                  </View>
                  <Ikon ad="chevron-forward" boyut={17} renkKodu={tema.vurguYazi} />
                </Pressable>
              )}
              {duraklar.length === 0 && <Text style={s.bos}>Bu hattın durak bilgisi veride yok.</Text>}
              <View style={s.liste}>
                {duraklar.map((d, i) => {
                  const ilk = i === 0;
                  const son = i === duraklar.length - 1;
                  const buDurak = i === isaretli;
                  return (
                    <Animated.View
                      key={`${d.gtfsId}-${i}`}
                      entering={
                        acilis.acik && i < SIRALI_DURAK
                          ? FadeInLeft.delay(40 + i * 45).duration(300)
                          : undefined
                      }
                      layout={DURAK_YERLESIMI}
                      onLayout={
                        buDurak
                          ? (e) => {
                              // Gelinen durak listede görünsün: üstünde birkaç durak kalacak kadar kaydır.
                              if (kaydirildi.current) return;
                              kaydirildi.current = true;
                              liste.current?.kaydir(e.nativeEvent.layout.y - 100);
                            }
                          : undefined
                      }
                    >
                      <Pressable
                        style={s.durak}
                        onPress={() => ekranAc({ pathname: '/durak/[id]', params: { id: d.gtfsId } })}
                        // Basılı tutunca bu durağın tarifesi (son durakta kalkış yok).
                        onLongPress={
                          tarifeVar && !son
                            ? () => {
                                vurus();
                                tarifeAc(d);
                              }
                            : undefined
                        }
                        accessibilityRole="button"
                        accessibilityHint={tarifeVar && !son ? 'Basılı tutarsan bu durağın tarifesi açılır' : undefined}
                      >
                        <View style={s.cizgiSutun}>
                          {!ilk && <View style={[s.cizgiUst, { backgroundColor: renkKodu }]} />}
                          {!son && <View style={[s.cizgiAlt, { backgroundColor: renkKodu }]} />}
                          {buDurak && !!yaklasan && yaklasan.kalan <= 1 && <NabizHalkasi renk={renkKodu} />}
                          <View
                            style={
                              ilk || son || buDurak
                                ? [s.noktaUc, { backgroundColor: renkKodu }]
                                : [s.nokta, { borderColor: renkKodu, backgroundColor: tema.yuzey }]
                            }
                          />
                        </View>
                        <Text style={[s.durakAd, (ilk || son || buDurak) && s.durakAdKalin]} numberOfLines={1}>
                          {baslikYap(d.name)}
                        </Text>
                        {buDurak && (
                          <Text style={[s.durakEtiket, { color: renkKodu, borderColor: renkKodu }]}>durağın</Text>
                        )}
                        <Ikon ad="chevron-forward" boyut={15} renkKodu={tema.yurume} />
                      </Pressable>
                      {(durakSonrasi.get(i) ?? []).map((o) => (
                        <Animated.View
                          key={o.kimlik}
                          // Açılışta satır yerinde durur; simgesi önceki duraktan çizgi boyunca iner,
                          // yazısı belirir (OtobusSatiri, acilisGecikmesi). Sonra bir sonraki durağa
                          // geçen otobüsün yeni satırı açılırken önceki duraktan iner.
                          entering={acilis.acik ? undefined : otobusIner}
                          exiting={FadeOut.duration(220)}
                        >
                          <OtobusSatiri
                            acilisGecikmesi={acilis.acik ? 40 + Math.min(i, SIRALI_DURAK) * 45 + 150 : null}
                            otobus={o}
                            renkKodu={renkKodu}
                            sonDurak={son}
                            durakAdi={baslikYap(duraklar[o.durak]?.name)}
                            onPress={() => otobuseGit(o)}
                          />
                        </Animated.View>
                      ))}
                    </Animated.View>
                  );
                })}
              </View>
              <Text style={[s.dipnot, { paddingBottom: kenar.bottom }]}>
                Durak sırası rota motorundaki güzergâh desenine göredir. Bir durağa dokunarak yaklaşan seferlerini
                görebilirsin.
                {otobusler.length > 0 &&
                  " Otobüs konumları İETT'den iki dakikada bir geliyor; 5 dakikadan eski konumlar soluk, 10 dakikadan eskileri gösterilmiyor. Otobüse dokununca harita ona gider."}
              </Text>
            </AltYaprak>
          )}
        </View>
      )}
    </View>
  );
}

/** Açılışta sırayla gelen durak sayısı; uzun hatta sonrakiler hemen görünür. */
const SIRALI_DURAK = 15;
/** Açılış penceresi (ms): bu sürede gelen satırlar sırayla gelir. */
const ACILIS_MS = 1500;
/** Otobüs satırları eklenip çıkınca duraklar yaylı kayar. */
const DURAK_YERLESIMI = LinearTransition.springify().damping(22).stiffness(200);

/** Bir sonraki durağa geçen otobüs: satır açılırken yukarıdan (önceki duraktan) iner. */
function otobusIner(v: EntryAnimationsValues) {
  'worklet';
  const ayar = { duration: 600, easing: Easing.out(Easing.cubic) };
  return {
    initialValues: { transform: [{ translateY: -(v.targetHeight + 8) }], opacity: 0 },
    animations: { transform: [{ translateY: withTiming(0, ayar) }], opacity: withTiming(1, { duration: 300 }) },
  };
}

/**
 * Açılışta otobüs simgesi bir önceki duraktan çizgi boyunca kendi yerine kayarak iner,
 * hafifçe oturur. Yazı büyüyüp küçülmez (eskiden bütün satır yaylı büyüyordu, "Durakta"
 * yazısı ekrandan taşıyordu); yalnız solarak gelir (OTOBUS_YAZI_GIRISI).
 */
const otobusSimgeGirisi = (gecikme: number) =>
  new Keyframe({
    0: { opacity: 0, transform: [{ translateY: -30 }] },
    15: { opacity: 1, transform: [{ translateY: -30 }] },
    80: { opacity: 1, transform: [{ translateY: 2 }], easing: Easing.out(Easing.cubic) },
    100: { opacity: 1, transform: [{ translateY: 0 }] },
  })
    .duration(520)
    .delay(gecikme);
const otobusYaziGirisi = (gecikme: number) =>
  new Keyframe({
    0: { opacity: 0, transform: [{ translateX: -6 }] },
    100: { opacity: 1, transform: [{ translateX: 0 }], easing: Easing.out(Easing.quad) },
  })
    .duration(260)
    .delay(gecikme + 120);

/** Senin durağının noktası: en yakın otobüs bir durak kalınca etrafında halka atar. */
function NabizHalkasi({ renk }: { renk: string }) {
  const azalt = useReducedMotion();
  const p = useSharedValue(0);
  useEffect(() => {
    if (azalt) return;
    p.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad) }), -1, false);
  }, [azalt, p]);
  const halka = useAnimatedStyle(() => ({ opacity: 0.7 * (1 - p.value), transform: [{ scale: 0.6 + 0.7 * p.value }] }));
  if (azalt) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: renk }, halka]}
    />
  );
}

/** Haritadaki otobüsün baloncuğunda ve listede okunan kısa durum. */
function otobusAciklamasi(o: YerlesikArac, durakAdi: string): string {
  if (o.sinif === 'eski') return `${durakAdi} civarı · ${yasYaz(o.yasSn)} görüldü`;
  return [
    o.durum === 'durakta' ? `${durakAdi} durağında` : `Sıradaki durak: ${durakAdi}`,
    yasYaz(o.yasSn),
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Durak listesinin arasındaki otobüs: çizginin üstünde otobüs simgesi, yanında ne
 * durumda olduğu. Taze konumda durum ve yaş; 5 dakikadan eskide yalnız "… civarı,
 * N dk önce görüldü", soluk.
 */
function OtobusSatiri({
  otobus,
  renkKodu,
  sonDurak,
  durakAdi,
  onPress,
  acilisGecikmesi = null,
}: {
  /** Ekran açılırken: simge iner, yazı belirir (ms gecikmeyle). Açılıştan sonra null. */
  acilisGecikmesi?: number | null;
  otobus: YerlesikArac;
  renkKodu: string;
  sonDurak: boolean;
  durakAdi: string;
  onPress: () => void;
}) {
  const tema = useTema();
  const s = useStiller(stiller);
  const eski = otobus.sinif === 'eski';
  const simgeRengi = eski ? tema.soluk : renkKodu;
  const etiket = eski
    ? `${durakAdi} civarında, ${yasYaz(otobus.yasSn)} görüldü`
    : [
        otobus.durum === 'durakta' ? `${durakAdi} durağında` : `${durakAdi} durağına yaklaşıyor`,
        `konum ${yasYaz(otobus.yasSn)}`,
      ]
        .filter(Boolean)
        .join(', ');
  return (
    <Pressable
      style={s.otobus}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Otobüs ${otobus.etiket}: ${etiket}. Haritada göster.`}
    >
      <View style={s.cizgiSutun}>
        <View style={[s.cizgiTam, { backgroundColor: renkKodu }, sonDurak && { opacity: 0 }]} />
        <Animated.View
          entering={acilisGecikmesi != null ? otobusSimgeGirisi(acilisGecikmesi) : undefined}
          style={[s.otobusSimge, { backgroundColor: simgeRengi, borderColor: tema.yuzey }]}
        >
          <Ikon ad="bus" boyut={12} renkKodu={tema.yuzey} />
        </Animated.View>
      </View>
      <Animated.View
        entering={acilisGecikmesi != null ? otobusYaziGirisi(acilisGecikmesi) : undefined}
        style={s.otobusMetin}
      >
        {eski ? (
          <Text style={s.otobusSoluk} numberOfLines={1}>
            {`${durakAdi} civarı · ${yasYaz(otobus.yasSn)} görüldü`}
          </Text>
        ) : (
          <Text style={s.otobusYazi} numberOfLines={1}>
            <Text style={s.kalin}>{otobus.durum === 'durakta' ? 'Durakta' : 'Yaklaşıyor'}</Text>
            <Text style={s.otobusYas}>{`  ${yasYaz(otobus.yasSn)}`}</Text>
          </Text>
        )}
      </Animated.View>
    </Pressable>
  );
}

const stiller = (t: Tema) =>
  StyleSheet.create({
    kok: { flex: 1, backgroundColor: t.yuzey },
    tepe: { paddingHorizontal: 14, paddingBottom: 12 },
    tepeSade: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.cizgi },
    tepeSatir: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    tepeBaslik: { fontSize: 17, fontWeight: '800', letterSpacing: -0.2 },
    tepeAlt: { fontSize: 12, opacity: 0.85, marginTop: 1 },
    yaprakBas: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 10 },
    yaprakBaslik: { fontSize: 16, fontWeight: '700', color: t.yazi },
    yaprakAlt: { fontSize: 12.5, color: t.soluk },
    yaprakAltSatir: { flexDirection: 'row', alignItems: 'baseline', marginTop: 1 },
    yonSeridi: {
      flexGrow: 0,
      height: 76,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.cizgi,
    },
    yonlar: { gap: 8, paddingVertical: 6, paddingBottom: 12, alignItems: 'center' },
    yon: {
      maxWidth: 240,
      height: 52,
      paddingHorizontal: 14,
      justifyContent: 'center',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.cizgi,
      backgroundColor: t.yuzeyIkincil,
    },
    yonYazi: { fontSize: 13.5, lineHeight: 18, fontWeight: '700', color: t.yazi },
    yonSayi: { fontSize: 11.5, lineHeight: 15, color: t.soluk, marginTop: 2 },
    tekYon: { fontSize: 13, fontWeight: '600', color: t.soluk, padding: 14 },
    liste: {},
    durak: { flexDirection: 'row', alignItems: 'center', gap: 11, height: 44 },
    cizgiSutun: { width: 16, height: '100%', alignItems: 'center', justifyContent: 'center' },
    cizgiUst: { position: 'absolute', top: 0, height: '50%', width: 3 },
    cizgiAlt: { position: 'absolute', bottom: 0, height: '50%', width: 3 },
    nokta: { width: 10, height: 10, borderRadius: 6, borderWidth: 3 },
    noktaUc: { width: 13, height: 13, borderRadius: 7 },
    durakAd: { flex: 1, fontSize: 14, color: t.yazi },
    durakAdKalin: { fontWeight: '700' },
    bos: { color: t.soluk, textAlign: 'center', padding: 20 },
    tarifeDugme: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 12,
      backgroundColor: t.vurgu,
    },
    tarifeBaslik: { fontSize: 15, fontWeight: '700', color: t.vurguYazi },
    tarifeAlt: { fontSize: 12.5, color: t.vurguYazi, opacity: 0.85, marginTop: 1 },
    dipnot: { color: t.soluk, fontSize: 12, lineHeight: 18, paddingTop: 18 },
    kalin: { fontWeight: '700', color: t.yazi },
    duyurular: { gap: 8, paddingBottom: 10 },
    canliOzet: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    canliOzetYazi: { fontSize: 12, color: t.soluk, fontWeight: '600' },
    durakEtiket: {
      fontSize: 10.5,
      fontWeight: '700',
      borderWidth: 1,
      borderRadius: 6,
      paddingHorizontal: 5,
      paddingVertical: 1,
      overflow: 'hidden',
    },
    otobus: { flexDirection: 'row', alignItems: 'center', gap: 11, height: 34 },
    // Yazının kabı satır boyunca uzanır, yazıyı dikeyde ortalar (simgeyle aynı hizada).
    otobusMetin: { flex: 1, minWidth: 0, alignSelf: 'stretch', justifyContent: 'center' },
    cizgiTam: { position: 'absolute', top: 0, bottom: 0, width: 3 },
    otobusSimge: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    otobusYazi: { fontSize: 12.5, color: t.yazi },
    otobusYas: { color: t.soluk },
    otobusSoluk: { fontSize: 12.5, color: t.soluk, fontStyle: 'italic' },
    tamami: {
      position: 'absolute',
      right: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: t.yuzey,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.cizgi,
      shadowColor: '#000',
      shadowOpacity: 0.15,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
    },
    tamamiYazi: { fontSize: 13, fontWeight: '600', color: t.vurgu },
  });

