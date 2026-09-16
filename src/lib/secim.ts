// Rota sonuçları ekranından detay ekranına güzergâh aktarmak için bellek içi depo.
// Güzergâh verisi URL parametresine sığmayacak kadar büyük olduğu için burada tutulur.

import type { Guzergah } from './otp';

let sonGuzergahlar: Guzergah[] = [];

export function guzergahlariSakla(liste: Guzergah[]): void {
  sonGuzergahlar = liste;
}

export function guzergahGetir(sira: number): Guzergah | undefined {
  return sonGuzergahlar[sira];
}
