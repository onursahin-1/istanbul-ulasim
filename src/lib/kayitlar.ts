// Telefonda saklanan kişisel kayıtlar: Ev / İş adresleri, favori yerler ve favori duraklar.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { Appearance } from 'react-native';

import type { Konum, RotaSecenekleri } from './otp';
import { secenekleriDuzelt, VARSAYILAN_SECENEKLER } from './otp';
import type { SesCinsiyeti } from './ses-secimi';
import type { UcretTuru } from './ucret';

export type YerTuru = 'ev' | 'is';
export type FavoriDurak = { gtfsId: string; ad: string };
/** Haritada basılı tutup favorilere eklenen yer. */
export type FavoriYer = { ad: string; alt?: string; lat: number; lon: number };
/** Görünüm: telefonun ayarını izle ya da her zaman açık/koyu. */
export type TemaTercihi = 'sistem' | 'acik' | 'koyu';
/** Kullanıcının daha önce hedef olarak seçtiği yer. Kayıtlı sekmesinde listelenir. */
export type SonArama = { ad: string; lat: number; lon: number; alt?: string; zaman: number };

const YER_ANAHTARI = 'kayitli-yerler-v1';
const FAVORI_ANAHTARI = 'favori-duraklar-v1';
const FAVORI_YER_ANAHTARI = 'favori-yerler-v1';
const FAVORI_YER_SINIRI = 30;
const ARAMA_ANAHTARI = 'son-aramalar-v1';
const UCRET_ANAHTARI = 'ucret-turu-v1';
const ROTA_ANAHTARI = 'rota-secenekleri-v1';
const EKRAN_ANAHTARI = 'yolculukta-ekran-acik-v1';
const SES_ANAHTARI = 'yolculukta-sesli-tarif-v1';
const SES_CINSIYETI_ANAHTARI = 'sesli-tarif-cinsiyet-v1';
const TEMA_ANAHTARI = 'tema-tercihi-v1';
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

/** İki nokta aynı yer mi: ~15 metreden yakınsa. */
export function ayniYer(a: { lat: number; lon: number }, b: { lat: number; lon: number }): boolean {
  return Math.abs(a.lat - b.lat) < 1.5e-4 && Math.abs(a.lon - b.lon) < 1.5e-4;
}

/** Yeri favorilere ekler; zaten favoriyse çıkarır. Yeni eklenen başa geçer. */
export async function favoriYerDegistir(yer: FavoriYer): Promise<void> {
  const liste = await oku<FavoriYer[]>(FAVORI_YER_ANAHTARI, []);
  const varMi = liste.some((y) => ayniYer(y, yer));
  await yaz(
    FAVORI_YER_ANAHTARI,
    varMi ? liste.filter((y) => !ayniYer(y, yer)) : [yer, ...liste].slice(0, FAVORI_YER_SINIRI),
  );
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

/** Rota arama tercihi: az yürüme, az aktarma, erişilebilir güzergâh. */
export async function rotaSecenekleriKaydet(secenekler: RotaSecenekleri): Promise<void> {
  await yaz(ROTA_ANAHTARI, secenekler);
  haberVer();
}

/** İstanbulkart türü: ücret hesabı buna göre yapılır. */
/** Yolculuk takip edilirken ekran kararmasın mı (varsayılan: evet). */
export async function ekranAcikKaydet(acik: boolean): Promise<void> {
  await yaz(EKRAN_ANAHTARI, acik);
  haberVer();
}

/** Yolculukta sesli yol tarifi (varsayılan: açık). */
export async function sesliTarifKaydet(acik: boolean): Promise<void> {
  await yaz(SES_ANAHTARI, acik);
  haberVer();
}

/** Sesli tarifin sesi: kadın ya da erkek (varsayılan: kadın). */
export async function sesCinsiyetiKaydet(cinsiyet: SesCinsiyeti): Promise<void> {
  await yaz(SES_CINSIYETI_ANAHTARI, cinsiyet);
  haberVer();
}

const temaGecerli = (t: unknown): TemaTercihi => (t === 'acik' || t === 'koyu' ? t : 'sistem');

/**
 * Tercihi uygulamanın görünümüne uygular. React Native'in Appearance ayarı bütün
 * useColorScheme okumalarını (useTema, sekme çubuğu) ve iOS'un kendi parçalarını (saat
 * çarkı, uyarı pencereleri, klavye) birlikte çevirir; 'unspecified' telefonun ayarına döner.
 */
function temaUygula(tercih: TemaTercihi): void {
  Appearance.setColorScheme(tercih === 'acik' ? 'light' : tercih === 'koyu' ? 'dark' : 'unspecified');
}

/** Açılışta bir kez: kayıtlı tercihi okuyup uygular. */
export async function temaTercihiniYukle(): Promise<void> {
  temaUygula(temaGecerli(await oku<TemaTercihi>(TEMA_ANAHTARI, 'sistem')));
}

export async function temaTercihiKaydet(tercih: TemaTercihi): Promise<void> {
  temaUygula(tercih);
  await yaz(TEMA_ANAHTARI, tercih);
  haberVer();
}

export async function ucretTuruKaydet(tur: UcretTuru): Promise<void> {
  await yaz(UCRET_ANAHTARI, tur);
  haberVer();
}

export function useKayitlar() {
  const [yerler, setYerler] = useState<Yerler>({});
  const [favoriler, setFavoriler] = useState<FavoriDurak[]>([]);
  const [favoriYerler, setFavoriYerler] = useState<FavoriYer[]>([]);
  const [aramalar, setAramalar] = useState<SonArama[]>([]);
  const [ucretTuru, setUcretTuru] = useState<UcretTuru>('tam');
  const [rotaSecenekleri, setRotaSecenekleri] = useState<RotaSecenekleri>(VARSAYILAN_SECENEKLER);
  const [ekranAcik, setEkranAcik] = useState(true);
  const [sesliTarif, setSesliTarif] = useState(true);
  const [sesCinsiyeti, setSesCinsiyeti] = useState<SesCinsiyeti>('kadin');
  const [temaTercihi, setTemaTercihi] = useState<TemaTercihi>('sistem');
  // İlk okuma bitene kadar değerler varsayılan; buna göre iş başlatan ekranlar (rota araması) bekler.
  const [yuklendi, setYuklendi] = useState(false);

  const yukle = useCallback(async () => {
    setYerler(await oku<Yerler>(YER_ANAHTARI, {}));
    setFavoriler(await oku<FavoriDurak[]>(FAVORI_ANAHTARI, []));
    setFavoriYerler(await oku<FavoriYer[]>(FAVORI_YER_ANAHTARI, []));
    setAramalar(await oku<SonArama[]>(ARAMA_ANAHTARI, []));
    setUcretTuru(await oku<UcretTuru>(UCRET_ANAHTARI, 'tam'));
    setRotaSecenekleri(secenekleriDuzelt(await oku<RotaSecenekleri>(ROTA_ANAHTARI, VARSAYILAN_SECENEKLER)));
    setEkranAcik(await oku<boolean>(EKRAN_ANAHTARI, true));
    setSesliTarif(await oku<boolean>(SES_ANAHTARI, true));
    setSesCinsiyeti((await oku<SesCinsiyeti>(SES_CINSIYETI_ANAHTARI, 'kadin')) === 'erkek' ? 'erkek' : 'kadin');
    setTemaTercihi(temaGecerli(await oku<TemaTercihi>(TEMA_ANAHTARI, 'sistem')));
    setYuklendi(true);
  }, []);

  useEffect(() => {
    yukle();
    dinleyiciler.add(yukle);
    return () => {
      dinleyiciler.delete(yukle);
    };
  }, [yukle]);

  return {
    yerler,
    favoriler,
    favoriYerler,
    aramalar,
    ucretTuru,
    rotaSecenekleri,
    ekranAcik,
    sesliTarif,
    sesCinsiyeti,
    temaTercihi,
    yuklendi,
  };
}
