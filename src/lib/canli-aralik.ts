// Ekrandaki canlı bilgiyi belirli aralıklarla tazeleyen zamanlayıcı; yalnız ekran
// görünürken çalışır.
//
// Eskiden her ekran kendi setInterval'ını kuruyordu ve ekran başka bir ekranın altında
// kaldığında da (durak ekranı açıkken ana ekran, yolculuk ekranı açıkken hat ekranı)
// sunucuya sormaya devam ediyordu: yığında dört ekran varsa dört ayrı yenileme, üstteki
// ekranın kaydırması ve geçişleri bu yüzden takılıyordu. Şimdi:
//   - Ekran odakta değilse ya da uygulama arka plandaysa zamanlayıcı durur.
//   - Odağa dönünce (geri gelince, uygulama öne gelince) hemen bir kez tazeler; eski
//     bilgi aralık dolana kadar ekranda kalmaz.

import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

/**
 * @param is      tazeleme işi
 * @param aralik  milisaniye
 * @param etkin   false iken hiç çalışmaz (örneğin konum henüz belli değil)
 */
export function useCanliAralik(is: () => void, aralik: number, etkin = true): void {
  const son = useRef(is);
  useEffect(() => {
    son.current = is;
  }, [is]);
  const odakli = useIsFocused();
  const [onde, setOnde] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const abone = AppState.addEventListener('change', (d) => setOnde(d === 'active'));
    return () => abone.remove();
  }, []);

  // İlk çalışma ekranın kendi ilk yüklemesiyle çakışmasın: yalnız durup yeniden
  // başladığında hemen tazele.
  const durmustu = useRef(false);
  const calisir = etkin && odakli && onde;
  useEffect(() => {
    if (!etkin) return;
    if (!calisir) {
      durmustu.current = true;
      return;
    }
    if (durmustu.current) {
      durmustu.current = false;
      son.current();
    }
    const t = setInterval(() => son.current(), aralik);
    return () => clearInterval(t);
  }, [etkin, calisir, aralik]);
}

/** Yeni nabız gelmediyse iki istek arasında en az bu kadar (eski köprü `sonra`yı bilmiyor). */
export const AKIS_EN_AZ_ARALIK_MS = 30_000;
/** Köprüye ulaşılamadığında yeniden deneme. */
export const AKIS_HATA_BEKLEMESI_MS = 15_000;

/**
 * Köprünün nabzını izleyen canlı bilgi: yoklama yerine uzun bekleyen istek. Her istek son
 * alınan nabzı (`sonra`) gönderir; köprü yeni nabız gelene kadar cevabı tutar, uygulama
 * cevabı alınca hemen yeniden sorar. Yeni otobüs konumu 30 saniyelik aralığı beklemeden,
 * nabız biter bitmez ekranda.
 *
 * useCanliAralik gibi yalnız ekran odaktayken ve uygulama öndeyken çalışır; `anahtar`
 * değişince (başka hat, başka durak) eski istek iptal edilip baştan başlar.
 *
 * @param getir  `sonra` (ilk istekte null) ve iptal sinyaliyle sorar; köprüye ulaşılamazsa null
 * @param uygula yeni veri geldiğinde
 */
export function useNabizAkisi<T>(
  getir: (sonra: string | null, sinyal: AbortSignal) => Promise<{ nabiz: string | null; veri: T } | null>,
  uygula: (veri: T) => void,
  anahtar: string,
  etkin = true,
): void {
  const getirRef = useRef(getir);
  const uygulaRef = useRef(uygula);
  useEffect(() => {
    getirRef.current = getir;
    uygulaRef.current = uygula;
  }, [getir, uygula]);
  const odakli = useIsFocused();
  const [onde, setOnde] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const abone = AppState.addEventListener('change', (d) => setOnde(d === 'active'));
    return () => abone.remove();
  }, []);

  const calisir = etkin && odakli && onde && !!anahtar;
  useEffect(() => {
    if (!calisir) return;
    const iptal = new AbortController();
    const bekle = (ms: number) =>
      new Promise<void>((coz) => {
        const t = setTimeout(coz, ms);
        iptal.signal.addEventListener('abort', () => {
          clearTimeout(t);
          coz();
        });
      });
    (async () => {
      let sonra: string | null = null;
      while (!iptal.signal.aborted) {
        const bas = Date.now();
        let sonuc: { nabiz: string | null; veri: T } | null = null;
        try {
          sonuc = await getirRef.current(sonra, iptal.signal);
        } catch {
          sonuc = null;
        }
        if (iptal.signal.aborted) return;
        if (!sonuc) {
          await bekle(AKIS_HATA_BEKLEMESI_MS);
          continue;
        }
        const yeni = sonuc.nabiz == null || sonuc.nabiz !== sonra;
        if (yeni) uygulaRef.current(sonuc.veri);
        // Yeni nabız yoksa (köprü bekletip aynısını döndü, ya da eski köprü hemen döndü)
        // aralık dolmadan yeniden sorma.
        if (!yeni || sonuc.nabiz == null) await bekle(Math.max(0, AKIS_EN_AZ_ARALIK_MS - (Date.now() - bas)));
        sonra = sonuc.nabiz;
      }
    })();
    return () => iptal.abort();
  }, [calisir, anahtar]);
}
