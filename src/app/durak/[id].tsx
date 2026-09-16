// 4 · Durak detayı: konum, geçen hatlar ve yaklaşan seferler.

import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Dakika, HataKutusu, HatRozeti, Ikon, Yukleniyor } from '@/components/ulasim';
import { favoriDegistir, useKayitlar } from '@/lib/kayitlar';
import { useKonum } from '@/lib/konum';
import { durakDetayiGetir, OtpHatasi, type DurakDetayi } from '@/lib/otp';
import { baslikYap, metrobusMu, renk, yonYaz } from '@/lib/tema';
import { kacDakikaSonra, saniyedenSaat } from '@/lib/zaman';

const YENILEME_ARALIGI = 30_000;

export default function DurakEkrani() {
  const kenar = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const konum = useKonum();
  const { favoriler } = useKayitlar();
  const [durak, setDurak] = useState<DurakDetayi | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [yenileniyor, setYenileniyor] = useState(false);

  const yukle = useCallback(async () => {
    if (!id) return;
    try {
      const sonuc = await durakDetayiGetir(id);
      if (!sonuc) setHata('Bu durak bulunamadı.');
      else {
        setDurak(sonuc);
        setHata(null);
      }
    } catch (e) {
      setHata(e instanceof OtpHatasi ? e.message : 'Durak bilgisi yüklenemedi.');
    }
  }, [id]);

  useEffect(() => {
    yukle();
    const zamanlayici = setInterval(yukle, YENILEME_ARALIGI);
    return () => clearInterval(zamanlayici);
  }, [yukle]);

  const ad = baslikYap(durak?.name);
  const favoriMi = favoriler.some((f) => f.gtfsId === id);

  const hatlar = useMemo(() => {
    const liste = [...(durak?.routes ?? [])].filter((r) => r.shortName);
    const tekil = [...new Map(liste.map((r) => [r.shortName, r])).values()];
    return tekil.sort((a, b) => (a.shortName ?? '').localeCompare(b.shortName ?? '', 'tr', { numeric: true }));
  }, [durak]);

  const kalkislar = useMemo(
    () =>
      (durak?.kalkislar ?? [])
        .map((k) => ({ ...k, dakika: kacDakikaSonra(k.serviceDay ?? 0, k.realtimeDeparture ?? k.scheduledDeparture ?? 0) }))
        .filter((k) => k.dakika >= 0)
        .sort((a, b) => a.dakika - b.dakika),
    [durak],
  );

  const yolTarifi = () => {
    if (durak?.lat == null || durak.lon == null) return;
    router.push({
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

  const metrobusDuragi = hatlar.length > 0 && hatlar.every((h) => metrobusMu(h.shortName));

  return (
    <View style={s.kok}>
      {durak?.lat != null && durak.lon != null ? (
        <MapView
          style={s.harita}
          initialRegion={{ latitude: durak.lat, longitude: durak.lon, latitudeDelta: 0.006, longitudeDelta: 0.006 }}
          showsPointsOfInterests={false}
          toolbarEnabled={false}
          scrollEnabled={false}
          zoomEnabled={false}
        >
          <Marker coordinate={{ latitude: durak.lat, longitude: durak.lon }} title={ad} pinColor={metrobusDuragi ? renk.metrobus : renk.vurgu} />
        </MapView>
      ) : (
        <View style={[s.harita, { backgroundColor: '#e6ebe7' }]} />
      )}

      <View style={[s.ustDugmeler, { top: kenar.top + 8 }]}>
        <Pressable style={s.yuvarlak} onPress={() => router.back()} accessibilityLabel="Geri">
          <Ikon ad="chevron-back" boyut={22} />
        </Pressable>
      </View>

      <ScrollView
        style={s.govde}
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: kenar.bottom + 24 }}
        refreshControl={
          <RefreshControl
            refreshing={yenileniyor}
            tintColor={renk.vurgu}
            onRefresh={async () => {
              setYenileniyor(true);
              await yukle();
              setYenileniyor(false);
            }}
          />
        }
      >
        {hata && <HataKutusu mesaj={hata} tekrarDene={yukle} />}
        {!durak && !hata && <Yukleniyor metin="Durak bilgisi yükleniyor…" />}
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
                onPress={() => favoriDegistir({ gtfsId: durak.gtfsId, ad })}
                accessibilityState={{ selected: favoriMi }}
              >
                <Ikon ad={favoriMi ? 'heart' : 'heart-outline'} boyut={16} renkKodu={renk.vurgu} />
                <Text style={s.eylemYazi}>{favoriMi ? 'Favorilerde' : 'Favorilere ekle'}</Text>
              </Pressable>
              <Pressable style={[s.eylem, s.eylemDolu]} onPress={yolTarifi}>
                <Ikon ad="navigate" boyut={16} renkKodu="#fff" />
                <Text style={[s.eylemYazi, { color: '#fff' }]}>Yol tarifi</Text>
              </Pressable>
            </View>

            {hatlar.length > 0 && (
              <View style={{ gap: 8 }}>
                <Text style={s.altBaslik}>BU DURAKTAN GEÇEN HATLAR</Text>
                <View style={s.hatlar}>
                  {hatlar.map((h) => (
                    <HatRozeti key={h.gtfsId} kisaAd={h.shortName} />
                  ))}
                </View>
              </View>
            )}

            <View style={{ gap: 4 }}>
              <Text style={s.altBaslik}>YAKLAŞAN SEFERLER</Text>
              {kalkislar.length === 0 && <Text style={s.bos}>Önümüzdeki 2 saatte bu duraktan sefer görünmüyor.</Text>}
              {kalkislar.map((k, i) => (
                <View key={i} style={s.sefer}>
                  <View style={{ width: 62 }}>
                    <HatRozeti kisaAd={k.trip?.route.shortName} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.seferYon} numberOfLines={1}>
                      {baslikYap(k.headsign) || 'Yön bilgisi yok'}
                    </Text>
                    <Text style={s.seferSaat}>{saniyedenSaat(k.realtimeDeparture ?? k.scheduledDeparture ?? 0)}</Text>
                  </View>
                  <Dakika dakika={k.dakika} />
                </View>
              ))}
            </View>

            <View style={s.tarife}>
              <View style={s.tarifeNokta} />
              <Text style={s.tarifeYazi}>Süreler İETT tarifesine göredir; canlı araç konumu eklendiğinde güncellenecek.</Text>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  kok: { flex: 1, backgroundColor: renk.yuzey },
  harita: { height: 230 },
  ustDugmeler: { position: 'absolute', left: 14 },
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
  govde: { flex: 1, marginTop: -22, backgroundColor: renk.yuzey, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  baslik: { fontSize: 23, fontWeight: '800', color: renk.yazi, letterSpacing: -0.3 },
  bilgi: { fontSize: 12.5, color: renk.soluk },
  eylemler: { flexDirection: 'row', gap: 8 },
  eylem: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', height: 40, borderRadius: 11, backgroundColor: renk.vurguAcik },
  eylemDolu: { backgroundColor: renk.vurgu },
  eylemYazi: { fontWeight: '700', fontSize: 13, color: renk.vurgu },
  altBaslik: { fontSize: 11.5, letterSpacing: 0.8, color: renk.soluk, fontWeight: '700' },
  hatlar: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  bos: { color: renk.soluk, paddingVertical: 10 },
  sefer: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: renk.cizgi },
  seferYon: { fontSize: 13.5, fontWeight: '600', color: renk.yazi },
  seferSaat: { fontSize: 12, color: renk.soluk, fontVariant: ['tabular-nums'] },
  tarife: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tarifeNokta: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#b5c1bb' },
  tarifeYazi: { flex: 1, fontSize: 11.5, color: renk.soluk },
});
