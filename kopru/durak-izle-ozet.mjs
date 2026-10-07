// durak-izle kayıtlarını özetleyen saf hesaplar (durak-izle-rapor.mjs ve testler).

/** Kayıt satırlarını okur; bozuk satırları atlar. */
export function kaydiAyristir(metin) {
  const olaylar = [];
  for (const satir of metin.split('\n')) {
    if (!satir.trim()) continue;
    try {
      olaylar.push(JSON.parse(satir));
    } catch {
      // Betik yazarken kesilmiş son satır.
    }
  }
  return olaylar;
}

/**
 * Verilen anda (ms) iki kaynağın ne dediği: o ana en yakın örnek (en çok `enFazlaMs`
 * uzak). Ekran görüntüsünün saatiyle karşılaştırmak için: dakikalar o ana göre.
 * Dönüş: { ornekAn, duraklar: { [durakId]: { [hat]: { arac: [{dk, kalan, kapi}], otp: [{dk, canli, planliDk}] } } } } ya da null.
 */
export function anlikGoruntu(olaylar, an, enFazlaMs = 90_000) {
  // Ekran görüntüsünün saati dakikalık: o ana en yakın örnek (önce ya da sonra).
  let ornek = null;
  for (const o of olaylar) {
    if (o.tur !== 'ornek') continue;
    if (!ornek || Math.abs(o.t - an) < Math.abs(ornek.t - an)) ornek = o;
  }
  if (!ornek || Math.abs(an - ornek.t) > enFazlaMs) return null;
  const dk = (ms) => Math.round((ms - an) / 60_000);
  const duraklar = {};
  const kimlikler = new Set([...Object.keys(ornek.kopru?.duraklar ?? {}), ...Object.keys(ornek.otp ?? {})]);
  for (const id of kimlikler) {
    const hatlar = {};
    for (const [hat, l] of Object.entries(ornek.kopru?.duraklar?.[id] ?? {})) {
      const gelecek = l.filter((v) => v.varis >= an - 60_000);
      if (gelecek.length) (hatlar[hat] ??= { arac: [], otp: [] }).arac = gelecek.map((v) => ({ dk: dk(v.varis), kalan: v.kalan, kapi: v.kapi }));
    }
    for (const k of ornek.otp?.[id] ?? []) {
      if (k.tahmin < an - 60_000) continue;
      (hatlar[k.hat] ??= { arac: [], otp: [] }).otp.push({ dk: dk(k.tahmin), canli: k.canli, planliDk: dk(k.planli) });
    }
    duraklar[id] = hatlar;
  }
  return { ornekAn: ornek.t, bayat: !!ornek.kopru?.bayat, duraklar, teshis: ornek.teshis ?? {} };
}

/**
 * Her otobüsün (durak + kapı no) kayıt boyunca tahmini varışı: tahmin ne kadar oynadı ve
 * otobüs listeden ne zaman düştü (durağa vardı ya da geçti; köprünün konumu ~1,5 dk geride
 * olabilir). Dönüş: [{ durak, hat, kapi, ilk, son, tahminler: [{t, varis, kalan}], dustu }]
 */
export function aracCizelgesi(olaylar) {
  const ornekler = olaylar.filter((o) => o.tur === 'ornek' && o.kopru && !o.kopru.bayat).sort((a, b) => a.t - b.t);
  const araclar = new Map();
  for (const o of ornekler) {
    for (const [durak, hatlar] of Object.entries(o.kopru.duraklar ?? {})) {
      for (const [hat, l] of Object.entries(hatlar)) {
        for (const v of l) {
          const anahtar = `${durak}|${v.kapi}`;
          const a = araclar.get(anahtar) ?? { durak, hat, kapi: v.kapi, ilk: o.t, son: o.t, tahminler: [], dustu: null };
          a.son = o.t;
          a.tahminler.push({ t: o.t, varis: v.varis, kalan: v.kalan });
          araclar.set(anahtar, a);
        }
      }
    }
  }
  // Listeden düşüş: son görüldüğü örnekten sonraki ilk örnek (köprü o örnekte durağa
  // ulaşmış görüyor). Kayıt bittiyse ya da son örnekse düşmedi.
  for (const a of araclar.values()) {
    const sonraki = ornekler.find((o) => o.t > a.son);
    if (sonraki) a.dustu = sonraki.t;
  }
  return [...araclar.values()].sort((a, b) => (a.dustu ?? Infinity) - (b.dustu ?? Infinity) || a.ilk - b.ilk);
}

/** "17:34", "17:34:20" → o günün o anı (İstanbul saati, kaydın günü). */
export function saattenAn(saat, gununBirAni) {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(saat.trim());
  if (!m) return null;
  // İstanbul UTC+3, yaz saati yok.
  const gun = Math.floor((gununBirAni + 3 * 3_600_000) / 86_400_000) * 86_400_000 - 3 * 3_600_000;
  return gun + ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3] ?? 0)) * 1000;
}
