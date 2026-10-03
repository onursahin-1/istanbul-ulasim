// 1 · Ana ekran: harita, arama kutusu, Ev/İş kısayolları ve yakındaki duraklar.

import * as Location from 'expo-location';

import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/dokun';
import { ModalSayfa } from '@/components/modal-sayfa';
import MapView, { Marker, type LongPressEvent } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AltYaprak } from '@/components/alt-yaprak';
import {
  ARKASINDA_SN,
  CanliAciklama,
  Dakika,
  HataKutusu,
  HatRozeti,
  Ikon,
  type IkonAdi,
  ROZET_SUTUNU,
  TarifeEtiketi,
  useStiller,
  Yukleniyor,
} from '@/components/ulasim';
import { adresYaz, SECILEN_NOKTA, type Adres } from '@/lib/adres';
import { kalkisCanli } from '@/lib/canli';
import { mesafeMetre } from '@/lib/cografya';
import { ayniYer, favoriYerDegistir, useKayitlar, type YerTuru } from '@/lib/kayitlar';
import { useKonum } from '@/lib/konum';
import { kopruyeIlgiBildir, OtpHatasi, yakinDuraklariGetir, type Hat, type YakinDurak } from '@/lib/otp';
import { baslikYap, hatEtiketi, useTema, yonYaz, type Tema } from '@/lib/tema';
import { mesafeYaz } from '@/lib/zaman';
import { siklikOzeti } from '@/lib/siklik';
import { hatSikligi } from '@/lib/siklik-verisi';
import { basari, secimTiki, vurus } from '@/lib/dokunsal';
import { useCanliAralik } from '@/lib/canli-aralik';
import { ekranAc } from '@/lib/gezinti';
import { useScrollToTop } from 'expo-router';

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
  const { yerler, favoriler, favoriYerler } = useKayitlar();
  /** Haritada basılı tutulan nokta; seçenek yaprağı açıkken dolu. adres: undefined aranıyor, null bulunamadı. */
  const [secim, setSecim] = useState<{ lat: number; lon: number; adres?: Adres | null } | null>(null);
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
    if (hazir) duraklariYukle();
  }, [hazir, duraklariYukle]);
  // Ana ekran başka bir ekranın altındayken (durak, rota) yenileme durur, dönünce tazelenir.
  useCanliAralik(duraklariYukle, YENILEME_ARALIGI, hazir);

  useEffect(() => {
    if (!hazir) return;
    harita.current?.animateToRegion({ latitude, longitude, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 500);
  }, [hazir, latitude, longitude]);

  // Keşfet sekmesine yeniden dokununca harita konumuna döner (iPhone Haritalar'daki gibi).
  const ortala = useRef({ scrollToTop: () => {} });
  useEffect(() => {
    ortala.current.scrollToTop = () =>
      harita.current?.animateToRegion({ latitude, longitude, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 400);
  }, [latitude, longitude]);
  useScrollToTop(ortala);

  const buradan = { kLat: String(latitude), kLon: String(longitude), kAd: konum.tur === 'gercek' ? 'Konumum' : 'Kadıköy (örnek konum)' };

  const kisayolaGit = (tur: YerTuru) => {
    const yer = yerler[tur];
    if (!yer) {
      ekranAc({ pathname: '/ara', params: { ...buradan, kaydet: tur } });
      return;
    }
    ekranAc({ pathname: '/rota', params: { ...buradan, vLat: String(yer.lat), vLon: String(yer.lon), vAd: yer.ad } });
  };

  // Haritada basılı tutunca iğne düşer ve seçenek yaprağı açılır: buraya / buradan yol
  // tarifi, favorilere ekle. Adres telefonun adres servisinden (internet ister); gelmezse
  // "Haritada seçilen nokta" yazar.
  const haritadanSec = (olay: LongPressEvent) => {
    const { latitude: lat, longitude: lon } = olay.nativeEvent.coordinate;
    vurus();
    setSecim({ lat, lon });
    Location.reverseGeocodeAsync({ latitude: lat, longitude: lon })
      .then((sonuc) => adresYaz(sonuc[0]))
      .catch(() => null)
      .then((adres) => setSecim((o) => (o && o.lat === lat && o.lon === lon ? { ...o, adres } : o)));
  };
  const secimAdi = secim?.adres?.baslik ?? SECILEN_NOKTA;
  const secimFavori = !!secim && favoriYerler.some((y) => ayniYer(y, secim));
  const secimMesafe =
    secim && konum.tur === 'gercek' ? mesafeMetre(konum.nokta, { latitude: secim.lat, longitude: secim.lon }) : null;

  const secimdenRota = (yon: 'buraya' | 'buradan') => {
    if (!secim) return;
    const nokta = { lat: String(secim.lat), lon: String(secim.lon), ad: secimAdi };
    setSecim(null);
    if (yon === 'buraya') {
      ekranAc({ pathname: '/rota', params: { ...buradan, vLat: nokta.lat, vLon: nokta.lon, vAd: nokta.ad } });
    } else {
      // Başlangıç bu nokta; varış arama ekranında seçiliyor ("Konumum" da orada).
      ekranAc({ pathname: '/ara', params: { kLat: nokta.lat, kLon: nokta.lon, kAd: nokta.ad } });
    }
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
        {secim && <Marker coordinate={{ latitude: secim.lat, longitude: secim.lon }} pinColor={tema.hata} />}
        {duraklar?.map(({ durak }) =>
          durak.lat != null && durak.lon != null ? (
            <Marker
              key={durak.gtfsId}
              coordinate={{ latitude: durak.lat, longitude: durak.lon }}
              title={baslikYap(durak.name)}
              description={yonYaz(durak.desc)}
              pinColor={tema.vurgu}
              onCalloutPress={() => ekranAc({ pathname: '/durak/[id]', params: { id: durak.gtfsId } })}
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
          onPress={() => ekranAc({ pathname: '/ara', params: buradan })}
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
                  onPress={() => ekranAc({ pathname: '/durak/[id]', params: { id: f.gtfsId } })}
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
              onPress={() => ekranAc({ pathname: '/durak/[id]', params: { id: durak.gtfsId } })}
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
                const ilkIki = durak.kalkislar.slice(0, 2).map((k) => ({
                  k,
                  canli: kalkisCanli(k),
                  an: (k.serviceDay ?? 0) + (k.realtimeDeparture ?? k.scheduledDeparture ?? 0),
                }));
                // Aynı durakta canlı kalkış varsa canlı olmayanlar "tarifeye göre" diye ayrılıyor.
                const canliVar = ilkIki.some((x) => x.canli);
                // Aynı hattın iki canlı otobüsü üç dakikadan yakınsa ikincisi "hemen arkasında":
                // iki satırda neredeyse aynı saati görünce yolcu yinelenen kayıt sanmasın.
                const [a, b] = ilkIki;
                const arkasinda =
                  !!a?.canli &&
                  !!b?.canli &&
                  !!a.k.trip?.route?.gtfsId &&
                  a.k.trip?.route?.gtfsId === b.k.trip?.route?.gtfsId &&
                  Math.abs(b.an - a.an) < ARKASINDA_SN;
                return ilkIki.map(({ k, canli, an }, i) => (
                  <View key={i} style={s.sefer}>
                    <View style={s.seferRozet}>
                      <HatRozeti hat={k.trip?.route} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.seferYon} numberOfLines={1}>
                        {baslikYap(k.trip?.pattern?.headsign) || baslikYap(k.headsign)}
                      </Text>
                      {canli ? (
                        <CanliAciklama an={an} arkasinda={i === 1 && arkasinda} />
                      ) : canliVar ? (
                        <TarifeEtiketi />
                      ) : null}
                    </View>
                    <Dakika an={an} canli={canli} />
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

      <ModalSayfa acik={!!secim} kapat={() => setSecim(null)}>
        <View style={[s.secimSayfa, { paddingBottom: kenar.bottom + 8 }]}>
          <View style={s.secimTutamac} />
          <Text style={s.secimBaslik} numberOfLines={2}>
            {secim?.adres === undefined ? 'Adres aranıyor…' : secimAdi}
          </Text>
          <Text style={s.secimAlt} numberOfLines={1}>
            {[secim?.adres?.alt, secimMesafe != null ? mesafeYaz(secimMesafe) : ''].filter(Boolean).join(' · ') || ' '}
          </Text>
          <SecimSatiri ikon="location-outline" yazi="Buraya yol tarifi" onPress={() => secimdenRota('buraya')} />
          <SecimSatiri ikon="navigate-outline" yazi="Buradan yol tarifi" onPress={() => secimdenRota('buradan')} />
          <SecimSatiri
            ikon={secimFavori ? 'star' : 'star-outline'}
            yazi={secimFavori ? 'Favorilerden çıkar' : 'Favorilere ekle'}
            onPress={() => {
              if (!secim) return;
              (secimFavori ? secimTiki : basari)();
              favoriYerDegistir({
                ad: secimAdi,
                ...(secim.adres?.alt ? { alt: secim.adres.alt } : {}),
                lat: secim.lat,
                lon: secim.lon,
              });
            }}
          />
          <Pressable style={s.secimIptal} onPress={() => setSecim(null)} accessibilityRole="button">
            <Text style={s.secimIptalYazi}>İptal</Text>
          </Pressable>
        </View>
      </ModalSayfa>
    </View>
  );
}

function SecimSatiri({ ikon, yazi, onPress }: { ikon: IkonAdi; yazi: string; onPress: () => void }) {
  const tema = useTema();
  const s = useStiller(stiller);
  return (
    <Pressable style={s.secimSatir} onPress={onPress} accessibilityRole="button">
      <View style={s.secimIkon}>
        <Ikon ad={ikon} boyut={18} renkKodu={tema.vurgu} />
      </View>
      <Text style={s.secimYazi}>{yazi}</Text>
    </Pressable>
  );
}

function Kisayol({ ikon, baslik, alt, onPress }: { ikon: 'home' | 'briefcase'; baslik: string; alt: string; onPress: () => void }) {
  const tema = useTema();
  const s = useStiller(stiller);
  return (
    <Pressable hitSlop={4} style={s.kisayol} onPress={onPress} accessibilityRole="button">
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
  secimSayfa: { backgroundColor: t.yuzey, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 8 },
  secimTutamac: { width: 38, height: 5, borderRadius: 3, backgroundColor: t.cizgi, alignSelf: 'center', marginBottom: 12 },
  secimBaslik: { fontSize: 19, fontWeight: '800', color: t.yazi, paddingHorizontal: 18 },
  secimAlt: { fontSize: 13, color: t.soluk, paddingHorizontal: 18, paddingTop: 3, paddingBottom: 10 },
  secimSatir: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.cizgi,
  },
  secimIkon: { width: 34, height: 34, borderRadius: 10, backgroundColor: t.vurguAcik, alignItems: 'center', justifyContent: 'center' },
  secimYazi: { fontSize: 15.5, fontWeight: '600', color: t.yazi },
  secimIptal: { alignItems: 'center', paddingVertical: 15, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.cizgi },
  secimIptalYazi: { fontSize: 15, fontWeight: '600', color: t.soluk },
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
