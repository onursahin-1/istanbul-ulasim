// Uygulamayla gelen görselleri (hat logoları, otobüs/minibüs simgeleri) telefona bir kez
// indirip oradan gösterir.
//
// Neden: geliştirme sırasında (Expo Go) `require` edilen her görsel Expo sunucusundan
// isteniyor ve sunucu önbelleğe alınmasına izin vermiyor; aynı logo her satırda, her ekranda
// yeniden indiriliyor. Evdeki ağda fark edilmiyordu; telefon mobil veriden Tailscale ile
// bağlanınca her istek yüzlerce milisaniye sürüyor ve listelerde logolar boş beyaz kutu olarak
// kalıyordu. Görseller açılışta (açılış animasyonu sürerken) bir kez telefonun önbelleğine
// indiriliyor, bileşenler oradan gösteriyor. Uygulama kendi başına kurulduğunda görseller
// zaten içinde; indirme anında biter, davranış aynı.

import { Asset } from 'expo-asset';
import { useSyncExternalStore } from 'react';
import type { ImageSourcePropType } from 'react-native';

const yerel = new Map<number, string>();
let surum = 0;
const dinleyiciler = new Set<() => void>();

function abone(dinleyici: () => void) {
  dinleyiciler.add(dinleyici);
  return () => {
    dinleyiciler.delete(dinleyici);
  };
}

/** Görselleri telefona indirir; biten her biri, onu gösteren bileşenleri yeniler. */
export function gorselleriIndir(moduller: number[]): Promise<void> {
  return Promise.all(
    moduller.map(async (modul) => {
      if (yerel.has(modul)) return;
      try {
        const varlik = Asset.fromModule(modul);
        await varlik.downloadAsync();
        if (varlik.localUri) {
          yerel.set(modul, varlik.localUri);
          surum++;
          dinleyiciler.forEach((d) => d());
        }
      } catch {
        // İnemezse görsel eskisi gibi sunucudan gösterilir.
      }
    }),
  ).then(() => undefined);
}

/** Görselin telefondaki kopyası; henüz inmediyse özgün kaynak. */
export function useYerelKaynak<T extends ImageSourcePropType | undefined>(kaynak: T): T | { uri: string } {
  useSyncExternalStore(abone, () => surum);
  if (typeof kaynak !== 'number') return kaynak;
  const uri = yerel.get(kaynak);
  return uri ? { uri } : kaynak;
}
