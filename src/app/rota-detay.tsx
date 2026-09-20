// 3 · Rota detayı: haritada güzergâh, adım adım zaman çizelgesi ve yolculuk takibi.
// Her toplu taşıma bacağı açılabilir: içinde geçilen duraklar, seferin sıklığı ve
// günün son seferi uyarısı çıkar.

import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HatirlatmaSayfasi, type InisBilgisi } from '@/components/hatirlatma';
import { GeriCubugu, HatRozeti, Ikon, useStiller } from '@/components/ulasim';
import { useHatirlaticilar } from '@/lib/bildirim';
import { mesafeMetre, polylineCoz, type Nokta } from '@/lib/cografya';
import { bacakDuraklari, hatKalkislariGetir, type Bacak } from '@/lib/otp';
import { guzergahGetir } from '@/lib/secim';
import { seferBilgisi, sikliktanYazi, type SeferBilgisi } from '@/lib/sefer';
import { aracAdi, baslikYap, haritaRengi, hatRengi, useTema, type Tema } from '@/lib/tema';
import { isodanSaniye, mesafeYaz, saatYaz, saniyedenSaat, sureYaz } from '@/lib/zaman';

type Takip = { bacak: number; kalanDurak: number } | null;

const YAKINLIK_ESIGI = 250; // metre: telefon bir durağa bu kadar yakınsa o duraktayız sayılır

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
  const [takip, setTakip] = useState<Takip>(null);
  const [acikBacaklar, setAcikBacaklar] = useState<Record<number, boolean>>({});
  const [seferler, setSeferler] = useState<Record<number, SeferBilgisi>>({});
  const [hatirlatAcik, setHatirlatAcik] = useState(false);
  const { hatirlaticilar, yenile: hatirlaticilariYenile } = useHatirlaticilar();
  const aboneligi = useRef<Location.LocationSubscription | null>(null);
  const simulasyon = useRef<ReturnType<typeof setInterval> | null>(null);
  const uyarilanlar = useRef(new Set<string>());
  const sorulanlar = useRef(new Set<number>());

  const bacaklar = useMemo(() => guzergah?.legs ?? [], [guzergah]);
  const cizgiler = useMemo(() => bacaklar.map(bacakNoktalari), [bacaklar]);
  const duraklar = useMemo(() => bacaklar.map((b) => (b.transitLeg ? bacakDuraklari(b) : [])), [bacaklar]);

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

  const haritaYuksekligi = Math.round(height * 0.42);

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
      setTakip((onceki) => {
        const baslangic = onceki?.bacak ?? 0;
        for (let i = baslangic; i < bacaklar.length; i++) {
          const liste = duraklar[i];
          if (!liste.length) continue;
          let enYakin = -1;
          let enKisa = Infinity;
          liste.forEach((d, j) => {
            const m = mesafeMetre(nokta, { latitude: d.lat, longitude: d.lon });
            if (m < enKisa) {
              enKisa = m;
              enYakin = j;
            }
          });
          if (enKisa <= YAKINLIK_ESIGI) {
            const kalanDurak = liste.length - 1 - enYakin;
            const anahtar = `${i}-${kalanDurak}`;
            if (kalanDurak <= 2 && !uyarilanlar.current.has(anahtar)) {
              uyarilanlar.current.add(anahtar);
              Haptics.notificationAsync(
                kalanDurak === 0 ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success,
              );
            }
            return { bacak: i, kalanDurak };
          }
        }
        return onceki;
      });
    },
    [bacaklar, duraklar],
  );

  const takibiDurdur = useCallback(() => {
    aboneligi.current?.remove();
    aboneligi.current = null;
    if (simulasyon.current) clearInterval(simulasyon.current);
    simulasyon.current = null;
    setTakipAcik(false);
    setTakip(null);
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

  const takibiBaslat = async () => {
    const izin = await Location.requestForegroundPermissionsAsync();
    if (izin.status !== 'granted') {
      Alert.alert('Konum izni gerekli', 'Yolculuğunu takip edebilmemiz için ayarlardan konum iznini açman gerekiyor.');
      return;
    }
    setTakipAcik(true);
    aboneligi.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, distanceInterval: 15, timeInterval: 5000 },
      (k) => konumuIsle({ latitude: k.coords.latitude, longitude: k.coords.longitude }),
    );
  };

  // Geliştirme sırasında masadan deneyebilmek için: düğmeye basılı tutunca
  // güzergâhtaki duraklar sırayla "ziyaret edilir".
  const simulasyonuBaslat = () => {
    if (!__DEV__) return;
    const sirali = duraklar.flat();
    if (!sirali.length) return;
    takibiDurdur();
    setTakipAcik(true);
    let adim = 0;
    simulasyon.current = setInterval(() => {
      const d = sirali[adim++];
      if (!d) {
        takibiDurdur();
        return;
      }
      konumuIsle({ latitude: d.lat, longitude: d.lon });
    }, 1500);
  };

  const haritayiSigdir = () => {
    const tum = cizgiler.flat();
    if (tum.length < 2) return;
    harita.current?.fitToCoordinates(tum, {
      edgePadding: { top: kenar.top + 70, right: 40, bottom: 40, left: 40 },
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
  const bildirim = takipAcik ? bildirimMetni(bacaklar, takip) : null;

  return (
    <View style={s.kok}>
      <MapView
        ref={harita}
        style={{ height: haritaYuksekligi }}
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

      {bildirim && (
        <View style={[s.bildirim, { top: kenar.top + 8 }]} accessibilityLiveRegion="polite">
          <View style={s.bildirimIkon}>
            <Ikon ad="notifications" boyut={20} renkKodu={tema.vurguYazi} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.bildirimBaslik}>{bildirim.baslik}</Text>
            <Text style={s.bildirimMetin}>{bildirim.metin}</Text>
          </View>
        </View>
      )}

      <View style={s.panel}>
        <View style={s.tutamac} />
        <View style={s.ozet}>
          <View>
            <Text style={s.sure}>{sureYaz(guzergah.duration)}</Text>
            <Text style={s.ozetAlt}>
              {guzergah.numberOfTransfers === 0 ? 'Aktarmasız' : `${guzergah.numberOfTransfers} aktarma`} · {sureYaz(guzergah.walkTime)} yürüme
            </Text>
          </View>
          <Text style={s.ozetSaat}>{`${saatYaz(guzergah.start)}–${saatYaz(guzergah.end)}`}</Text>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 10 }}>
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

            return (
              <View key={i} style={[s.adim, aktifBacak === i && s.adimAktif]}>
                <Text style={s.adimSaat}>{saatYaz(b.start.estimated?.time ?? b.start.scheduledTime)}</Text>
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
                      <Text style={s.adimAlt}>{`${sureYaz(b.duration)} · ${mesafeYaz(b.distance)}`}</Text>
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
        </ScrollView>

        <View style={[s.alt, { paddingBottom: kenar.bottom + 10 }]}>
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
      </View>

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

function bildirimMetni(bacaklar: Bacak[], takip: Takip): { baslik: string; metin: string } {
  if (!takip) {
    const ilk = bacaklar.find((b) => b.transitLeg);
    return {
      baslik: 'Yolculuk takip ediliyor',
      metin: ilk ? `${baslikYap(ilk.from.name)} durağından ${ilk.route?.shortName ?? ''} hattına bin.` : 'Konumun izleniyor.',
    };
  }
  const bacak = bacaklar[takip.bacak];
  const sonraki = bacaklar.slice(takip.bacak + 1).find((b) => b.transitLeg);
  const inis = baslikYap(bacak.to.name);
  const aktarma = sonraki ? `, ${sonraki.route?.shortName ?? ''} hattına aktarma yap` : '';
  if (takip.kalanDurak === 0) return { baslik: 'Şimdi in', metin: `${inis} durağındasın${aktarma}.` };
  if (takip.kalanDurak <= 2) {
    return { baslik: `İneceğin durağa ${takip.kalanDurak} durak kaldı`, metin: `${inis} durağında in${aktarma}.` };
  }
  return { baslik: `${bacak.route?.shortName ?? ''} ile yoldasın`, metin: `${inis} durağına ${takip.kalanDurak} durak var.` };
}

const stiller = (t: Tema) =>
  StyleSheet.create({
  kok: { flex: 1, backgroundColor: t.zemin },
  bos: { color: t.soluk, padding: 20, textAlign: 'center' },
  geri: { position: 'absolute', left: 14 },
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
  panel: {
    flex: 1,
    marginTop: -24,
    backgroundColor: t.yuzey,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
    paddingHorizontal: 16,
  },
  tutamac: { width: 38, height: 5, borderRadius: 3, backgroundColor: t.cizgi, alignSelf: 'center', marginBottom: 8 },
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
  adimSaat: { width: 42, fontSize: 12.5, fontWeight: '700', color: t.yazi, paddingTop: 1, fontVariant: ['tabular-nums'] },
  cizgiSutun: { width: 16, alignItems: 'center' },
  adimNokta: { width: 14, height: 14, borderRadius: 7, borderWidth: 3, backgroundColor: t.yuzey, marginTop: 2, zIndex: 1 },
  varisNokta: { borderColor: t.yazi, backgroundColor: t.yazi, borderRadius: 3 },
  adimCizgi: { flex: 1, width: 4, borderRadius: 2, marginTop: -2, marginBottom: -4 },
  adimCizgiYuru: { width: 0, borderLeftWidth: 3, borderStyle: 'dotted', borderColor: t.yurume },
  adimIcerik: { flex: 1, paddingBottom: 14, gap: 4 },
  adimBaslik: { fontSize: 14, fontWeight: '700', color: t.yazi },
  adimAlt: { fontSize: 12.5, color: t.soluk, flexShrink: 1, flexGrow: 1 },
  adimCanli: { fontSize: 12.5, fontWeight: '700', color: t.vurgu },

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

  alt: { flexDirection: 'row', gap: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.cizgi },
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
