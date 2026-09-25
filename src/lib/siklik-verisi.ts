// Minibüs, dolmuş ve gündüz seferleri sıklıkla tanımlı raylı hatların (Marmaray, M7,
// M11, T5 …) sıklık verisi (veri/siklik-cikar.py üretiyor). Ayrı dosyada:
// siklik.ts testlerden JSON yüklemeden çağrılabilsin.

import ham from '@/assets/veri/siklik.json';

import { siklikBul, siklikDurumu, type SiklikDurumu, type SiklikVerisi } from './siklik';

const VERI = ham as unknown as SiklikVerisi;

/** Bir minibüs/dolmuş ya da sıklıkla çalışan raylı hattın şu anki sıklık durumu; veri yoksa null. */
export function hatSikligi(kisaAd?: string | null, simdiMs: number = Date.now()): SiklikDurumu | null {
  return siklikDurumu(siklikBul(VERI, kisaAd), simdiMs);
}
