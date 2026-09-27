// Konuşma motoru (expo-speech) üstünde ince katman: seçilen cinsiyette en kaliteli
// Türkçe sesle, kısaltmaları açarak ve biraz yavaş okur. Ses seçimi ses-secimi.ts'te.

import * as Speech from 'expo-speech';

import { sesSec, soylenecekMetin, type SesBilgisi, type SesCinsiyeti } from './ses-secimi';

/** 1 = sistemin olağan hızı; sokak gürültüsünde biraz yavaşı daha anlaşılır. */
const HIZ = 0.92;

let sesler: Promise<SesBilgisi[]> | null = null;

/** Telefonda yüklü sesler (bir kez sorulur; yeni ses indirilince sesleriTazele). */
export function sesleriGetir(): Promise<SesBilgisi[]> {
  if (!sesler) {
    sesler = Speech.getAvailableVoicesAsync()
      .then((v) => v as SesBilgisi[])
      .catch(() => []);
  }
  return sesler;
}

export function sesleriTazele(): void {
  sesler = null;
}

/** Kullanılacak ses: { ses, uydu } ya da Türkçe ses yoksa null. */
export async function secilenSes(cinsiyet: SesCinsiyeti) {
  return sesSec(await sesleriGetir(), cinsiyet);
}

/** Okur. `kes`: o an okunanı keserek (dönüşün "şimdi"si gibi acil cümleler). */
export async function konus(metin: string, cinsiyet: SesCinsiyeti, kes = false): Promise<void> {
  const secim = await secilenSes(cinsiyet);
  if (kes) await Speech.stop();
  Speech.speak(soylenecekMetin(metin), {
    language: 'tr-TR',
    voice: secim?.ses.identifier,
    rate: HIZ,
    // Sistem ayrı bir ses oturumu açsın: çalan müzik konuşurken kısılır, sonra geri gelir.
    useApplicationAudioSession: false,
  });
}

export function sus(): void {
  Speech.stop();
}
