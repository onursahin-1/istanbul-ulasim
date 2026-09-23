// Minibüs ve dolmuş sıklık verisi (veri/siklik-cikar.py üretiyor). Ayrı dosyada:
// siklik.ts testlerden JSON yüklemeden çağrılabilsin.

import ham from '@/assets/veri/siklik.json';

import { siklikBul, siklikDurumu, type SiklikDurumu, type SiklikVerisi } from './siklik';

const VERI = ham as unknown as SiklikVerisi;

/** Bir minibüs/dolmuş hattının şu anki sıklık durumu; veri yoksa null. */
export function hatSikligi(kisaAd?: string | null, simdiMs: number = Date.now()): SiklikDurumu | null {
  return siklikDurumu(siklikBul(VERI, kisaAd), simdiMs);
}
