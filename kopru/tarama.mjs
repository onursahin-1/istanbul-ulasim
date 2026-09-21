// Hangi aracın hangi güzergâhta olduğunu yavaş yavaş öğrenir.
//
// Canlı filo servisi tek çağrıyla bütün araçların konumunu veriyor ama hat bilgisi
// vermiyor. Hat bilgisi yalnızca hat hat sorulan servisten geliyor ve o servis hız
// sınırlı. Çözüm: arka planda hatları sırayla, ağır ağır gezip kapı numarası → güzergâh
// eşlemesini kurmak. Bir otobüs turunu bitirene kadar hattını değiştirmediği için bu
// eşleme dakikalarca geçerli kalır.
//
// Yoğun hatlar öne alınıyor: 130 araçlı 34G'yi sık, 1 araçlı bir mahalle hattını
// seyrek sormak hem daha faydalı hem de sınıra daha saygılı.

import { hattakiAraclar, SinirHatasi } from './iett.mjs';

export class Tarayici {
  /**
   * @param {object} kapi hız sınırlı istek kapısı
   * @param {number} unutmaDk bu süre boyunca görülmeyen araç eşlemesi düşer
   */
  constructor(kapi, { unutmaDk = 30 } = {}) {
    this.kapi = kapi;
    this.unutmaMs = unutmaDk * 60_000;
    /** kapı no → { guzergah, hat, an } */
    this.atama = new Map();
    /** hat kodu → { sonBakilan, aracSayisi } */
    this.hatDurumu = new Map();
    this.hatlar = [];
    this.calisiyor = false;
    this.sayac = { tur: 0, hatSoruldu: 0, sinir: 0, hata: 0 };
  }

  hatlariAyarla(hatlar) {
    this.hatlar = hatlar;
    for (const h of hatlar) {
      if (!this.hatDurumu.has(h)) this.hatDurumu.set(h, { sonBakilan: 0, aracSayisi: 1 });
    }
  }

  /**
   * Sıradaki hat: en çok "gecikmiş" olan.
   * Puan = geçen süre × (araç sayısı + 1). Yoğun hat daha sık sıraya gelir.
   */
  #sıradakiHat() {
    const simdi = Date.now();
    let enIyi = null;
    let enYuksek = -1;
    for (const hat of this.hatlar) {
      const d = this.hatDurumu.get(hat);
      const puan = (simdi - d.sonBakilan) * (d.aracSayisi + 1);
      if (puan > enYuksek) {
        enYuksek = puan;
        enIyi = hat;
      }
    }
    return enIyi;
  }

  /** Arka plan döngüsü. Kapı kapalıysa kendiliğinden bekler. */
  async basla() {
    if (this.calisiyor) return;
    this.calisiyor = true;
    while (this.calisiyor) {
      const hat = this.#sıradakiHat();
      if (!hat) {
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      const durum = this.hatDurumu.get(hat);
      durum.sonBakilan = Date.now();
      try {
        const araclar = await hattakiAraclar(this.kapi, hat);
        this.sayac.hatSoruldu++;
        durum.aracSayisi = araclar.length;
        const an = Date.now();
        for (const a of araclar) {
          if (a.kapiNo && a.guzergah) this.atama.set(a.kapiNo, { guzergah: a.guzergah, hat: a.hat, an });
        }
        if (this.hatlar.length && this.sayac.hatSoruldu % this.hatlar.length === 0) this.sayac.tur++;
      } catch (e) {
        if (e instanceof SinirHatasi) {
          this.sayac.sinir++;
          // Kapı zaten ceza süresini uyguluyor; burada ayrıca beklemeye gerek yok.
        } else {
          this.sayac.hata++;
        }
      }
      this.#unut();
    }
  }

  dur() {
    this.calisiyor = false;
  }

  #unut() {
    const sinir = Date.now() - this.unutmaMs;
    for (const [kapiNo, k] of this.atama) {
      if (k.an < sinir) this.atama.delete(kapiNo);
    }
  }

  /** Bir aracın güzergâhı; bilinmiyorsa null. */
  guzergah(kapiNo) {
    return this.atama.get(kapiNo)?.guzergah ?? null;
  }

  ozet() {
    const simdi = Date.now();
    const yaslar = [...this.atama.values()].map((k) => (simdi - k.an) / 1000);
    yaslar.sort((a, b) => a - b);
    return {
      bilinenArac: this.atama.size,
      hatSoruldu: this.sayac.hatSoruldu,
      tamTur: this.sayac.tur,
      sinir: this.sayac.sinir,
      hata: this.sayac.hata,
      eslemeYasiOrtancaSn: yaslar.length ? Math.round(yaslar[yaslar.length >> 1]) : null,
    };
  }
}
