// Telefonun konumunu alan hook.

import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';

import { istanbulIcinde, VARSAYILAN_KONUM, type Nokta } from './cografya';

export type KonumDurumu =
  | { tur: 'bekleniyor'; nokta: Nokta }
  | { tur: 'gercek'; nokta: Nokta }
  | { tur: 'varsayilan'; nokta: Nokta; neden: string };

export function useKonum() {
  const [durum, setDurum] = useState<KonumDurumu>({ tur: 'bekleniyor', nokta: VARSAYILAN_KONUM });

  const yenile = useCallback(async () => {
    try {
      const izin = await Location.requestForegroundPermissionsAsync();
      if (izin.status !== 'granted') {
        setDurum({ tur: 'varsayilan', nokta: VARSAYILAN_KONUM, neden: 'Konum izni verilmedi; Kadıköy örnek konum olarak kullanılıyor.' });
        return;
      }
      const konum = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const nokta = { latitude: konum.coords.latitude, longitude: konum.coords.longitude };
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

  return { ...durum, yenile };
}
