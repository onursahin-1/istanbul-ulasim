// Yolculuk kaydı: takip sırasında gelen her konum ve her adım geçişi bilgisayardaki
// köprüye gönderiliyor (kopru/kayit/yolculuklar/<kimlik>.jsonl). Gerçek bir yolculukta
// "neden bindiğimi anlamadı" sorusunun cevabı buradan çıkıyor; kayıt masada tekrar
// oynatılabiliyor (npm run yolculuk-oynat -- <dosya>).
//
// Yalnız geliştirme sürümünde (Expo Go). Köprü kapalıysa sessizce vazgeçer; kayıt
// yolculuğu hiçbir şekilde etkilemez.

import { KOPRU_ADRESI } from './otp';

const GONDERME_ARALIGI_MS = 15_000;
const EN_COK_OLAY = 3_000;

let kimlik: string | null = null;
let tampon: Record<string, unknown>[] = [];
let zamanlayici: ReturnType<typeof setInterval> | null = null;
let gonderiliyor = false;

const acik = () => typeof __DEV__ !== 'undefined' && __DEV__;

/** Yeni kayıt başlatır; önceki varsa önce onu gönderip kapatır. */
export function kayitBaslat(baslangic: Record<string, unknown>): void {
  if (!acik()) return;
  if (kimlik) kayitBitir();
  const simdi = new Date(Date.now() + 3 * 3_600_000).toISOString();
  kimlik = `${simdi.slice(0, 10)}-${simdi.slice(11, 19).replace(/:/g, '')}`;
  tampon = [{ t: Date.now(), tur: 'basla', ...baslangic }];
  zamanlayici = setInterval(gonder, GONDERME_ARALIGI_MS);
}

/** Kayda bir olay ekler (konum, durum, zamanlama...). Kayıt yoksa bir şey yapmaz. */
export function kayitEkle(tur: string, veri: Record<string, unknown> = {}): void {
  if (!kimlik) return;
  tampon.push({ t: Date.now(), tur, ...veri });
  if (tampon.length > EN_COK_OLAY) tampon.splice(0, tampon.length - EN_COK_OLAY);
}

/** Kalanı gönderir, kaydı kapatır. */
export function kayitBitir(): void {
  if (!kimlik) return;
  kayitEkle('bitti');
  gonder();
  if (zamanlayici) clearInterval(zamanlayici);
  zamanlayici = null;
  kimlik = null;
}

function gonder(): void {
  if (!kimlik || gonderiliyor || !tampon.length) return;
  const giden = tampon;
  const hangi = kimlik;
  tampon = [];
  gonderiliyor = true;
  const iptal = new AbortController();
  const sure = setTimeout(() => iptal.abort(), 8_000);
  fetch(`${KOPRU_ADRESI}/yolculuk-kaydi`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kimlik: hangi, olaylar: giden }),
    signal: iptal.signal,
  })
    .then((c) => {
      if (!c.ok) throw new Error(String(c.status));
    })
    .catch(() => {
      // Köprü kapalı ya da uzak: olaylar bir sonraki denemeye kalsın (sınırlı).
      if (hangi === kimlik) tampon = [...giden, ...tampon].slice(-EN_COK_OLAY);
    })
    .finally(() => {
      clearTimeout(sure);
      gonderiliyor = false;
    });
}
