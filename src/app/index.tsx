// 1 · Ana ekran: harita, arama kutusu, Ev/İş kısayolları ve yakındaki duraklar.

import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, type LongPressEvent } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Dakika, HataKutusu, HatRozeti, Ikon, Yukleniyor } from '@/components/ulasim';
import { useKayitlar, type YerTuru } from '@/lib/kayitlar';
import { useKonum } from '@/lib/konum';
import { OtpHatasi, yakinDuraklariGetir, type YakinDurak } from '@/lib/otp';
import { baslikYap, renk, yonYaz } from '@/lib/tema';
import { kacDakikaSonra, mesafeYaz } from '@/lib/zaman';

const YENILEME_ARALIGI = 30_000;

export default function AnaEkran() {
  const kenar = useSafeAreaInsets();
  const konum = useKonum();
  const { yerler, favoriler } = useKayitlar();
  const harita = useRef<MapView>(null);

  const [duraklar, setDuraklar] = useState<YakinDurak[] | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [yenileniyor, setYenileniyor] = useState(false);

  const { latitude, longitude } = konum.nokta;
  const hazir = konum.tur !== 'bekleniyor';

  const duraklariYukle = useCallback(async () => {
    try {
      setDuraklar(await yakinDuraklariGetir(latitude, longitude));
      setHata(null);
    } catch (e) {
      setHata(e instanceof OtpHatasi ? e.message : 'Yakındaki duraklar yüklenemedi.');
    }
  }, [latitude, longitude]);

  useEffect(() => {
    if (!hazir) return;
    duraklariYukle();
    const zamanlayici = setInterval(duraklariYukle, YENILEME_ARALIGI);
    return () => clearInterval(zamanlayici);
  }, [hazir, duraklariYukle]);

  useEffect(() => {
    if (!hazir) return;
    harita.current?.animateToRegion({ latitude, longitude, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 500);
  }, [hazir, latitude, longitude]);

  const buradan = { kLat: String(latitude), kLon: String(longitude), kAd: konum.tur === 'gercek' ? 'Konumum' : 'Kadıköy (örnek konum)' };

  const kisayolaGit = (tur: YerTuru) => {
    const yer = yerler[tur];
    if (!yer) {
      router.push({ pathname: '/ara', params: { ...buradan, kaydet: tur } });
      return;
    }
    router.push({ pathname: '/rota', params: { ...buradan, vLat: String(yer.lat), vLon: String(yer.lon), vAd: yer.ad } });
  };

  const haritadanSec = (olay: LongPressEvent) => {
    const { latitude: lat, longitude: lon } = olay.nativeEvent.coordinate;
    router.push({ pathname: '/rota', params: { ...buradan, vLat: String(lat), vLon: String(lon), vAd: 'Haritada seçilen nokta' } });
  };

  const yenile = async () => {
    setYenileniyor(true);
    await duraklariYukle();
    setYenileniyor(false);
  };

  return (
    <View style={s.kok}>
      <MapView
        ref={harita}
        style={StyleSheet.absoluteFill}
        userInterfaceStyle="light"
        initialRegion={{ latitude, longitude, latitudeDelta: 0.02, longitudeDelta: 0.02 }}
        showsUserLocation={konum.tur === 'gercek'}
        showsMyLocationButton={false}
        showsPointsOfInterests={false}
        toolbarEnabled={false}
        onLongPress={haritadanSec}
        mapPadding={{ top: 150, right: 0, bottom: 320, left: 0 }}
      >
        {konum.tur === 'varsayilan' && <Marker coordinate={konum.nokta} title="Örnek konum" pinColor={renk.konum} />}
        {duraklar?.map(({ durak }) =>
          durak.lat != null && durak.lon != null ? (
            <Marker
              key={durak.gtfsId}
              coordinate={{ latitude: durak.lat, longitude: durak.lon }}
              title={baslikYap(durak.name)}
              description={yonYaz(durak.desc)}
              pinColor={renk.vurgu}
              onCalloutPress={() => router.push({ pathname: '/durak/[id]', params: { id: durak.gtfsId } })}
            />
          ) : null,
        )}
      </MapView>

      <View style={[s.ust, { paddingTop: kenar.top + 8 }]}>
        <Pressable
          style={s.arama}
          accessibilityRole="search"
          onPress={() => router.push({ pathname: '/ara', params: buradan })}
        >
          <Ikon ad="search" />
          <Text style={s.aramaYazi}>Nereye gidiyorsun?</Text>
          <Pressable hitSlop={8} onPress={konum.yenile} accessibilityLabel="Konumumu yenile" style={s.konumDugme}>
            <Ikon ad="locate" renkKodu="#fff" boyut={18} />
          </Pressable>
        </Pressable>
        <View style={s.kisayollar}>
          <Kisayol ikon="home" baslik="Ev" alt={yerler.ev ? baslikYap(yerler.ev.ad) : 'Ekle'} onPress={() => kisayolaGit('ev')} />
          <Kisayol ikon="briefcase" baslik="İş" alt={yerler.is ? baslikYap(yerler.is.ad) : 'Ekle'} onPress={() => kisayolaGit('is')} />
        </View>
        {konum.tur === 'varsayilan' && (
          <View style={s.uyari}>
            <Ikon ad="information-circle" boyut={16} renkKodu={renk.soluk} />
            <Text style={s.uyariYazi}>{konum.neden}</Text>
          </View>
        )}
      </View>

      <View style={[s.panel, { paddingBottom: kenar.bottom + 8 }]}>
        <View style={s.tutamac} />
        <View style={s.panelBaslik}>
          <Text style={s.panelBaslikYazi}>Yakındaki duraklar</Text>
          <Text style={s.ipucu}>Hedef seçmek için haritaya basılı tut</Text>
        </View>
        <ScrollView
          style={s.liste}
          refreshControl={<RefreshControl refreshing={yenileniyor} onRefresh={yenile} tintColor={renk.vurgu} />}
        >
          {favoriler.length > 0 && (
            <View style={s.favoriler}>
              {favoriler.map((f) => (
                <Pressable
                  key={f.gtfsId}
                  style={s.favori}
                  onPress={() => router.push({ pathname: '/durak/[id]', params: { id: f.gtfsId } })}
                >
                  <Ikon ad="heart" boyut={14} renkKodu={renk.vurgu} />
                  <Text style={s.favoriYazi} numberOfLines={1}>
                    {f.ad}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          {hata && <HataKutusu mesaj={hata} tekrarDene={duraklariYukle} />}
          {!hata && !duraklar && <Yukleniyor metin="Yakındaki duraklar aranıyor…" />}
          {duraklar?.length === 0 && <Text style={s.bos}>1 km içinde durak bulunamadı.</Text>}
          {duraklar?.map(({ durak, mesafe }) => (
            <Pressable
              key={durak.gtfsId}
              style={s.durakBlok}
              onPress={() => router.push({ pathname: '/durak/[id]', params: { id: durak.gtfsId } })}
            >
              <View style={s.durakAd}>
                <View style={{ flex: 1 }}>
                  <Text style={s.durakAdYazi} numberOfLines={1}>
                    {baslikYap(durak.name)}
                  </Text>
                  {!!yonYaz(durak.desc) && (
                    <Text style={s.durakYon} numberOfLines={1}>
                      {yonYaz(durak.desc)}
                    </Text>
                  )}
                </View>
                <Text style={s.durakMesafe}>{mesafeYaz(mesafe)}</Text>
              </View>
              {durak.kalkislar.length === 0 && <Text style={s.seferYok}>Yakın zamanda sefer yok</Text>}
              {durak.kalkislar.slice(0, 2).map((k, i) => (
                <View key={i} style={s.sefer}>
                  <View style={s.seferRozet}>
                    <HatRozeti kisaAd={k.trip?.route.shortName} />
                  </View>
                  <Text style={s.seferYon} numberOfLines={1}>
                    {baslikYap(k.headsign)}
                  </Text>
                  <Dakika dakika={kacDakikaSonra(k.serviceDay ?? 0, k.realtimeDeparture ?? k.scheduledDeparture ?? 0)} />
                </View>
              ))}
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

function Kisayol({ ikon, baslik, alt, onPress }: { ikon: 'home' | 'briefcase'; baslik: string; alt: string; onPress: () => void }) {
  return (
    <Pressable style={s.kisayol} onPress={onPress} accessibilityRole="button">
      <View style={s.kisayolIkon}>
        <Ikon ad={ikon} boyut={15} renkKodu={renk.vurgu} />
      </View>
      <View style={{ flexShrink: 1 }}>
        <Text style={s.kisayolBaslik}>{baslik}</Text>
        <Text style={s.kisayolAlt} numberOfLines={1}>
          {alt}
        </Text>
      </View>
    </Pressable>
  );
}

const golge = {
  shadowColor: '#14201b',
  shadowOpacity: 0.18,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 4,
};

const s = StyleSheet.create({
  kok: { flex: 1, backgroundColor: renk.zemin },
  ust: { position: 'absolute', left: 14, right: 14, top: 0, gap: 10 },
  arama: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: renk.yuzey,
    borderRadius: 16,
    height: 52,
    paddingLeft: 14,
    paddingRight: 8,
    ...golge,
  },
  aramaYazi: { flex: 1, fontSize: 16, color: renk.soluk, fontWeight: '500' },
  konumDugme: { width: 36, height: 36, borderRadius: 18, backgroundColor: renk.vurgu, alignItems: 'center', justifyContent: 'center' },
  kisayollar: { flexDirection: 'row', gap: 8 },
  kisayol: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: renk.yuzey,
    borderRadius: 12,
    paddingVertical: 7,
    paddingHorizontal: 8,
    ...golge,
  },
  kisayolIkon: { width: 28, height: 28, borderRadius: 8, backgroundColor: renk.vurguAcik, alignItems: 'center', justifyContent: 'center' },
  kisayolBaslik: { fontSize: 13, fontWeight: '700', color: renk.yazi },
  kisayolAlt: { fontSize: 11, color: renk.soluk },
  uyari: { flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.94)', borderRadius: 10, padding: 8 },
  uyariYazi: { flex: 1, fontSize: 12, color: renk.soluk },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '48%',
    backgroundColor: renk.yuzey,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
    paddingHorizontal: 16,
    ...golge,
  },
  tutamac: { width: 38, height: 5, borderRadius: 3, backgroundColor: '#d3dad6', alignSelf: 'center', marginBottom: 10 },
  panelBaslik: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 },
  panelBaslikYazi: { fontSize: 18, fontWeight: '700', color: renk.yazi },
  ipucu: { fontSize: 11, color: renk.soluk },
  liste: { flexGrow: 0 },
  favoriler: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingVertical: 6 },
  favori: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: renk.vurguAcik, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, maxWidth: '100%' },
  favoriYazi: { fontSize: 12.5, fontWeight: '600', color: renk.yazi, flexShrink: 1 },
  bos: { color: renk.soluk, paddingVertical: 16, textAlign: 'center' },
  durakBlok: { paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: renk.cizgi },
  durakAd: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 },
  durakAdYazi: { fontSize: 14.5, fontWeight: '700', color: renk.yazi },
  durakYon: { fontSize: 12, color: renk.soluk, marginTop: 1 },
  durakMesafe: { fontSize: 12, color: renk.soluk },
  seferYok: { fontSize: 12.5, color: renk.soluk },
  sefer: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 },
  seferRozet: { width: 62 },
  seferYon: { flex: 1, fontSize: 13, color: renk.soluk },
});
