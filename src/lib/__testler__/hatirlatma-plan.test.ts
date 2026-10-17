// Hatırlatıcı planının testleri.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { hatirlatmaPlani, varsayilanSecim, VARSAYILAN_AYAR } from '../hatirlatma-plan.ts';

// 18 Ekim 2026, İstanbul saati.
const t = (s: string) => `2026-10-18T${s}:00+03:00`;
const z = (s: string, canli = false) => ({ scheduledTime: t(s), estimated: canli ? { time: t(s) } : null });
const yuru = (bas: string, bit: string, metre: number) => ({
  transitLeg: false, mode: 'WALK', duration: (Date.parse(t(bit)) - Date.parse(t(bas))) / 1000, distance: metre,
  start: z(bas), end: z(bit), from: { name: null }, to: { name: null }, route: null,
});
const arac = (hat: string, mode: string, nereden: string, nereye: string, bas: string, bit: string, canli = false, isletmeci = 'İETT') => ({
  transitLeg: true, mode, duration: null, distance: null, start: z(bas, canli), end: z(bit, canli),
  from: { name: nereden }, to: { name: nereye }, route: { shortName: hat, mode, agency: { name: isletmeci } },
});

const BACAKLAR = [
  yuru('00:23', '00:24', 90),
  arac('97M', 'BUS', 'GÖZTEPE MEYDANI', 'MAHMUTBEY', '00:24', '00:39', true),
  yuru('00:39', '00:41', 90),
  arac('M4', 'SUBWAY', 'Mahmutbey', 'Kadıköy', '00:45', '01:20', false, 'Metro İstanbul'),
  yuru('01:20', '01:35', 1100),
];

describe('hatirlatmaPlani', () => {
  const plan = hatirlatmaPlani(BACAKLAR, Date.parse(t('00:23')), VARSAYILAN_AYAR, { 1: ['97GE'] });

  it('çıkış, yaklaşma, aktarma ve iniş; saate göre sıralı', () => {
    assert.deepEqual(
      plan.map((p) => [p.anahtar, new Date(p.zaman).toISOString().slice(11, 16)]),
      [
        ['kalkis-0', '21:13'],
        ['yaklasma-1', '21:20'],
        ['aktarma-1', '21:37'],
        ['inis-3', '22:18'],
      ],
    );
  });

  it('metinler hat, durak ve saatle', () => {
    const [kalkis, yaklasma, aktarma, inis] = plan;
    assert.equal(kalkis.baslik, '10 dk sonra yola çık');
    assert.equal(kalkis.metin, "97M ya da 97GE Göztepe Meydanı durağından 00:24'te kalkıyor (canlı). Durağa 1 dk yürüme.");
    assert.equal(yaklasma.baslik, '97M ya da 97GE yaklaşıyor');
    assert.equal(aktarma.metin, "97M ile Mahmutbey durağında in, 90 m yürü, M4 hattına bin (00:45'te).");
    assert.equal(inis.metin, '2 dk sonra Kadıköy istasyonunda in. Varışa 15 dk yürüme kaldı.');
    assert.equal(inis.canli, false);
  });

  it('çıkış anında seçilince başlık değişir; iniş varsayılan kapalı', () => {
    const p = hatirlatmaPlani(BACAKLAR, Date.parse(t('00:23')), { ...VARSAYILAN_AYAR, once: 0 });
    assert.equal(p.find((x) => x.tur === 'kalkis')?.baslik, 'Yola çıkma vakti');
    assert.deepEqual([...varsayilanSecim(p, VARSAYILAN_AYAR)].sort(), ['aktarma-1', 'kalkis-0', 'yaklasma-1']);
  });

  it('ilk araç raylıysa yaklaşma bildirimi yok', () => {
    const p = hatirlatmaPlani(BACAKLAR.slice(3), Date.parse(t('00:40')), VARSAYILAN_AYAR);
    assert.deepEqual(p.map((x) => x.tur), ['kalkis', 'inis']);
  });
});
