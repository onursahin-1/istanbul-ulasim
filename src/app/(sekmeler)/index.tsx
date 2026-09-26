// 1 · Ana ekran: harita, arama kutusu, Ev/İş kısayolları ve yakındaki duraklar.

import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, type LongPressEvent } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AltYaprak } from '@/components/alt-yaprak';
import {
  CanliAciklama,
  Dakika,
  HataKutusu,
  HatRozeti,
  Ikon,
  ROZET_SUTUNU,
  TarifeEtiketi,
  useStiller,
  Yukleniyor,
} from '@/components/ulasim';
import { kalkisCanli } from '@/lib/canli';
import { useKayitlar, type YerTuru } from '@/lib/kayitlar';
import { useKonum } from '@/lib/konum';
import { kopruyeIlgiBildir, OtpHatasi, yakinDuraklariGetir, type Hat, type YakinDurak } from '@/lib/otp';
import { baslikYap, hatEtiketi, useTema, yonYaz, type Tema } from '@/lib/tema';
import { mesafeYaz } from '@/lib/zaman';
import { siklikOzeti } from '@/lib/siklik';
import { hatSikligi } from '@/lib/siklik-verisi';

const YENILEME_ARALIGI = 30_000;

/**
 * Minibüs ve dolmuş hatlarını araç tipine göre gruplar: her tip tek satır, yanında
 * güzergâh adları. Saatleri olmadığı için (bkz. saatsizHatlariKatla) yalnız hangi
 * hatların uğradığını söylüyoruz.
 */
function saatsizGruplari(hatlar: Hat[]): { tur: string; hatlar: Hat[]; adlar: string[] }[] {
  const gruplar = new Map<string, { tur: string; hatlar: Hat[]; adlar: string[] }>();
  for (const h of hatlar) {
    const e = hatEtiketi(h.shortName, h.mode, h.agency?.name);
    const g = gruplar.get(e.rozet) ?? { tur: e.rozet, hatlar: [], adlar: [] };
    const ad = e.ayrinti || e.rozet;
    if (!g.adlar.includes(ad)) {
      g.hatlar.push(h);
      g.adlar.push(ad);
    }
    gruplar.set(e.rozet, g);
  }
  return [...gruplar.values()];
}

export default function AnaEkran() {
  const kenar = useSafeAreaInsets();
  const tema = useTema();
  const s = useStiller(stiller);
  const konum = useKonum();
  const { yerler, favoriler } = useKayitlar();
  const harita = useRef<MapView>(null);

  const [duraklar, setDuraklar] = useState<YakinDurak[] | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  // Alt yaprağın ölçüleri: ekranın boyu ve arama kutusunun bittiği yer.
  const [ekranBoyu, setEkranBoyu] = useState(0);
  const [aramaAlti, setAramaAlti] = useState(0);
  // Harita, yaprağın kapladığı yeri boşluk sayar; konum noktası yaprağın altında kalmaz.
  const [yaprakBoyu, setYaprakBoyu] = useState(320);

  const { latitude, longitude } = konum.nokta;
  const hazir = konum.tur !== 'bekleniyor';

  const duraklariYukle = useCallback(async () => {
    try {
      const liste = await yakinDuraklariGetir(latitude, longitude);
      setDuraklar(liste);
      // Yakındaki ilk durakların otobüs hatlarını köprü öncelikle tarasın: evden çıkarken
      // bakılan durakta otobüsler canlı görünsün.
      kopruyeIlgiBildir(liste.slice(0, 4).flatMap((y) => (y.durak.routes ?? []).map((r) => r.shortName)));
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


  return (
    <View style={s.kok} onLayout={(e) => setEkranBoyu(e.nativeEvent.layout.height)}>
      <MapView
        ref={harita}
        style={StyleSheet.absoluteFill}
        userInterfaceStyle={tema.haritaStili}
        initialRegion={{ latitude, longitude, latitudeDelta: 0.02, longitudeDelta: 0.02 }}
        showsUserLocation={konum.tur === 'gercek'}
        showsMyLocationButton={false}
        showsPointsOfInterests={false}
        toolbarEnabled={false}
        onLongPress={haritadanSec}
        mapPadding={{ top: 150, right: 0, bottom: yaprakBoyu, left: 0 }}
      >
        {konum.tur === 'varsayilan' && <Marker coordinate={konum.nokta} title="Örnek konum" pinColor={tema.konum} />}
        {duraklar?.map(({ durak }) =>
          durak.lat != null && durak.lon != null ? (
            <Marker
              key={durak.gtfsId}
              coordinate={{ latitude: durak.lat, longitude: durak.lon }}
              title={baslikYap(durak.name)}
              description={yonYaz(durak.desc)}
              pinColor={tema.vurgu}
              onCalloutPress={() => router.push({ pathname: '/durak/[id]', params: { id: durak.gtfsId } })}
            />
          ) : null,
        )}
      </MapView>

      <View
        style={[s.ust, { paddingTop: kenar.top + 8 }]}
        onLayout={(e) => setAramaAlti(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}
      >
        <Pressable
          style={s.arama}
          accessibilityRole="search"
          onPress={() => router.push({ pathname: '/ara', params: buradan })}
        >
          <Ikon ad="search" />
          <Text style={s.aramaYazi}>Nereye gidiyorsun?</Text>
          <Pressable hitSlop={8} onPress={konum.yenile} accessibilityLabel="Konumumu yenile" style={s.konumDugme}>
            <Ikon ad="locate" renkKodu={tema.vurguYazi} boyut={18} />
          </Pressable>
        </Pressable>
        <View style={s.kisayollar}>
          <Kisayol ikon="home" baslik="Ev" alt={yerler.ev ? baslikYap(yerler.ev.ad) : 'Ekle'} onPress={() => kisayolaGit('ev')} />
          <Kisayol ikon="briefcase" baslik="İş" alt={yerler.is ? baslikYap(yerler.is.ad) : 'Ekle'} onPress={() => kisayolaGit('is')} />
        </View>
        {konum.tur === 'varsayilan' && (
          <View style={s.uyari}>
            <Ikon ad="information-circle" boyut={16} renkKodu={tema.soluk} />
            <Text style={s.uyariYazi}>{konum.neden}</Text>
          </View>
        )}
      </View>

      {ekranBoyu > 0 && (
        <AltYaprak
          kapsayiciYukseklik={ekranBoyu}
          ustPay={aramaAlti + 12}
          onDurum={(_, boy) => setYaprakBoyu(boy)}
          erisilebilirlikEtiketi="Yakındaki durakları aç ya da kapat"
          baslik={
            <View style={s.panelBaslik}>
              <Text style={s.panelBaslikYazi}>Yakındaki duraklar</Text>
              <Text style={s.ipucu}>Hedef seçmek için haritaya basılı tut</Text>
            </View>
          }
        >
          {favoriler.length > 0 && (
            <View style={s.favoriler}>
              {favoriler.map((f) => (
                <Pressable
                  key={f.gtfsId}
                  style={s.favori}
                  onPress={() => router.push({ pathname: '/durak/[id]', params: { id: f.gtfsId } })}
                >
                  <Ikon ad="heart" boyut={14} renkKodu={tema.vurgu} />
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
              {durak.kalkislar.length === 0 && durak.saatsiz.length === 0 && (
                <Text style={s.seferYok}>Yakın zamanda sefer yok</Text>
              )}
              {(() => {
                const ilkIki = durak.kalkislar.slice(0, 2).map((k) => ({ k, canli: kalkisCanli(k) }));
                // Aynı durakta canlı kalkış varsa canlı olmayanlar "tarifeye göre" diye ayrılıyor.
                const canliVar = ilkIki.some((x) => x.canli);
                return ilkIki.map(({ k, canli }, i) => (
                  <View key={i} style={s.sefer}>
                    <View style={s.seferRozet}>
                      <HatRozeti hat={k.trip?.route} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.seferYon} numberOfLines={1}>
                        {baslikYap(k.trip?.pattern?.headsign) || baslikYap(k.headsign)}
                      </Text>
                      {canli ? <CanliAciklama canli={canli} /> : canliVar ? <TarifeEtiketi /> : null}
                    </View>
                    <Dakika an={(k.serviceDay ?? 0) + (k.realtimeDeparture ?? k.scheduledDeparture ?? 0)} canli={canli} />
                  </View>
                ));
              })()}
              {saatsizGruplari(durak.saatsiz).map((g) => (
                <View key={g.tur} style={s.sefer}>
                  <View style={s.seferRozet}>
                    <HatRozeti hat={g.hatlar[0]} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.seferYon} numberOfLines={1}>
                      {g.adlar.join(', ')}
                    </Text>
                    <View style={s.saatsizNot}>
                      <Ikon ad="time-outline" boyut={11} renkKodu={tema.soluk} />
                      <Text style={s.saatsizYazi} numberOfLines={1}>
                        {`${g.adlar.length} hat · ${siklikOzeti(g.hatlar.map((h) => hatSikligi(h.shortName))) ?? 'saat bilgisi yok'}`}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
            </Pressable>
          ))}
        </AltYaprak>
      )}
    </View>
  );
}

function Kisayol({ ikon, baslik, alt, onPress }: { ikon: 'home' | 'briefcase'; baslik: string; alt: string; onPress: () => void }) {
  const tema = useTema();
  const s = useStiller(stiller);
  return (
    <Pressable style={s.kisayol} onPress={onPress} accessibilityRole="button">
      <View style={s.kisayolIkon}>
        <Ikon ad={ikon} boyut={15} renkKodu={tema.vurgu} />
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

const stiller = (t: Tema) =>
  StyleSheet.create({
  // overflow: yaprak aşağı itildiğinde sekme çubuğunun üstüne taşmasın.
  kok: { flex: 1, backgroundColor: t.zemin, overflow: 'hidden' },
  ust: { position: 'absolute', left: 14, right: 14, top: 0, gap: 10 },
  arama: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: t.yuzey,
    borderRadius: 16,
    height: 52,
    paddingLeft: 14,
    paddingRight: 8,
    ...golge,
  },
  aramaYazi: { flex: 1, fontSize: 16, color: t.soluk, fontWeight: '500' },
  konumDugme: { width: 36, height: 36, borderRadius: 18, backgroundColor: t.vurgu, alignItems: 'center', justifyContent: 'center' },
  kisayollar: { flexDirection: 'row', gap: 8 },
  kisayol: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: t.yuzey,
    borderRadius: 12,
    paddingVertical: 7,
    paddingHorizontal: 8,
    ...golge,
  },
  kisayolIkon: { width: 28, height: 28, borderRadius: 8, backgroundColor: t.vurguAcik, alignItems: 'center', justifyContent: 'center' },
  kisayolBaslik: { fontSize: 13, fontWeight: '700', color: t.yazi },
  kisayolAlt: { fontSize: 11, color: t.soluk },
  uyari: { flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.94)', borderRadius: 10, padding: 8 },
  uyariYazi: { flex: 1, fontSize: 12, color: t.soluk },
  panelBaslik: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 },
  panelBaslikYazi: { fontSize: 18, fontWeight: '700', color: t.yazi },
  ipucu: { fontSize: 11, color: t.soluk },
  favoriler: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingVertical: 6 },
  favori: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: t.vurguAcik, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, maxWidth: '100%' },
  favoriYazi: { fontSize: 12.5, fontWeight: '600', color: t.yazi, flexShrink: 1 },
  bos: { color: t.soluk, paddingVertical: 16, textAlign: 'center' },
  durakBlok: { paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.cizgi },
  durakAd: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 },
  durakAdYazi: { fontSize: 14.5, fontWeight: '700', color: t.yazi },
  durakYon: { fontSize: 12, color: t.soluk, marginTop: 1 },
  durakMesafe: { fontSize: 12, color: t.soluk },
  seferYok: { fontSize: 12.5, color: t.soluk },
  saatsizNot: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  saatsizYazi: { fontSize: 11.5, color: t.soluk },
  sefer: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 },
  seferRozet: { minWidth: ROZET_SUTUNU },
  seferYon: { flex: 1, fontSize: 13, color: t.soluk },
});
