// Harita üzerindeki otobüs ve durak işaretleri (Apple Haritalar, react-native-maps).
//
// İşaretler gerçek görünüm olarak çiziliyor; iOS'ta Marker'ın içindeki görünüm
// harita üstünde yaşıyor, resme çevrilmiyor. Bu yüzden içlerindeki animasyonlar
// (okun dönmesi, halka, hale) haritada da oynuyor.

import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';
import Reanimated, { useAnimatedStyle, useReducedMotion, type SharedValue } from 'react-native-reanimated';

import { Pressable } from '@/components/dokun';

import { Ikon } from '@/components/ulasim';
import { tahminiKonum, type YerlesikArac } from '@/lib/arac-konum';
import { useCanliAralik } from '@/lib/canli-aralik';
import type { Nokta } from '@/lib/cografya';
import { bayatlik, enKisaAci, koniOlcusu, renkKaristir } from '@/lib/hareket';
import { useTema } from '@/lib/tema';

/**
 * Otobüs: hat renginde yuvarlak, içinde otobüs simgesi; yönü biliniyorsa gittiği
 * yöne bakan küçük bir ok (en kısa yoldan yumuşakça döner).
 *
 * Konum eskidikçe renk griye karışır ve işaret solar; 2 dakikadan sonra altında yaşı
 * yazar, 5 dakikadan sonra gri ve kesikli çerçeveli. Yeni konum gelince (`tazelendi`
 * artınca) etrafında bir halka yayılır. İzlenen otobüs biraz büyük ve etrafında nefes
 * alan bir hale var.
 */
export function OtobusIsareti({
  renk,
  yon,
  soluk = false,
  yasSn,
  tazelendi = 0,
  izlenen = false,
}: {
  renk: string;
  yon?: number | null;
  /** Eski konum (yaşı bilinmiyorsa bununla gri). */
  soluk?: boolean;
  /** Konumun yaşı, sn: solma ve yaş etiketi için. */
  yasSn?: number;
  /** Her yeni konumda bir artar: halka yayılır. */
  tazelendi?: number;
  izlenen?: boolean;
}) {
  const tema = useTema();
  const azalt = useReducedMotion();
  const b = bayatlik(yasSn ?? (soluk ? Infinity : 0));
  const eski = soluk || b.eski;
  const zemin = eski ? tema.soluk : renkKaristir(renk, tema.soluk, b.oran * 0.75);

  // Ok: önceki açıdan en kısa yoldan dönülür (350° → 10° tam tur atmadan).
  const aci = useRef(new Animated.Value(yon ?? 0)).current;
  const sonAci = useRef(yon ?? 0);
  useEffect(() => {
    if (yon == null) return;
    const hedef = enKisaAci(sonAci.current, yon);
    sonAci.current = hedef;
    if (azalt) {
      aci.setValue(hedef);
      return;
    }
    const a = Animated.timing(aci, { toValue: hedef, duration: 350, easing: Easing.out(Easing.quad), useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [yon, azalt, aci]);

  // Yeni konum: halka yayılıp söner.
  const halka = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (tazelendi === 0 || azalt) return;
    halka.setValue(0);
    const a = Animated.timing(halka, { toValue: 1, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [tazelendi, azalt, halka]);

  // İzlenen otobüsün halesi: yavaşça nefes alır.
  const hale = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!izlenen || azalt) return;
    const d = Animated.loop(
      Animated.sequence([
        Animated.timing(hale, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(hale, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    d.start();
    return () => d.stop();
  }, [izlenen, azalt, hale]);

  return (
    <View style={[stil.otobusKutu, izlenen && { transform: [{ scale: 1.15 }] }]}>
      {izlenen && (
        <Animated.View
          style={[
            stil.hale,
            {
              backgroundColor: renk,
              opacity: azalt ? 0.18 : hale.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.08] }),
              transform: [{ scale: azalt ? 1 : hale.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.15] }) }],
            },
          ]}
        />
      )}
      {!azalt && (
        <Animated.View
          style={[
            stil.halka,
            {
              borderColor: zemin,
              opacity: halka.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }),
              transform: [{ scale: halka.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] }) }],
            },
          ]}
        />
      )}
      {yon != null && (
        <Animated.View
          style={[
            stil.okKutu,
            {
              opacity: b.saydamlik,
              transform: [{ rotate: aci.interpolate({ inputRange: [0, 360], outputRange: ['0deg', '360deg'], extrapolate: 'extend' }) }],
            },
          ]}
        >
          <View style={[stil.ok, { borderBottomColor: zemin }]} />
        </Animated.View>
      )}
      <View
        style={[
          stil.otobus,
          { backgroundColor: zemin, borderColor: tema.yuzey, opacity: b.saydamlik },
          eski && stil.otobusEski,
        ]}
      >
        <Ikon ad="bus" boyut={14} renkKodu="#fff" />
      </View>
      {!!b.etiket && (
        <View style={[stil.yas, { backgroundColor: tema.yuzey, borderColor: tema.cizgi }]}>
          <Text style={[stil.yasYazi, { color: tema.soluk }]}>{b.etiket}</Text>
        </View>
      )}
    </View>
  );
}

/** Hattın durağı: küçük halka. İşaretliyse (yolcunun durağı) büyük ve dolu. */
export function DurakIsareti({ renk, isaretli = false }: { renk: string; isaretli?: boolean }) {
  const tema = useTema();
  return isaretli ? (
    <View style={[stil.durakBuyuk, { backgroundColor: renk, borderColor: tema.yuzey }]} />
  ) : (
    <View style={[stil.durak, { borderColor: renk, backgroundColor: tema.yuzey }]} />
  );
}

/** Yön konisinin katmanları: tepeye yakın üst üste binip koyulaşır, uca doğru söner. */
const KONI_KATMANLARI = [1, 0.72, 0.45];
const KONI_RENGI = 'rgba(74,155,255,0.2)';

/**
 * Yön konisi: konum noktasının üstünde, telefonun baktığı yöne açılan yarı saydam üçgen
 * (Moovit, Google Haritalar). Tepesi noktada; genişliği pusulanın ne kadar emin olduğunu
 * söyler (koniOlcusu). Dönüş arayüz iş parçacığında: `yon` telefonun yönü, `haritaYonu`
 * haritanın döndüğü açı (kuzey yukarıdaysa 0); ikisi de derece, sarılmamış olabilir.
 */
export function YonKonisi({
  yon,
  haritaYonu,
  seviye,
}: {
  yon: SharedValue<number>;
  haritaYonu: SharedValue<number>;
  seviye: number;
}) {
  const olcu = koniOlcusu(seviye);
  const R = olcu?.boy ?? 0;
  const donus = useAnimatedStyle(() => ({ transform: [{ rotate: `${yon.value - haritaYonu.value}deg` }] }));
  if (!olcu) return null;
  const yariAci = (olcu.aci / 2) * (Math.PI / 180);
  return (
    <Reanimated.View pointerEvents="none" style={[{ width: 2 * R, height: 2 * R }, donus]}>
      {KONI_KATMANLARI.map((k, i) => {
        const h = R * k;
        const yari = Math.tan(yariAci) * h;
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: R - yari,
              top: R - h,
              width: 0,
              height: 0,
              borderLeftWidth: yari,
              borderRightWidth: yari,
              borderTopWidth: h,
              borderLeftColor: 'transparent',
              borderRightColor: 'transparent',
              borderTopColor: KONI_RENGI,
            }}
          />
        );
      })}
    </Reanimated.View>
  );
}

/**
 * Pusula düğmesi: içindeki ibre kuzeyi gösterir (harita döndükçe döner). Basınca harita
 * telefonun baktığı yöne döner (yön yukarıda); bir daha basınca kuzey yukarı.
 */
export function PusulaDugmesi({
  aktif,
  haritaYonu,
  onPress,
}: {
  aktif: boolean;
  haritaYonu: SharedValue<number>;
  onPress: () => void;
}) {
  const tema = useTema();
  const ibre = useAnimatedStyle(() => ({ transform: [{ rotate: `${-haritaYonu.value}deg` }] }));
  return (
    <Pressable
      onPress={onPress}
      style={[stil.pusula, { backgroundColor: aktif ? tema.vurgu : tema.yuzey }]}
      accessibilityRole="switch"
      accessibilityState={{ checked: aktif }}
      accessibilityLabel={aktif ? 'Harita baktığın yöne dönük. Kuzeyi yukarı almak için dokun' : 'Haritayı baktığın yöne çevir'}
    >
      <Reanimated.View style={[stil.ibre, ibre]}>
        <View style={[stil.ibreUc, { borderBottomColor: '#e5484d' }]} />
        <View style={[stil.ibreUc, stil.ibreAlt, { borderBottomColor: aktif ? tema.vurguYazi : tema.soluk }]} />
      </Reanimated.View>
      <Text style={[stil.pusulaN, { color: aktif ? tema.vurguYazi : tema.yazi }]}>N</Text>
    </Pressable>
  );
}

/** Tahmini konum bu aralıkla yenilenir: işaret sıçramadan kayıyor görünsün. */
const AKICI_ARALIK_MS = 125;
/** Yeni gerçek konum tahminden farklıysa işaret oraya bu sürede süzülür. */
const DUZELTME_MS = 1200;

/**
 * Haritadaki canlı otobüs: köprü konumu 75 sn'de bir verebiliyor (İBB kotası); arada
 * otobüs donup sonra sıçramasın diye son konumdan bu yana güzergâh üstünde ortalama
 * hızla ilerletiliyor (arac-konum.ts, tahminiKonum). Saniyede sekiz kez yenilendiği için
 * işaret kayarak gidiyor. Yeni gerçek konum gelince tahmin şaşmışsa işaret oraya
 * ışınlanmıyor, 1,2 saniyede süzülüyor. Yalnız bu işaret yenileniyor, ekranın geri kalanı
 * değil. Eski (5 dk'dan eski) konum ilerletilmez, gri durur.
 *
 * "Hareketi azalt" açıksa saniyede bir yenilenir, süzülme yok (bugünkü gibi).
 */
export function HareketliOtobus({
  otobus,
  cizgi,
  hiz,
  renk,
  baslik,
  aciklama,
  izlenen = false,
}: {
  otobus: Pick<YerlesikArac, 'lat' | 'lon' | 'an' | 'durum' | 'heading' | 'sinif'>;
  /** Otobüsün gittiği güzergâh (en azından durakları sırayla). */
  cizgi: Nokta[];
  /** Ortalama hız, m/sn (OTOBUS_HIZI_MS, METROBUS_HIZI_MS). */
  hiz: number;
  renk: string;
  baslik: string;
  aciklama: string;
  /** Kullanıcının izlediği otobüs: büyük ve haleli. */
  izlenen?: boolean;
}) {
  const azalt = useReducedMotion();
  const [simdi, setSimdi] = useState(() => Date.now());
  const yasSn = Number.isFinite(otobus.an) ? (simdi - otobus.an) / 1000 : Infinity;
  const canli = otobus.sinif !== 'eski' && !bayatlik(yasSn).eski;
  // Eski konum ilerlemiyor: yalnız yaş etiketi için seyrek.
  useCanliAralik(() => setSimdi(Date.now()), canli ? (azalt ? 1_000 : AKICI_ARALIK_MS) : 15_000);

  const tahmin = canli
    ? tahminiKonum(otobus, cizgi, hiz, simdi)
    : { latitude: otobus.lat, longitude: otobus.lon, yon: otobus.heading, tahmini: false };

  // Yeni gerçek konum (lat/lon değişti): ekrandaki yerden yenisine süzülme.
  const [duzeltme, setDuzeltme] = useState<{ bas: number; dLat: number; dLon: number; n: number } | null>(null);
  const gosterilen = useRef<{ latitude: number; longitude: number } | null>(null);
  const [onceki, setOnceki] = useState({ lat: otobus.lat, lon: otobus.lon });
  if (onceki.lat !== otobus.lat || onceki.lon !== otobus.lon) {
    setOnceki({ lat: otobus.lat, lon: otobus.lon });
    const g = gosterilen.current;
    setDuzeltme({
      bas: Date.now(),
      dLat: g && !azalt ? g.latitude - tahmin.latitude : 0,
      dLon: g && !azalt ? g.longitude - tahmin.longitude : 0,
      n: (duzeltme?.n ?? 0) + 1,
    });
  }
  let latitude = tahmin.latitude;
  let longitude = tahmin.longitude;
  if (duzeltme && !azalt) {
    const t = Math.min(1, (simdi - duzeltme.bas) / DUZELTME_MS);
    const kalan = 1 - (1 - Math.pow(1 - t, 3));
    latitude += duzeltme.dLat * kalan;
    longitude += duzeltme.dLon * kalan;
  }
  useEffect(() => {
    gosterilen.current = { latitude, longitude };
  });

  return (
    <Marker
      coordinate={{ latitude, longitude }}
      anchor={{ x: 0.5, y: 0.5 }}
      title={baslik}
      description={tahmin.tahmini ? `${aciklama} · tahmini yer` : aciklama}
      zIndex={izlenen ? 12 : 10}
    >
      <OtobusIsareti
        renk={renk}
        yon={tahmin.yon}
        soluk={!canli}
        yasSn={yasSn}
        tazelendi={duzeltme?.n ?? 0}
        izlenen={izlenen}
      />
    </Marker>
  );
}

const OTOBUS = 30;
/** İşaretin kutusu: ok, halka ve yaş etiketi sığsın. */
const KUTU = 64;
const OK_KUTU = 46;

const stil = StyleSheet.create({
  otobusKutu: { width: KUTU, height: KUTU, alignItems: 'center', justifyContent: 'center' },
  okKutu: {
    position: 'absolute',
    left: (KUTU - OK_KUTU) / 2,
    top: (KUTU - OK_KUTU) / 2,
    width: OK_KUTU,
    height: OK_KUTU,
    alignItems: 'center',
  },
  ok: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderBottomWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  otobus: {
    width: OTOBUS,
    height: OTOBUS,
    borderRadius: OTOBUS / 2,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  otobusEski: { borderStyle: 'dashed' },
  halka: {
    position: 'absolute',
    left: (KUTU - OTOBUS) / 2,
    top: (KUTU - OTOBUS) / 2,
    width: OTOBUS,
    height: OTOBUS,
    borderRadius: OTOBUS / 2,
    borderWidth: 2.5,
  },
  hale: {
    position: 'absolute',
    left: (KUTU - 44) / 2,
    top: (KUTU - 44) / 2,
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  yas: {
    position: 'absolute',
    top: KUTU / 2 + OTOBUS / 2 + 1,
    alignSelf: 'center',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 5,
  },
  yasYazi: { fontSize: 10, fontWeight: '800' },
  pusula: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  ibre: { position: 'absolute', width: 10, height: 30, alignItems: 'center' },
  ibreUc: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderBottomWidth: 11,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  ibreAlt: { position: 'absolute', bottom: 0, transform: [{ rotate: '180deg' }] },
  pusulaN: { position: 'absolute', bottom: 3, fontSize: 8.5, fontWeight: '800' },
  durak: { width: 10, height: 10, borderRadius: 5, borderWidth: 2.5 },
  durakBuyuk: { width: 18, height: 18, borderRadius: 9, borderWidth: 3 },
});
