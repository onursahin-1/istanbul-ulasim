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

import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AltYaprak } from '@/components/alt-yaprak';
import { DurakIsareti, OtobusIsareti } from '@/components/harita-isaretleri';
import { canliRenk, DuyuruKarti, HataKutusu, HatRozeti, Ikon, NabizNoktasi, useStiller, Yukleniyor } from '@/components/ulasim';
import { hattinDuyurulari, type Duyuru } from '@/lib/duyuru';
import {
  araclariYerlestir,
  gecikmeKisa,
  kalanYaz,
  yaklasanOtobus,
  yasYaz,
  type HamArac,
  type YerlesikArac,
} from '@/lib/arac-konum';
import { polylineCoz, type Nokta } from '@/lib/cografya';
import { canliBilgi } from '@/lib/canli';
import { trKucuk } from '@/lib/metin';
import { duyurulariGetir, hatAraclariGetir, hatDetayiGetir, OtpHatasi, type HatDetayi } from '@/lib/otp';
import { aracAdi, baslikYap, haritaRengi, hatRengi, useTema, yaziRengi, type Tema } from '@/lib/tema';

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

  const [hat, setHat] = useState<HatDetayi | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [yon, setYon] = useState<number | null>(null);
  const [araclar, setAraclar] = useState<Record<string, HamArac[]>>({});
  const [simdi, setSimdi] = useState(() => Date.now());
  const [tumDuyurular, setTumDuyurular] = useState<Duyuru[]>([]);
  useEffect(() => {
    let acik = true;
    duyurulariGetir().then((l) => acik && setTumDuyurular(l));
    return () => {
      acik = false;
    };
  }, []);
  const liste = useRef<{ kaydir: (y: number) => void }>(null);
  const kaydirildi = useRef(false);
  const harita = useRef<MapView>(null);
  const [alan, setAlan] = useState(0);
  const [yaprakBoyu, setYaprakBoyu] = useState(300);
  const haritaHazir = useRef(false);
  const sigdirilan = useRef('');

  const yukle = useCallback(async () => {
    if (!id) return;
    setHata(null);
    try {
      const sonuc = await hatDetayiGetir(id);
      if (!sonuc) setHata('Bu hat bulunamadı.');
      else setHat(sonuc);
    } catch (e) {
      setHata(e instanceof OtpHatasi ? e.message : 'Hat bilgisi yüklenemedi.');
    }
  }, [id]);

  useEffect(() => {
    yukle();
  }, [yukle]);

  // Otobüs konumları yarım dakikada bir; yaşları 15 saniyede bir yeniden yazılır.
  // Konum alınamazsa sessizce geçilir: canlı konum süs, hat ekranı onsuz da çalışır.
  useEffect(() => {
    if (!id) return;
    let acik = true;
    const araclariYukle = () =>
      hatAraclariGetir(id)
        .then((sonuc) => {
          if (!acik) return;
          setAraclar(sonuc);
          setSimdi(Date.now());
        })
        .catch(() => {});
    araclariYukle();
    const konum = setInterval(araclariYukle, 30_000);
    const saat = setInterval(() => setSimdi(Date.now()), 15_000);
    return () => {
      acik = false;
      clearInterval(konum);
      clearInterval(saat);
    };
  }, [id]);

  // Duraksız desenler listeye girmez; en çok durağı olan desen varsayılan yön olur.
  const desenler = useMemo(() => {
    const liste = (hat?.patterns ?? []).filter((d) => (d.stops?.length ?? 0) > 1);
    return liste.sort((a, b) => (b.stops?.length ?? 0) - (a.stops?.length ?? 0));
  }, [hat]);

  // Seçim yapılmadıysa: durak ekranından gelinen yön, yoksa en uzun desen.
  const baslangicYonu = Math.max(0, desenler.findIndex((d) => d.code === desen));
  const yonNo = Math.min(yon ?? baslangicYonu, Math.max(desenler.length - 1, 0));
  const secili = desenler[yonNo];
  const duraklar = useMemo(() => secili?.stops ?? [], [secili]);

  // İşaretlenecek durak: kimliği tutan, tutmuyorsa (istasyondan gelindi) adı tutan.
  const isaretli = useMemo(() => {
    if (!gelinenDurak && !durakAd) return -1;
    const kimlikle = duraklar.findIndex((d) => d.gtfsId === gelinenDurak);
    if (kimlikle >= 0) return kimlikle;
    const ad = trKucuk(durakAd ?? '').trim();
    return ad ? duraklar.findIndex((d) => trKucuk(d.name ?? '').trim() === ad) : -1;
  }, [duraklar, gelinenDurak, durakAd]);

  const otobusler = useMemo(
    () => (secili ? araclariYerlestir(duraklar, araclar[secili.code], simdi) : []),
    [secili, duraklar, araclar, simdi],
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
  const yaziKodu = yaziRengi(seritRengi);

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
              onPress={() => setYon(i)}
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
      <View style={[s.tepe, { backgroundColor: seritRengi, paddingTop: kenar.top + 6 }]}>
        <View style={s.tepeSatir}>
          <Pressable onPress={() => router.back()} accessibilityLabel="Geri" hitSlop={12}>
            <Ikon ad="chevron-back" boyut={24} renkKodu={yaziKodu} />
          </Pressable>
          {hat && <HatRozeti hat={hat} />}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[s.tepeBaslik, { color: yaziKodu }]} numberOfLines={1}>
              {baslikYap(hat?.longName) || hat?.shortName || 'Hat'}
            </Text>
            <Text style={[s.tepeAlt, { color: yaziKodu }]} numberOfLines={1}>
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
                  onCalloutPress={() => router.push({ pathname: '/durak/[id]', params: { id: d.gtfsId } })}
                  tracksViewChanges={false}
                  zIndex={i === isaretli ? 5 : 1}
                >
                  <DurakIsareti renk={seritRengi} isaretli={i === isaretli} />
                </Marker>
              ) : null,
            )}
            {otobusler.map((o) => (
              <Marker
                key={o.kimlik}
                coordinate={{ latitude: o.lat, longitude: o.lon }}
                anchor={{ x: 0.5, y: 0.5 }}
                title={`Otobüs ${o.etiket}`}
                description={otobusAciklamasi(o, baslikYap(duraklar[o.durak]?.name))}
                zIndex={10}
              >
                <OtobusIsareti renk={seritRengi} yon={o.heading} soluk={o.sinif === 'eski'} />
              </Marker>
            ))}
          </MapView>

          {alan > 0 && (
            <AltYaprak
              kapsayiciYukseklik={alan}
              ustPay={48}
              kapaliYukseklik={80}
              ortaOran={0.5}
              onDurum={(_, boy) => setYaprakBoyu(boy)}
              erisilebilirlikEtiketi="Durak listesini aç ya da kapat"
              listeRef={liste}
              baslik={
                <View style={s.yaprakBas}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.yaprakBaslik} numberOfLines={1}>
                      {yonAdi(secili) || 'Duraklar'}
                    </Text>
                    <Text style={s.yaprakAlt} numberOfLines={1}>
                      {yaklasan && isaretli >= 0
                        ? `Durağına en yakın otobüs ${kalanYaz(yaklasan.kalan)}`
                        : `${duraklar.length} durak`}
                    </Text>
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
              {duraklar.length === 0 && <Text style={s.bos}>Bu hattın durak bilgisi veride yok.</Text>}
              <View style={s.liste}>
                {duraklar.map((d, i) => {
                  const ilk = i === 0;
                  const son = i === duraklar.length - 1;
                  const buDurak = i === isaretli;
                  return (
                    <View
                      key={`${d.gtfsId}-${i}`}
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
                        onPress={() => router.push({ pathname: '/durak/[id]', params: { id: d.gtfsId } })}
                        accessibilityRole="button"
                      >
                        <View style={s.cizgiSutun}>
                          {!ilk && <View style={[s.cizgiUst, { backgroundColor: renkKodu }]} />}
                          {!son && <View style={[s.cizgiAlt, { backgroundColor: renkKodu }]} />}
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
                        <OtobusSatiri
                          key={o.kimlik}
                          otobus={o}
                          renkKodu={renkKodu}
                          sonDurak={son}
                          durakAdi={baslikYap(duraklar[o.durak]?.name)}
                          onPress={() => otobuseGit(o)}
                        />
                      ))}
                    </View>
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

/** Haritadaki otobüsün baloncuğunda ve listede okunan kısa durum. */
function otobusAciklamasi(o: YerlesikArac, durakAdi: string): string {
  if (o.sinif === 'eski') return `${durakAdi} civarı · ${yasYaz(o.yasSn)} görüldü`;
  return [
    o.durum === 'durakta' ? `${durakAdi} durağında` : `Sıradaki durak: ${durakAdi}`,
    o.gecikme != null ? gecikmeKisa(o.gecikme) : null,
    yasYaz(o.yasSn),
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Durak listesinin arasındaki otobüs: çizginin üstünde otobüs simgesi, yanında ne
 * durumda olduğu. Taze konumda gecikme ve yaş; 5 dakikadan eskide yalnız "… civarı,
 * N dk önce görüldü", soluk.
 */
function OtobusSatiri({
  otobus,
  renkKodu,
  sonDurak,
  durakAdi,
  onPress,
}: {
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
  const gecikme = otobus.gecikme != null ? canliBilgi(otobus.gecikme) : null;
  const etiket = eski
    ? `${durakAdi} civarında, ${yasYaz(otobus.yasSn)} görüldü`
    : [
        otobus.durum === 'durakta' ? `${durakAdi} durağında` : `${durakAdi} durağına yaklaşıyor`,
        gecikme?.metin,
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
        <View style={[s.otobusSimge, { backgroundColor: simgeRengi, borderColor: tema.yuzey }]}>
          <Ikon ad="bus" boyut={12} renkKodu={tema.yuzey} />
        </View>
      </View>
      {eski ? (
        <Text style={s.otobusSoluk} numberOfLines={1}>
          {`${durakAdi} civarı · ${yasYaz(otobus.yasSn)} görüldü`}
        </Text>
      ) : (
        <Text style={s.otobusYazi} numberOfLines={1}>
          <Text style={s.kalin}>{otobus.durum === 'durakta' ? 'Durakta' : 'Yaklaşıyor'}</Text>
          {gecikme && (
            <Text style={{ color: canliRenk(gecikme.sinif, tema), fontWeight: '700' }}>
              {`  ${gecikmeKisa(otobus.gecikme!)}`}
            </Text>
          )}
          <Text style={s.otobusYas}>{`  ${yasYaz(otobus.yasSn)}`}</Text>
        </Text>
      )}
    </Pressable>
  );
}

const stiller = (t: Tema) =>
  StyleSheet.create({
    kok: { flex: 1, backgroundColor: t.yuzey },
    tepe: { paddingHorizontal: 14, paddingBottom: 12 },
    tepeSatir: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    tepeBaslik: { fontSize: 17, fontWeight: '800', letterSpacing: -0.2 },
    tepeAlt: { fontSize: 12, opacity: 0.85, marginTop: 1 },
    yaprakBas: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 10 },
    yaprakBaslik: { fontSize: 16, fontWeight: '700', color: t.yazi },
    yaprakAlt: { fontSize: 12.5, color: t.soluk, marginTop: 1 },
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
    cizgiTam: { position: 'absolute', top: 0, bottom: 0, width: 3 },
    otobusSimge: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    otobusYazi: { flex: 1, fontSize: 12.5, color: t.yazi },
    otobusYas: { color: t.soluk },
    otobusSoluk: { flex: 1, fontSize: 12.5, color: t.soluk, fontStyle: 'italic' },
  });
