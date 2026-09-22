// Node'un kendi TypeScript desteğini projenin içe aktarma biçimiyle uzlaştırır.
//
// Sorun: testleri şimdiye kadar tsx çalıştırıyordu, tsx de esbuild'e bağlı.
// esbuild ikili dosyası işletim sistemine özel; node_modules Windows'ta kurulunca
// Linux'ta, Linux'ta kurulunca Windows'ta çalışmıyor. Bu depo iki yerden birden
// kullanıldığı için `npm test` sürekli bir tarafta kırılıyordu.
//
// Node 22 zaten TypeScript'i kendisi soyabiliyor (--experimental-strip-types),
// tek eksiği uzantısız göreli içe aktarmaları çözmemesi: `from './metin'` diyoruz,
// Node `./metin.ts` aramıyor. Bu kanca o boşluğu dolduruyor — başka hiçbir şey
// yapmıyor, tür denetimi `npx tsc --noEmit` işi.

import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as birlestir } from 'node:path';
import { register } from 'node:module';

const UZANTILAR = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

export function resolve(belirtec, baglam, sonraki) {
  const goreli = belirtec.startsWith('./') || belirtec.startsWith('../');
  const uzantisiz = !/\.[cm]?[jt]sx?$|\.json$/.test(belirtec);
  if (goreli && uzantisiz && baglam.parentURL) {
    const klasor = dirname(fileURLToPath(baglam.parentURL));
    for (const ek of UZANTILAR) {
      const aday = birlestir(klasor, belirtec + ek);
      if (existsSync(aday)) return sonraki(pathToFileURL(aday).href, baglam);
    }
  }
  return sonraki(belirtec, baglam);
}

// Dosya doğrudan --import ile verildiğinde kendini kanca olarak kaydeder.
if (!process.env.TS_COZUCU_KAYITLI) {
  process.env.TS_COZUCU_KAYITLI = '1';
  register(import.meta.url, import.meta.url);
}
