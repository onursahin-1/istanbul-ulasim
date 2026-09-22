// Köprünün öğrendiklerini diskte tutar.
//
// Saatte ~48 hat sorgusuyla 784 hattın bir turu ~16 saat sürüyor; köprü her
// açılışta sıfırdan başlasaydı hiçbir zaman tam kapsamaya ulaşamazdı. Ayrıca son
// bir saatin istekleri de saklanıyor: köprüyü kapatıp açmak kotayı sıfırlamıyor,
// İBB saymaya devam ediyor.
//
// Yazma atomik: önce geçici dosyaya, sonra yeniden adlandırma. Yarıda kesilen bir
// yazma eski dosyayı bozmaz.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

export const SURUM = 1;

/** Dosyayı okur; yoksa ya da bozuksa boş nesne döner (köprü yine çalışır). */
export function oku(yol) {
  if (!existsSync(yol)) return {};
  try {
    const veri = JSON.parse(readFileSync(yol, 'utf8'));
    return veri?.surum === SURUM ? veri : {};
  } catch (e) {
    console.error(`öğrenilenler okunamadı (${yol}): ${e.message} — sıfırdan başlanıyor`);
    return {};
  }
}

export function yaz(yol, veri) {
  const gecici = `${yol}.yaziliyor`;
  writeFileSync(gecici, JSON.stringify({ surum: SURUM, kaydedildi: new Date().toISOString(), ...veri }));
  renameSync(gecici, yol);
}
