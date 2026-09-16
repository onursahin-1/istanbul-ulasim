// 3 · Rota detayı: haritada güzergâh, adım adım zaman çizelgesi ve yolculuk takibi.

import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GeriCubugu, HatRozeti, Ikon } from '@/components/ulasim';
import { mesafeMetre, polylineCoz, type Nokta } from '@/lib/cografya';
import { bacakDuraklari, type Bacak } from '@/lib/otp';
import { guzergahGetir } from '@/lib/secim';
import { baslikYap, hatRengi, renk } from '@/lib/tema';
import { mesafeYaz, saatYaz, sureYaz } from '@/lib/zaman';

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
  const { height } = useWindowDimensions();
  const { sira, hedef } = useLocalSearchParams<{ sira: string; hedef?: string }>();
  const guzergah = guzergahGetir(Number(sira));
  const harita = useRef<MapView>(null);

  const [takipAcik, setTakipAcik] = useState(false);
  const [takip, setTakip] = useState<Takip>(null);
  const aboneligi = useRef<Location.LocationSubscription | null>(null);
  const simulasyon = useRef<ReturnType<typeof setInterval> | null>(null);
  const uyarilanlar = useRef(new Set<string>());

  const bacaklar = useMemo(() => guzergah?.legs ?? [], [guzergah]);
  const cizgiler = useMemo(() => bacaklar.map(bacakNoktalari), [bacaklar]);
  const duraklar = useMemo(() => bacaklar.map((b) => (b.transitLeg ? bacakDuraklari(b) : [])), [bacaklar]);

  const haritaYuksekligi = Math.round(height * 0.42);

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
        userInterfaceStyle="light"
        onMapReady={haritayiSigdir}
        showsUserLocation={takipAcik}
        showsPointsOfInterests={false}
        toolbarEnabled={false}
      >
        {bacaklar.map((b, i) => (
          <Polyline
            key={i}
            coordinates={cizgiler[i]}
            strokeColor={b.transitLeg ? hatRengi(b.route?.shortName) : renk.yurume}
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
              pinColor={b.transitLeg ? hatRengi(b.route?.shortName) : renk.yurume}
            />
          ))}
        <Marker coordinate={{ latitude: bacaklar[0].from.lat, longitude: bacaklar[0].from.lon }} title="Başlangıç" pinColor={renk.vurgu} />
        <Marker
          coordinate={{ latitude: bacaklar[bacaklar.length - 1].to.lat, longitude: bacaklar[bacaklar.length - 1].to.lon }}
          title={hedef ? baslikYap(hedef) : 'Varış'}
          pinColor={renk.yazi}
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
            <Ikon ad="notifications" boyut={20} renkKodu="#fff" />
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
            const renkKodu = b.transitLeg ? hatRengi(b.route?.shortName) : renk.yurume;
            const durakSayisi = Math.max(duraklar[i].length - 1, 1);
            const sonYuruyus = !b.transitLeg && i === bacaklar.length - 1;
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
                      <View style={s.adimSatir}>
                        <HatRozeti kisaAd={b.route?.shortName} kucuk />
                        <Text style={s.adimAlt}>
                          {[b.headsign ? `${baslikYap(b.headsign)} yönü` : '', `${durakSayisi} durak`, sureYaz(b.duration)].filter(Boolean).join(' · ')}
                        </Text>
                      </View>
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
            style={[s.baslat, takipAcik && s.bitir]}
            onPress={takipAcik ? takibiDurdur : takibiBaslat}
            onLongPress={simulasyonuBaslat}
            accessibilityRole="button"
          >
            <Ikon ad={takipAcik ? 'stop-circle' : 'navigate'} boyut={18} renkKodu="#fff" />
            <Text style={s.baslatYazi}>{takipAcik ? 'Yolculuğu bitir' : 'Yolculuğu başlat'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
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

const s = StyleSheet.create({
  kok: { flex: 1, backgroundColor: renk.zemin },
  bos: { color: renk.soluk, padding: 20, textAlign: 'center' },
  geri: { position: 'absolute', left: 14 },
  yuvarlak: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: renk.yuzey,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
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
    backgroundColor: 'rgba(250,252,251,0.97)',
    borderRadius: 18,
    padding: 11,
    shadowColor: '#0a1914',
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  bildirimIkon: { width: 36, height: 36, borderRadius: 9, backgroundColor: renk.vurgu, alignItems: 'center', justifyContent: 'center' },
  bildirimBaslik: { fontSize: 14, fontWeight: '700', color: renk.yazi },
  bildirimMetin: { fontSize: 13, color: renk.yazi, marginTop: 1 },
  panel: {
    flex: 1,
    marginTop: -24,
    backgroundColor: renk.yuzey,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
    paddingHorizontal: 16,
  },
  tutamac: { width: 38, height: 5, borderRadius: 3, backgroundColor: '#d3dad6', alignSelf: 'center', marginBottom: 8 },
  ozet: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: renk.cizgi },
  sure: { fontSize: 24, fontWeight: '800', color: renk.yazi, letterSpacing: -0.5 },
  ozetAlt: { fontSize: 12.5, color: renk.soluk, fontWeight: '600' },
  ozetSaat: { fontSize: 14, fontWeight: '700', color: renk.yazi, fontVariant: ['tabular-nums'] },
  adim: { flexDirection: 'row', gap: 8, borderRadius: 10 },
  adimAktif: { backgroundColor: '#f0f7f6' },
  adimSaat: { width: 42, fontSize: 12.5, fontWeight: '700', color: renk.yazi, paddingTop: 1, fontVariant: ['tabular-nums'] },
  cizgiSutun: { width: 16, alignItems: 'center' },
  adimNokta: { width: 14, height: 14, borderRadius: 7, borderWidth: 3, backgroundColor: renk.yuzey, marginTop: 2, zIndex: 1 },
  varisNokta: { borderColor: renk.yazi, backgroundColor: renk.yazi, borderRadius: 3 },
  adimCizgi: { flex: 1, width: 4, borderRadius: 2, marginTop: -2, marginBottom: -4 },
  adimCizgiYuru: { width: 0, borderLeftWidth: 3, borderStyle: 'dotted', borderColor: '#aab6b0' },
  adimIcerik: { flex: 1, paddingBottom: 14, gap: 4 },
  adimBaslik: { fontSize: 14, fontWeight: '700', color: renk.yazi },
  adimSatir: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  adimAlt: { fontSize: 12.5, color: renk.soluk, flexShrink: 1 },
  adimCanli: { fontSize: 12.5, fontWeight: '700', color: renk.metrobus },
  alt: { flexDirection: 'row', gap: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: renk.cizgi },
  baslat: { flex: 1, height: 50, borderRadius: 14, backgroundColor: renk.vurgu, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  bitir: { backgroundColor: renk.yazi },
  baslatYazi: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
