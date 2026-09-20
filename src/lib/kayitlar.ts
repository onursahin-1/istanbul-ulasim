// Telefonda saklanan kişisel kayıtlar: Ev / İş adresleri ve favori duraklar.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import type { Konum } from './otp';
import type { UcretTuru } from './ucret';

export type YerTuru = 'ev' | 'is';
export type FavoriDurak = { gtfsId: string; ad: string };
/** Kullanıcının daha önce hedef olarak seçtiği yer. Kayıtlı sekmesinde listelenir. */
export type SonArama = { ad: string; lat: number; lon: number; alt?: string; zaman: number };

const YER_ANAHTARI = 'kayitli-yerler-v1';
const FAVORI_ANAHTARI = 'favori-duraklar-v1';
const ARAMA_ANAHTARI = 'son-aramalar-v1';
const UCRET_ANAHTARI = 'ucret-turu-v1';
const ARAMA_SINIRI = 12;

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

/**
 * Seçilen hedefi son aramalara ekler. Aynı yer tekrar seçilirse başa alınır,
 * liste belirli bir uzunlukta tutulur.
 */
export async function aramaKaydet(yer: { ad: string; lat: number; lon: number; alt?: string }): Promise<void> {
  if (!yer.ad?.trim()) return;
  const liste = await oku<SonArama[]>(ARAMA_ANAHTARI, []);
  const ayni = (a: SonArama) =>
    a.ad === yer.ad && Math.abs(a.lat - yer.lat) < 1e-5 && Math.abs(a.lon - yer.lon) < 1e-5;
  const yeni = [{ ...yer, zaman: Date.now() }, ...liste.filter((a) => !ayni(a))].slice(0, ARAMA_SINIRI);
  await yaz(ARAMA_ANAHTARI, yeni);
  haberVer();
}

export async function aramalariTemizle(): Promise<void> {
  await yaz(ARAMA_ANAHTARI, []);
  haberVer();
}

/** İstanbulkart türü: ücret hesabı buna göre yapılır. */
export async function ucretTuruKaydet(tur: UcretTuru): Promise<void> {
  await yaz(UCRET_ANAHTARI, tur);
  haberVer();
}

export function useKayitlar() {
  const [yerler, setYerler] = useState<Yerler>({});
  const [favoriler, setFavoriler] = useState<FavoriDurak[]>([]);
  const [aramalar, setAramalar] = useState<SonArama[]>([]);
  const [ucretTuru, setUcretTuru] = useState<UcretTuru>('tam');

  const yukle = useCallback(async () => {
    setYerler(await oku<Yerler>(YER_ANAHTARI, {}));
    setFavoriler(await oku<FavoriDurak[]>(FAVORI_ANAHTARI, []));
    setAramalar(await oku<SonArama[]>(ARAMA_ANAHTARI, []));
    setUcretTuru(await oku<UcretTuru>(UCRET_ANAHTARI, 'tam'));
  }, []);

  useEffect(() => {
    yukle();
    dinleyiciler.add(yukle);
    return () => {
      dinleyiciler.delete(yukle);
    };
  }, [yukle]);

  return { yerler, favoriler, aramalar, ucretTuru };
}
