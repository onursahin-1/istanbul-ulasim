// Telefonda saklanan kişisel kayıtlar: Ev / İş adresleri ve favori duraklar.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import type { Konum } from './otp';

export type YerTuru = 'ev' | 'is';
export type FavoriDurak = { gtfsId: string; ad: string };

const YER_ANAHTARI = 'kayitli-yerler-v1';
const FAVORI_ANAHTARI = 'favori-duraklar-v1';

type Yerler = Partial<Record<YerTuru, Konum>>;

async function oku<T>(anahtar: string, varsayilan: T): Promise<T> {
  try {
    const ham = await AsyncStorage.getItem(anahtar);
    return ham ? (JSON.parse(ham) as T) : varsayilan;
  } catch {
    return varsayilan;
  }
}

async function yaz(anahtar: string, deger: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(anahtar, JSON.stringify(deger));
  } catch {
    // Kayıt başarısız olursa uygulama çalışmaya devam eder; kayıt sadece bir kolaylık.
  }
}

// Ekranlar arasında aynı veriyi paylaşmak için basit bir abonelik listesi.
const dinleyiciler = new Set<() => void>();
const haberVer = () => dinleyiciler.forEach((f) => f());

export async function yerKaydet(tur: YerTuru, konum: Konum): Promise<void> {
  const yerler = await oku<Yerler>(YER_ANAHTARI, {});
  yerler[tur] = konum;
  await yaz(YER_ANAHTARI, yerler);
  haberVer();
}

export async function favoriDegistir(durak: FavoriDurak): Promise<void> {
  const liste = await oku<FavoriDurak[]>(FAVORI_ANAHTARI, []);
  const varMi = liste.some((d) => d.gtfsId === durak.gtfsId);
  await yaz(FAVORI_ANAHTARI, varMi ? liste.filter((d) => d.gtfsId !== durak.gtfsId) : [durak, ...liste].slice(0, 10));
  haberVer();
}

export function useKayitlar() {
  const [yerler, setYerler] = useState<Yerler>({});
  const [favoriler, setFavoriler] = useState<FavoriDurak[]>([]);

  const yukle = useCallback(async () => {
    setYerler(await oku<Yerler>(YER_ANAHTARI, {}));
    setFavoriler(await oku<FavoriDurak[]>(FAVORI_ANAHTARI, []));
  }, []);

  useEffect(() => {
    yukle();
    dinleyiciler.add(yukle);
    return () => {
      dinleyiciler.delete(yukle);
    };
  }, [yukle]);

  return { yerler, favoriler };
}
