// 4 · Durak detayı: konum, geçen hatlar ve yaklaşan seferler.

import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { Pressable } from '@/components/dokun';
import MapView, { Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  CanliAciklama,
  CevrimdisiSerit,
  Dakika,
  DuyuruKarti,
  HataKutusu,
  HatRozeti,
  Ikon,
  NabizNoktasi,
  ROZET_SUTUNU,
  TarifeEtiketi,
  useStiller,
  YaklasmaSeridi,
  DuranNotu,
  DuruyorDakika,
} from '@/components/ulasim';
import { FavoriSimgesi } from '@/components/hareketli-simgeler';
import { IskeletSatirlari } from '@/components/iskelet';
import { KayanMetin } from '@/components/kayan-metin';
import { aracVarisindanOtobus, araclariYerlestir, kalanYaz, yaklasanOtobus, yasYaz } from '@/lib/arac-konum';
import { duruyorMu, duruyorYaz, gosterilecekAraclar } from '@/lib/bekleme';
import { canliBilgi, kalkisCanli } from '@/lib/canli';
import { trKucuk } from '@/lib/metin';
import { siklikYaz } from '@/lib/siklik';
import { hatSikligi } from '@/lib/siklik-verisi';
import { favoriDegistir, useKayitlar } from '@/lib/kayitlar';
import { useKonum } from '@/lib/konum';
import { hatlarinDuyurulari, type Duyuru } from '@/lib/duyuru';
import {
  duyurulariGetir,
  durakSaatleriYedekli,
  durakVarislariGetir,
  type AracVarisi,
  type DurakDeseni,
  OtpHatasi,
  saatsizHatlariGetir,
  saatsizHatMi,
  type DurakSaatleri,
  type Hat,
  kopruyeIlgiBildir,
} from '@/lib/otp';
import { baslikYap, hatEtiketi, hatRengi, useTema, yonYaz, type Tema } from '@/lib/tema';
import { durakVarisMetni, istanbulSaatiYaz, kacDakikaSonra, kalkisGosterimi, saniyedenSaat } from '@/lib/zaman';
import { basari, secimTiki } from '@/lib/dokunsal';
import { useCanliAralik } from '@/lib/canli-aralik';
import { ekranAc, geriDon } from '@/lib/gezinti';

const YENILEME_ARALIGI = 30_000;
/** Tazelemede sırası değişen satır yeni yerine kayar, diğerleri yer açar. */
const SATIR_YERLESIMI = LinearTransition.springify().damping(20).stiffness(180);
/** Açılışta satırlar sırayla gelir; bu süreden sonra yeni gelen satır yalnız belirir. */
const ACILIS_MS = 1200;

export default function DurakEkrani() {
  const kenar = useSafeAreaInsets();
  const tema = useTema();
  const s = useStiller(stiller);
  const { id } = useLocalSearchParams<{ id: string }>();
  const konum = useKonum();
  const { favoriler } = useKayitlar();
  const [durak, setDurak] = useState<DurakSaatleri | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [cevrimdisi, setCevrimdisi] = useState<number | null>(null);
  const [yenileniyor, setYenileniyor] = useState(false);
  // Minibüs ve dolmuş: saatleri yok; aynı meydandaki aynı adlı duraklardan da toplanıyor.
  const [saatsiz, setSaatsiz] = useState<Hat[]>([]);
  const [tumDuyurular, setTumDuyurular] = useState<Duyuru[]>([]);
  const [tumDuyurularAcik, setTumDuyurularAcik] = useState(false);
  useEffect(() => {
    let acik = true;
    duyurulariGetir().then((l) => acik && setTumDuyurular(l));
    return () => {
      acik = false;
    };
  }, []);

  const yukle = useCallback(async () => {
    if (!id) return;
    try {
      const { durak: sonuc, cevrimdisi: kayitZamani } = await durakSaatleriYedekli(id);
      if (!sonuc) setHata('Bu durak bulunamadı.');
      else {
        setDurak(sonuc);
        setCevrimdisi(kayitZamani);
        setHata(null);
      }
    } catch (e) {
      setHata(e instanceof OtpHatasi ? e.message : 'Durak bilgisi yüklenemedi.');
    }
  }, [id]);

  useEffect(() => {
    yukle();
  }, [yukle]);
  // Satırların ilk gelişi sırayla (açılış); sonraki tazelemelerde yeni satır yalnız belirir.
  const [acildi, setAcildi] = useState(false);
  useEffect(() => {
    if (!durak || acildi) return;
    const t = setTimeout(() => setAcildi(true), ACILIS_MS);
    return () => clearTimeout(t);
  }, [durak, acildi]);
  const satirGirisi = (i: number) =>
    acildi
      ? FadeIn.duration(300)
      : FadeInDown.delay(40 + Math.min(i, 10) * 55)
          .duration(360)
          .easing(Easing.out(Easing.cubic));
  useCanliAralik(yukle, YENILEME_ARALIGI);

  // Bu durağın otobüs hatlarını köprü öncelikle tarasın; favoriyse kalıcı olarak.
  const favoriMi = favoriler.some((f) => f.gtfsId === id);
  useEffect(() => {
    if (!durak) return;
    kopruyeIlgiBildir(
      (durak.routes ?? []).map((r) => r.shortName),
      favoriMi,
    );
  }, [durak, favoriMi]);

  // Saatsiz hatlar değişmiyor; durak bir kez geldiğinde bir kez sorulur.
  const durakKimligi = durak?.gtfsId;
  useEffect(() => {
    if (!durak || !durakKimligi) return;
    let gecerli = true;
    saatsizHatlariGetir(durak)
      .then((hatlar) => gecerli && setSaatsiz(hatlar))
      .catch(() => gecerli && setSaatsiz((durak.routes ?? []).filter(saatsizHatMi)));
    return () => {
      gecerli = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durakKimligi]);

  // Köprünün araç tabanlı varışları ("Otobüsüm Nerede?" gibi): durağa gelen her otobüs,
  // sefer eşleştirmesinden bağımsız. Durak her tazelendiğinde (ve peronları için) sorulur.
  const [aracVarislari, setAracVarislari] = useState<Record<string, Record<string, AracVarisi[]>>>({});
  useEffect(() => {
    if (!durak?.gtfsId) return;
    let gecerli = true;
    const peronlar = (durak.desenler ?? []).flatMap((d) => (d.stoptimes ?? []).map((k) => k?.stop?.gtfsId ?? ''));
    durakVarislariGetir([durak.gtfsId, ...peronlar]).then((v) => gecerli && setAracVarislari(v));
    return () => {
      gecerli = false;
    };
  }, [durak]);

  const ad = baslikYap(durak?.name);

  const hatlar = useMemo(() => {
    // Minibüs ve dolmuş çipleri hep "Minibüs" yazıyordu; onlar aşağıda güzergâhlarıyla ayrı listeleniyor.
    const liste = [...(durak?.routes ?? [])].filter((r) => r.shortName && !saatsizHatMi(r));
    const tekil = [...new Map(liste.map((r) => [r.shortName, r])).values()];
    return tekil.sort((a, b) => (a.shortName ?? '').localeCompare(b.shortName ?? '', 'tr', { numeric: true }));
  }, [durak]);

  // Her hattın her yönü kendi satırında: kalabalık duraklarda tek bir karışık listede
  // bazı hatlar hiç görünmüyordu. Satırlar en yakın kalkışa göre sıralanır.
  const yonler = useMemo(() => {
    const simdi = Date.now();
    const ad = trKucuk(durak?.name ?? '').trim();
    const hatKoduOf = (d: DurakDeseni) =>
      (d.pattern?.route?.shortName ?? '').trim().toLocaleUpperCase('tr-TR');
    const kimlik = (g?: string | null) => (g ?? '').slice((g ?? '').lastIndexOf(':') + 1);
    // Her satırın peronu, desendeki yeri ve bu duraktan sonraki durak.
    const satirYeri = (d: DurakDeseni) => {
      // Bu yöne gelen en yakın otobüs: desenin durak sırasında bu durak kaçıncı,
      // otobüs nerede. İstasyondan (birden çok peron) gelindiyse ad tutan durak.
      const desenDuraklari = d.pattern?.stops ?? [];
      // İstasyon ekranında kalkışın hangi perondan olduğu kalkışın kendisinde yazıyor.
      // Ring hatları istasyonun iki peronundan da (gidişte ve dönüşte) geçiyor.
      const peron = (d.stoptimes ?? []).find((k) => k?.stop?.gtfsId)?.stop?.gtfsId;
      let sira = peron ? desenDuraklari.findIndex((x) => x.gtfsId === peron) : -1;
      if (sira < 0) sira = desenDuraklari.findIndex((x) => x.gtfsId === durak?.gtfsId);
      if (sira < 0 && ad) sira = desenDuraklari.findIndex((x) => trKucuk(x.name ?? '').trim() === ad);
      return { desenDuraklari, peron, sira, sonraki: sira >= 0 ? kimlik(desenDuraklari[sira + 1]?.gtfsId) : '' };
    };
    // Satırı olmayan güzergâh varyantının otobüsü (ör. günün son seferi geçmiş varyant,
    // 89C T1087 "Harbiye → İkitelli Garajı") hangi satıra: aynı peronda bu duraktan sonra
    // aynı durağa giden (aynı yöne) satır; yoksa hattın o perondaki ilk satırı. Eskiden
    // hattın başka satırında kendi otobüsü varsa bu otobüs hiçbir satıra girmiyordu.
    const desenler = durak?.desenler ?? [];
    const yerler = desenler.map(satirYeri);
    const satirRotalariHat = new Map<string, Set<string>>();
    desenler.forEach((d) => {
      const h = hatKoduOf(d);
      if (!satirRotalariHat.has(h)) satirRotalariHat.set(h, new Set());
      satirRotalariHat.get(h)!.add(kimlik(d.pattern?.route?.gtfsId));
    });
    const sahipsizSatiri = (hat: string, durakId: string, v: AracVarisi): number => {
      const adaylar = desenler
        .map((d, i) => i)
        .filter((i) => hatKoduOf(desenler[i]) === hat && (yerler[i].peron ?? durak?.gtfsId ?? '') === durakId);
      if (!adaylar.length) return -1;
      return adaylar.find((i) => !!v.sonrakiDurak && yerler[i].sonraki === v.sonrakiDurak) ?? adaylar[0];
    };
    const liste = desenler
      .map((d, satirNo) => {
        const { desenDuraklari, peron, sira } = yerler[satirNo];
        const ilkSefer = (d.stoptimes ?? []).find((k) => k)?.trip?.gtfsId;
        const yaklasan =
          sira >= 0 && d.pattern?.vehiclePositions?.length
            ? yaklasanOtobus(araclariYerlestir(desenDuraklari, d.pattern.vehiclePositions, simdi), sira, ilkSefer)
            : null;
        let kalkislar = (d.stoptimes ?? [])
          .map((k) => ({
            saniye: k.realtimeDeparture ?? k.scheduledDeparture ?? 0,
            an: (k.serviceDay ?? 0) + (k.realtimeDeparture ?? k.scheduledDeparture ?? 0),
            canli: kalkisCanli(k),
            kimlik: k.trip?.gtfsId ?? null,
            dakika: kacDakikaSonra(k.serviceDay ?? 0, k.realtimeDeparture ?? k.scheduledDeparture ?? 0),
            duruyorSn: null as number | null,
          }))
          .filter((k) => k.dakika >= 0)
          .sort((a, b) => a.dakika - b.dakika);
        // Köprü bu durağa gelen otobüsleri görüyorsa onlar: tarife yalnız son görülenden sonrası.
        const hatKodu = hatKoduOf(d);
        const durakId = peron ?? durak?.gtfsId ?? '';
        const hepsi = aracVarislari[durakId]?.[hatKodu] ?? [];
        // Aynı hattın birkaç güzergâh satırı varsa (halka, varyant) her otobüs kendi
        // güzergâhının satırına; satırı olmayan varyantın otobüsü aynı yöne giden satıra.
        const satirRotalari = satirRotalariHat.get(hatKodu) ?? new Set<string>();
        const araclar = hepsi
          .filter((v) =>
            v.rotaId && satirRotalari.has(v.rotaId)
              ? v.rotaId === kimlik(d.pattern?.route?.gtfsId)
              : sahipsizSatiri(hatKodu, durakId, v) === satirNo,
          )
          .sort((a, b) => a.varis - b.varis);
        let yaklasanArac: typeof yaklasan = null;
        // Duran otobüs (mola, park): arkasından hareket eden varken kalkış olmaz, not olarak
        // yazılır; tek otobüs oysa "Duruyor" ve en erken varışı (gosterilecekAraclar).
        let duranNot: { kalan: number; sn: number } | null = null;
        if (araclar.length) {
          const son = araclar[araclar.length - 1].varis;
          const { ana, duran } = gosterilecekAraclar(araclar);
          kalkislar = [
            ...ana.map((v) => ({
              saniye: Math.round((v.varis / 1000 + 3 * 3600) % 86_400),
              an: Math.round(v.varis / 1000),
              // Araç tabanlı: tarifeden sapma yok, "canlı" olduğu yeter. Duran otobüsün
              // saati yalnız "en erken": canlı varış sayılmaz.
              canli: duruyorMu(v) ? null : canliBilgi(0),
              kimlik: `arac:${v.kapiNo}` as string | null,
              dakika: Math.max(0, Math.round((v.varis - simdi) / 60_000)),
              duruyorSn: v.duruyorSn ?? null,
            })),
            ...kalkislar.filter((k) => k.an * 1000 > son + 3 * 60_000),
          ];
          yaklasanArac = { otobus: aracVarisindanOtobus(ana[0]), kalan: ana[0].kalanDurak };
          if (duran && !duruyorMu(ana[0])) duranNot = { kalan: duran.kalanDurak, sn: duran.duruyorSn ?? 0 };
        }
        return {
          anahtar: `${d.pattern?.code ?? ''}|${peron ?? ''}`,
          desen: d.pattern?.code ?? '',
          sonrakiDurak: sira >= 0 ? baslikYap(desenDuraklari[sira + 1]?.name) : '',
          hat: d.pattern?.route ?? null,
          yon: baslikYap(d.pattern?.headsign) || baslikYap(d.pattern?.route?.longName),
          // Minibüs ve dolmuşta rozet yalnızca araç tipini yazıyor; güzergâh buraya düşüyor.
          guzergah: hatEtiketi(d.pattern?.route?.shortName, d.pattern?.route?.mode, d.pattern?.route?.agency?.name)
            .ayrinti,
          kalkislar,
          yaklasan: yaklasanArac ?? yaklasan,
          duranNot,
        };
      })
      .filter((x) => x.hat && x.kalkislar.length > 0);
    // Aynı desen iki perondan geçiyorsa (ring) iki satır aynı adı taşır; hangisinin hangi
    // yöne gittiği sıradaki durağın adından anlaşılsın.
    const desenSayisi = new Map<string, number>();
    for (const x of liste) desenSayisi.set(x.desen, (desenSayisi.get(x.desen) ?? 0) + 1);
    for (const x of liste) {
      if ((desenSayisi.get(x.desen) ?? 0) > 1 && x.sonrakiDurak) {
        x.guzergah = [x.guzergah, `sonraki durak: ${x.sonrakiDurak}`].filter(Boolean).join(' · ');
      }
    }
    return liste.sort((a, b) => a.kalkislar[0].dakika - b.kalkislar[0].dakika);
  }, [durak, aracVarislari]);

  // Gündüz seferleri sıklıkla tanımlı hatlar (Marmaray, M7, M11, T5, T6 …): OTP bunların
  // kalkışlarını döndürmüyor, satırları hiç görünmüyordu. Saat yerine sıklık yazılıyor.
  const siklikliHatlar = useMemo(
    () =>
      hatlar
        .filter((h) => !yonler.some((y) => y.hat?.gtfsId === h.gtfsId))
        .map((h) => ({ hat: h, metin: siklikYaz(hatSikligi(h.shortName)) }))
        .filter((x): x is { hat: Hat; metin: string } => !!x.metin),
    [hatlar, yonler],
  );

  // Ekranda canlı kalkış varsa, canlı olmayanlar "tarifeye göre" diye ayrılıyor.
  // Bütünüyle tarifeli bir durakta (metro, vapur) her satıra bunu yazmak gürültü olur.
  const canliVar = yonler.some((y) => y.kalkislar[0].canli);

  const yolTarifi = () => {
    if (durak?.lat == null || durak.lon == null) return;
    ekranAc({
      pathname: '/rota',
      params: {
        kLat: String(konum.nokta.latitude),
        kLon: String(konum.nokta.longitude),
        kAd: konum.tur === 'gercek' ? 'Konumum' : 'Kadıköy (örnek konum)',
        vLat: String(durak.lat),
        vLon: String(durak.lon),
        vAd: ad,
      },
    });
  };

  // Harita işareti, duraktan geçen ilk hattın rengini alır (metro durağı mavi, vapur iskelesi lacivert…).
  const isaretRengi = hatlar.length ? hatRengi(hatlar[0], tema) : tema.vurgu;

  return (
    <View style={s.kok}>
      {durak?.lat != null && durak.lon != null ? (
        <MapView
          style={s.harita}
          userInterfaceStyle={tema.haritaStili}
          initialRegion={{ latitude: durak.lat, longitude: durak.lon, latitudeDelta: 0.006, longitudeDelta: 0.006 }}
          showsPointsOfInterests={false}
          toolbarEnabled={false}
          scrollEnabled={false}
          zoomEnabled={false}
        >
          <Marker coordinate={{ latitude: durak.lat, longitude: durak.lon }} title={ad} pinColor={isaretRengi} />
        </MapView>
      ) : (
        <View style={[s.harita, { backgroundColor: tema.haritaZemin }]} />
      )}

      <View style={[s.ustDugmeler, { top: kenar.top + 8 }]}>
        <Pressable hitSlop={4} style={s.yuvarlak} onPress={geriDon} accessibilityLabel="Geri">
          <Ikon ad="chevron-back" boyut={22} />
        </Pressable>
      </View>

      <ScrollView
        style={s.govde}
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: kenar.bottom + 24 }}
        refreshControl={
          <RefreshControl
            refreshing={yenileniyor}
            tintColor={tema.vurgu}
            onRefresh={async () => {
              setYenileniyor(true);
              await yukle();
              setYenileniyor(false);
            }}
          />
        }
      >
        <CevrimdisiSerit zaman={cevrimdisi} tekrarDene={yukle} />
        {hata && <HataKutusu mesaj={hata} tekrarDene={yukle} />}
        {!durak && !hata && (
          <View style={{ gap: 6 }} accessible accessibilityLabel="Durak bilgisi yükleniyor">
            <Text style={s.bilgi}>Durak bilgisi yükleniyor…</Text>
            <IskeletSatirlari />
          </View>
        )}
        {durak && (
          <>
            <View style={{ gap: 4 }}>
              <Text style={s.baslik}>{ad}</Text>
              <Text style={s.bilgi}>
                {[durak.code ? `Durak kodu ${durak.code}` : '', yonYaz(durak.desc)].filter(Boolean).join(' · ')}
              </Text>
            </View>

            <View style={s.eylemler}>
              <Pressable
                style={s.eylem}
                onPress={() => {
                  (favoriMi ? secimTiki : basari)();
                  favoriDegistir({ gtfsId: durak.gtfsId, ad });
                }}
                accessibilityState={{ selected: favoriMi }}
              >
                <FavoriSimgesi dolu={favoriMi} tur="heart" boyut={16} renk={tema.vurgu} />
                <Text style={s.eylemYazi}>{favoriMi ? 'Favorilerde' : 'Favorilere ekle'}</Text>
              </Pressable>
              <Pressable style={[s.eylem, s.eylemDolu]} onPress={yolTarifi}>
                <Ikon ad="navigate" boyut={16} renkKodu={tema.vurguYazi} />
                <Text style={[s.eylemYazi, { color: tema.vurguYazi }]}>Yol tarifi</Text>
              </Pressable>
            </View>

            {hatlar.length > 0 && (
              <View style={{ gap: 8 }}>
                <Text style={s.altBaslik}>BU DURAKTAN GEÇEN HATLAR</Text>
                <View style={s.hatlar}>
                  {hatlar.map((h) => (
                    <Pressable
                      key={h.gtfsId}
                      onPress={() =>
                        ekranAc({
                          pathname: '/hat/[id]',
                          params: { id: h.gtfsId, durak: durak?.gtfsId ?? '', durakAd: durak?.name ?? '' },
                        })
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`${h.shortName ?? ''} hattının detayı`}
                    >
                      <HatRozeti hat={h} />
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            {(() => {
              // Bu duraktan geçen hatların duyuruları; kalabalık duraklarda ilk üçü, gerisi dokununca.
              const liste = hatlarinDuyurulari(
                tumDuyurular,
                hatlar.map((h) => h.shortName),
              );
              if (!liste.length) return null;
              const gorunen = tumDuyurularAcik ? liste : liste.slice(0, 3);
              return (
                <View style={{ gap: 8 }}>
                  <Text style={s.altBaslik}>DUYURULAR</Text>
                  {gorunen.map((d, i) => (
                    <DuyuruKarti
                      key={i}
                      duyuru={d}
                      hat={
                        hatlar.find((h) =>
                          (d.kodlar ?? [d.hat]).includes((h.shortName ?? '').toLocaleUpperCase('tr-TR')),
                        ) ?? null
                      }
                    />
                  ))}
                  {liste.length > gorunen.length && (
                    <Pressable onPress={() => setTumDuyurularAcik(true)} accessibilityRole="button">
                      <Text style={[s.bilgi, { color: tema.vurgu, fontWeight: '700' }]}>
                        {`${liste.length - gorunen.length} duyuru daha`}
                      </Text>
                    </Pressable>
                  )}
                </View>
              );
            })()}

            {(yonler.length > 0 || siklikliHatlar.length > 0 || saatsiz.length === 0) && (
            <View style={{ gap: 4 }}>
              <Text style={s.altBaslik}>YÖNE GÖRE SONRAKİ KALKIŞLAR</Text>
              {yonler.length === 0 && siklikliHatlar.length === 0 && (
                <Text style={s.bos}>Önümüzdeki 3 saatte bu duraktan sefer görünmüyor.</Text>
              )}
              {yonler.map((y, i) => (
                <Animated.View key={y.anahtar} entering={satirGirisi(i)} exiting={FadeOut.duration(220)} layout={SATIR_YERLESIMI}>
                <Pressable
                  style={s.sefer}
                  onPress={() =>
                    y.hat &&
                    ekranAc({
                      pathname: '/hat/[id]',
                      // Hat ekranı bu yönü açsın, bu durağı işaretlesin: yaklaşan otobüsler görünsün.
                      params: { id: y.hat.gtfsId, desen: y.desen, durak: durak?.gtfsId ?? '', durakAd: durak?.name ?? '' },
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={[
                    y.hat?.shortName ?? '',
                    y.yon,
                    y.kalkislar[0].duruyorSn != null
                      ? `otobüs ${duruyorYaz(y.kalkislar[0].duruyorSn)} duruyor`
                      : kalkisGosterimi(y.kalkislar[0].an).seslendirme,
                    y.kalkislar[0].canli ? `canlı, ${durakVarisMetni(y.kalkislar[0].an)}` : canliVar ? 'tarifeye göre' : '',
                    y.yaklasan ? `otobüs ${kalanYaz(y.yaklasan.kalan)}` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                >
                  <View style={{ minWidth: ROZET_SUTUNU }}>
                    <HatRozeti hat={y.hat} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.seferYon} numberOfLines={1}>
                      {y.yon || 'Yön bilgisi yok'}
                    </Text>
                    {!!y.guzergah && (
                      <Text style={s.seferGuzergah} numberOfLines={1}>
                        {y.guzergah}
                      </Text>
                    )}
                    {y.kalkislar[0].duruyorSn != null ? null : y.kalkislar[0].canli ? (
                      <CanliAciklama an={y.kalkislar[0].an} />
                    ) : canliVar ? (
                      <TarifeEtiketi saat={istanbulSaatiYaz(y.kalkislar[0].an)} />
                    ) : null}
                    {y.yaklasan && (
                      // Otobüs görünmeye başlayınca şerit belirir; sayısı kayar.
                      <Animated.View entering={FadeIn.duration(350)} exiting={FadeOut.duration(200)} style={s.yaklasma}>
                        <YaklasmaSeridi
                          kalan={y.yaklasan.kalan}
                          renk={y.hat ? hatRengi(y.hat, tema) : tema.vurgu}
                          soluk={y.yaklasan.otobus.sinif === 'eski'}
                          duruyor={y.kalkislar[0].duruyorSn != null}
                        />
                        <KayanMetin metin={`Otobüs ${kalanYaz(y.yaklasan.kalan)}`} style={[s.yaklasmaYazi, s.yaklasmaKalin]} />
                        <Text style={[s.yaklasmaYazi, { flex: 1 }]} numberOfLines={1}>
                          {` · ${yasYaz(y.yaklasan.otobus.yasSn)}`}
                        </Text>
                      </Animated.View>
                    )}
                    {y.kalkislar[0].duruyorSn != null && (
                      <DuranNotu metin={`${duruyorYaz(y.kalkislar[0].duruyorSn)} duruyor, arkasında otobüs yok`} />
                    )}
                    {!!y.duranNot && (
                      <DuranNotu
                        metin={
                          y.duranNot.kalan === 0
                            ? `Bir otobüs durakta ${duruyorYaz(y.duranNot.sn)} bekliyor`
                            : `Bir otobüs ${y.duranNot.kalan} durak geride ${duruyorYaz(y.duranNot.sn)} duruyor`
                        }
                      />
                    )}
                    {y.kalkislar[0].canli || canliVar || y.kalkislar[0].duruyorSn != null ? (
                      // İlk kalkışın saati üstteki satırda; burada yalnız sonrakiler.
                      y.kalkislar.length > 1 && (
                        <Text style={s.seferSaat}>
                          {y.kalkislar[0].duruyorSn != null ? 'tarifede sonra ' : 'sonra '}
                          {y.kalkislar.slice(1, 3).map((k) => saniyedenSaat(k.saniye)).join(' · ')}
                        </Text>
                      )
                    ) : (
                      <Text style={s.seferSaat}>
                        {y.kalkislar.slice(0, 3).map((k) => saniyedenSaat(k.saniye)).join('  ·  ')}
                      </Text>
                    )}
                  </View>
                  {y.kalkislar[0].duruyorSn != null ? (
                    <DuruyorDakika an={y.kalkislar[0].an} />
                  ) : (
                    <Dakika an={y.kalkislar[0].an} canli={y.kalkislar[0].canli} kimlik={y.kalkislar[0].kimlik} />
                  )}
                </Pressable>
                </Animated.View>
              ))}
              {siklikliHatlar.map(({ hat: h, metin }, i) => (
                <Animated.View
                  key={`siklik-${h.gtfsId}`}
                  entering={satirGirisi(yonler.length + i)}
                  exiting={FadeOut.duration(220)}
                  layout={SATIR_YERLESIMI}
                >
                <Pressable
                  style={s.sefer}
                  onPress={() =>
                        ekranAc({
                          pathname: '/hat/[id]',
                          params: { id: h.gtfsId, durak: durak?.gtfsId ?? '', durakAd: durak?.name ?? '' },
                        })
                      }
                  accessibilityRole="button"
                  accessibilityLabel={[h.shortName ?? '', baslikYap(h.longName), metin].filter(Boolean).join(' · ')}
                >
                  <View style={{ minWidth: ROZET_SUTUNU }}>
                    <HatRozeti hat={h} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.seferYon} numberOfLines={1}>
                      {baslikYap(h.longName) || h.shortName}
                    </Text>
                    <Text style={s.seferSaat}>{metin}</Text>
                  </View>
                  <Ikon ad="chevron-forward" boyut={16} renkKodu={tema.soluk} />
                </Pressable>
                </Animated.View>
              ))}
            </View>
            )}

            {saatsiz.length > 0 && (
              <View style={{ gap: 4 }}>
                <Text style={s.altBaslik}>MİNİBÜS VE DOLMUŞ</Text>
                {saatsiz.map((h) => {
                  const guzergah = hatEtiketi(h.shortName, h.mode, h.agency?.name).ayrinti;
                  return (
                    <Pressable
                      key={h.gtfsId}
                      style={s.sefer}
                      onPress={() =>
                        ekranAc({
                          pathname: '/hat/[id]',
                          params: { id: h.gtfsId, durak: durak?.gtfsId ?? '', durakAd: durak?.name ?? '' },
                        })
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`${guzergah || h.shortName || ''}, saat bilgisi yok`}
                    >
                      <View style={{ minWidth: ROZET_SUTUNU }}>
                        <HatRozeti hat={h} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.seferYon} numberOfLines={2}>
                          {guzergah || baslikYap(h.shortName)}
                        </Text>
                        <Text style={s.seferSaat}>
                          {siklikYaz(hatSikligi(h.shortName)) ??
                            'Saat bilgisi yok · sık aralıklarla çalışır'}
                        </Text>
                      </View>
                      <Ikon ad="chevron-forward" boyut={16} renkKodu={tema.soluk} />
                    </Pressable>
                  );
                })}
              </View>
            )}

            {canliVar ? (
              <View style={s.tarife}>
                <NabizNoktasi renk={tema.vurgu} boyut={6} />
                <Text style={s.tarifeYazi}>
                  Canlı saatler İETT araç konumundan geliyor, 2 dakikada bir tazeleniyor. Metro, Marmaray, vapur ve
                  henüz öğrenilmemiş hatlar tarifeye göre.
                </Text>
              </View>
            ) : (
              <View style={s.tarife}>
                <View style={s.tarifeNokta} />
                <Text style={s.tarifeYazi}>
                  Süreler tarifeye göre. Metro, Marmaray ve vapur saatleri İBB'nin eski verisinden geldiği için
                  yaklaşık.
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const stiller = (t: Tema) =>
  StyleSheet.create({
  kok: { flex: 1, backgroundColor: t.yuzey },
  harita: { height: 230 },
  ustDugmeler: { position: 'absolute', left: 14 },
  yuvarlak: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: t.yuzey,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  govde: { flex: 1, marginTop: -22, backgroundColor: t.yuzey, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  baslik: { fontSize: 23, fontWeight: '800', color: t.yazi, letterSpacing: -0.3 },
  bilgi: { fontSize: 12.5, color: t.soluk },
  eylemler: { flexDirection: 'row', gap: 8 },
  eylem: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', height: 40, borderRadius: 11, backgroundColor: t.vurguAcik },
  eylemDolu: { backgroundColor: t.vurgu },
  eylemYazi: { fontWeight: '700', fontSize: 13, color: t.vurgu },
  altBaslik: { fontSize: 11.5, letterSpacing: 0.8, color: t.soluk, fontWeight: '700' },
  hatlar: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  bos: { color: t.soluk, paddingVertical: 10 },
  sefer: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.cizgi },
  seferYon: { fontSize: 13.5, fontWeight: '600', color: t.yazi },
  seferGuzergah: { fontSize: 12, color: t.soluk, marginTop: 1 },
  seferSaat: { fontSize: 12, color: t.soluk, fontVariant: ['tabular-nums'] },
  tarife: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tarifeNokta: { width: 8, height: 8, borderRadius: 4, backgroundColor: t.yurume },
  tarifeYazi: { flex: 1, fontSize: 11.5, color: t.soluk },
  yaklasma: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  yaklasmaYazi: { fontSize: 12, color: t.soluk },
  yaklasmaKalin: { color: t.yazi, fontWeight: '600' },
});
