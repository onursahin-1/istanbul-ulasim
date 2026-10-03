// Telefonun konumu.
//
// İki ihtiyaç var:
//   • useKonum: ekranların (keşfet, arama, durak) "buradayım" noktası. Açılışta bir kez
//     alınıyor; uygulama arka plandan dönünce, konum bir dakikadan eskiyse tazeleniyor.
//     Yoksa evde açılıp dışarıda kullanılan uygulama rotayı evden çiziyordu.
//   • tazeKonum: rota aranırken "Konumum"un o anki hâli. Başlangıç noktası bulunulan
//     yer olsun diye arama anında yeniden soruluyor.
//
// Doğruluk "High" (iOS'ta ~10 m). Önceki "Balanced" iOS'ta 100 metrelik doğruluğa
// razı oluyordu: rota caddenin karşı yakasından, yanlış duraktan başlayabiliyordu.

import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { istanbulIcinde, VARSAYILAN_KONUM, type Nokta } from './cografya';

export type KonumDurumu =
  | { tur: 'bekleniyor'; nokta: Nokta }
  | { tur: 'gercek'; nokta: Nokta }
  | { tur: 'varsayilan'; nokta: Nokta; neden: string };

/** Uygulama öne gelince bundan eski konum tazelenir. */
const ESKIME_MS = 60_000;
/** Arama anında bundan yeni ve bundan iyi doğruluklu son konum yeniden sorulmadan kullanılır. */
const SON_KONUM_YASI_MS = 15_000;
const SON_KONUM_DOGRULUGU_M = 30;
/** Taze konum bu sürede gelmezse eldekiyle devam edilir. */
const TAZE_KONUM_SURESI_MS = 6_000;

function noktaYap(k: Location.LocationObject): Nokta {
  return { latitude: k.coords.latitude, longitude: k.coords.longitude };
}

/**
 * Telefonun şu anki konumu; izin yoksa, alınamazsa, süre dolarsa ya da İstanbul
 * dışındaysa null (çağıran eldeki noktayla devam eder). İzin sormaz.
 */
export async function tazeKonum(sure = TAZE_KONUM_SURESI_MS): Promise<Nokta | null> {
  try {
    const izin = await Location.getForegroundPermissionsAsync();
    if (izin.status !== 'granted') return null;
    const son = await Location.getLastKnownPositionAsync({
      maxAge: SON_KONUM_YASI_MS,
      requiredAccuracy: SON_KONUM_DOGRULUGU_M,
    });
    const konum =
      son ??
      (await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<null>((coz) => setTimeout(() => coz(null), sure)),
      ]));
    if (!konum) return null;
    const nokta = noktaYap(konum);
    return istanbulIcinde(nokta) ? nokta : null;
  } catch {
    return null;
  }
}

export function useKonum() {
  const [durum, setDurum] = useState<KonumDurumu>({ tur: 'bekleniyor', nokta: VARSAYILAN_KONUM });
  const sonAlinma = useRef(0);

  const yenile = useCallback(async () => {
    try {
      const izin = await Location.requestForegroundPermissionsAsync();
      if (izin.status !== 'granted') {
        setDurum({ tur: 'varsayilan', nokta: VARSAYILAN_KONUM, neden: 'Konum izni verilmedi; Kadıköy örnek konum olarak kullanılıyor.' });
        return;
      }
      const konum = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const nokta = noktaYap(konum);
      sonAlinma.current = Date.now();
      if (!istanbulIcinde(nokta)) {
        setDurum({ tur: 'varsayilan', nokta: VARSAYILAN_KONUM, neden: 'İstanbul dışındasın; Kadıköy örnek konum olarak kullanılıyor.' });
        return;
      }
      setDurum({ tur: 'gercek', nokta });
    } catch {
      setDurum({ tur: 'varsayilan', nokta: VARSAYILAN_KONUM, neden: 'Konum alınamadı; Kadıköy örnek konum olarak kullanılıyor.' });
    }
  }, []);

  useEffect(() => {
    yenile();
  }, [yenile]);

  // Arka plandan dönünce: konum eskidiyse yeniden al.
  useEffect(() => {
    const abone = AppState.addEventListener('change', (hal) => {
      if (hal === 'active' && sonAlinma.current && Date.now() - sonAlinma.current > ESKIME_MS) yenile();
    });
    return () => abone.remove();
  }, [yenile]);

  return { ...durum, yenile };
}
