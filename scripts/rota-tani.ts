// Rota tanısı: uygulamanın yaptığı aramaları bilgisayardaki OTP'ye aynen yapar, her
// aramanın ne getirdiğini, hangi rotanın hangi süzgeçte elendiğini ve son sıralamayı
// puanlarıyla yazar. "Neden metrolu rota çıkmadı?" sorusuna telefonsuz bakmak için.
//
// Kullanım (OTP açıkken):
//   npm run rota-tani -- <nereden enlem,boylam> <nereye enlem,boylam> [tercih] [HH:MM]
//   npm run rota-tani -- 41.0405,28.8424 41.0466,29.0006
//   npm run rota-tani -- 41.0405,28.8424 41.0466,29.0006 rayli 08:30
// Tercih: dengeli (varsayılan), hizli, azYurume, azAktarma, rayli.
// OTP adresi: OTP_URL ortam değişkeni, yoksa http://localhost:8080.

import {
  aracSiniri,
  aktarmaBeklemesi,
  gereksizAktarmalariAyikla,
  oneriPuani,
  otobusSuresi,
  rayliMi,
  benzerleriAyikla,
  rotalariBirlestir,
  rotalariSirala,
  yurumeSiniri,
} from '../src/lib/rota-secimi.ts';
import { aramalariYap, ROTA_TERCIHLERI, SORGULAR, type RotaTercihi } from '../src/lib/sorgular.ts';
import { minibussuzSuzgec, trafiksizSuzgec, vasitaSuzgeci, bacakTuru } from '../src/lib/vasita.ts';

const OTP = (process.env.OTP_URL ?? 'http://localhost:8080').replace(/\/+$/, '');

type Bacak = {
  mode: string | null;
  duration: number | null;
  transitLeg: boolean | null;
  start: { scheduledTime: string };
  from: { name: string | null; stop: { gtfsId: string } | null };
  to: { name: string | null };
  route: { gtfsId: string; shortName: string | null; mode: string | null; agency: { gtfsId?: string; name: string } | null } | null;
};
type Rota = {
  start: string | null;
  end: string | null;
  duration: number | null;
  walkTime: number | null;
  numberOfTransfers: number;
  legs: Bacak[];
};

async function sorgula<T>(sorgu: string, degiskenler: Record<string, unknown>): Promise<T> {
  const yanit = await fetch(`${OTP}/otp/gtfs/v1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sorgu, variables: degiskenler }),
  });
  const govde = (await yanit.json()) as { data?: T; errors?: { message: string }[] };
  if (govde.errors?.length) console.log(`  ! OTP: ${govde.errors[0].message}`);
  if (!govde.data) throw new Error('OTP boş cevap verdi');
  return govde.data;
}

function noktaOku(metin: string | undefined, ad: string) {
  const [lat, lon] = (metin ?? '').split(',').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    console.error(`${ad} "enlem,boylam" biçiminde olmalı (ör. 41.0405,28.8424).`);
    process.exit(1);
  }
  return { label: ad, location: { coordinate: { latitude: lat, longitude: lon } } };
}

function istanbulZamani(hhmm?: string): string {
  const simdi = new Date(Date.now() + 3 * 3600_000);
  if (hhmm && /^\d{1,2}:\d{2}$/.test(hhmm)) {
    const [s, d] = hhmm.split(':').map(Number);
    simdi.setUTCHours(s, d, 0, 0);
  }
  return `${simdi.toISOString().slice(0, 19)}+03:00`;
}

const saat = (iso: string | null) => (iso ? iso.slice(11, 16) : '--:--');
const dk = (sn: number | null | undefined) => Math.round((sn ?? 0) / 60);

function ozet(g: Rota): string {
  const araclar = g.legs
    .filter((b) => b.transitLeg)
    .map((b) => {
      const tur = bacakTuru(b);
      return `${b.route?.shortName ?? b.mode}(${tur ?? '?'},${dk(b.duration)}dk)`;
    })
    .join(' > ');
  return `${saat(g.start)}-${saat(g.end)} ${dk(g.duration)}dk · yürüme ${dk(g.walkTime)} · aktarma ${g.numberOfTransfers} · ${araclar || 'yalnız yürüyüş'}`;
}

async function main() {
  const [a, b, tercihArg, saatArg] = process.argv.slice(2);
  const nereden = noktaOku(a, 'Nereden');
  const nereye = noktaOku(b, 'Nereye');
  const tercih = (ROTA_TERCIHLERI as readonly string[]).includes(tercihArg ?? '') ? (tercihArg as RotaTercihi) : 'dengeli';
  const zaman = istanbulZamani(saatArg);
  console.log(`OTP: ${OTP} · tercih: ${tercih} · kalkış: ${zaman}\n`);
  const saatNo = Number(zaman.slice(11, 13));
  if (saatNo >= 1 && saatNo < 6) {
    console.log('Not: gece 01–06 arası çoğu hat çalışmıyor; gündüz için sona saat ekle (ör. dengeli 18:00).\n');
  }

  const { routes } = await sorgula<{ routes: Rota['legs'][number]['route'][] }>(SORGULAR.HATLAR, {});
  const hatlar = routes.filter((h): h is NonNullable<typeof h> => !!h);
  const suzgecler = {
    kapali: vasitaSuzgeci([], hatlar),
    minibussuz: minibussuzSuzgec(hatlar),
    trafiksiz: trafiksizSuzgec([], hatlar),
  };
  const secenekler = { tercih, erisilebilir: false, kapali: [] };
  const aramalar = aramalariYap(secenekler, suzgecler);
  const listeler: Rota[][] = [];
  for (const [i, arama] of aramalar.entries()) {
    type Cevap = {
      planConnection: { routingErrors: { code: string; description: string }[]; edges: { node: Rota }[] | null } | null;
    };
    const cevap = await sorgula<Cevap>(SORGULAR.ROTA_PLANLA, {
      nereden,
      nereye,
      zaman: { earliestDeparture: zaman },
      tercihler: arama.tercihler,
      ...(arama.modlar ? { modlar: arama.modlar } : {}),
    });
    const liste = (cevap.planConnection?.edges ?? []).map((e) => e.node);
    const ad = i === aramalar.length - 1 && suzgecler.trafiksiz ? ' (yalnız trafiksiz türler)' : '';
    console.log(`Arama #${i + 1}${ad}: ${liste.length} rota, ${liste.filter((g) => rayliMi(g)).length} trafiksiz`);
    for (const g of liste) console.log(`   ${ozet(g)}`);
    for (const h of cevap.planConnection?.routingErrors ?? []) console.log(`   ! ${h.code}: ${h.description}`);
    listeler.push(liste);
  }

  const hepsi = rotalariBirlestir(listeler);
  const sinirli = aracSiniri(hepsi);
  const { rotalar: yurunebilir, asildi } = yurumeSiniri(sinirli);
  const rotalar = gereksizAktarmalariAyikla(yurunebilir);
  console.log(`\nBirleşik ${hepsi.length} → 3 araç sınırı ${sinirli.length} → yürüme sınırı ${yurunebilir.length}${asildi ? ' (sınır aşıldı)' : ''} → gereksiz aktarma ${rotalar.length}`);
  for (const g of hepsi.filter((x) => !rotalar.includes(x))) {
    const neden = !sinirli.includes(g) ? '3 araçtan çok' : !yurunebilir.includes(g) ? 'yürüme sınırı' : 'gereksiz aktarma';
    console.log(`   elendi (${neden}): ${ozet(g)}`);
  }

  const sirali = benzerleriAyikla(rotalariSirala(rotalar, tercih));
  if (sirali.length < rotalar.length) console.log(`\nNeredeyse aynı ${rotalar.length - sirali.length} seçenek birleşti.`);
  const enErken = Math.min(...sirali.map((g) => Date.parse(g.start ?? '')).filter((x) => !Number.isNaN(x)));
  console.log(`\nSon sıralama (${tercih}):`);
  sirali.forEach((g, i) => {
    const puan = Math.round(oneriPuani(g, enErken) / 60);
    console.log(
      `${String(i + 1).padStart(2)}. puan ${puan} · otobüs ${dk(otobusSuresi(g))}dk · aktarma beklemesi ${dk(aktarmaBeklemesi(g))}dk${rayliMi(g) ? ' · trafiksiz' : ''}\n    ${ozet(g)}`,
    );
  });
}

main().catch((e) => {
  console.error(`Hata: ${(e as Error).message}. OTP açık mı? (${OTP})`);
  process.exitCode = 1;
});
