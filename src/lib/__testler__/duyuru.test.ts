// Hat duyurularının eşleştirilmesinin testleri.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { hatlarinDuyurulari, hattinDuyurulari, type Duyuru } from '../duyuru';

const D = (hat: string, mesaj: string): Duyuru => ({ hat, tip: 'Günlük', saat: '08:00', mesaj });
const LISTE = [D('98A', 'yol çalışması'), D('M1A', 'bakım'), D('98', 'başka hat'), D('98A', 'ikinci')];

describe('hattinDuyurulari', () => {
  it('kısa adı büyük/küçük harfe bakmadan eşleştirir, benzer adları karıştırmaz', () => {
    assert.deepEqual(hattinDuyurulari(LISTE, '98a').map((d) => d.mesaj), ['yol çalışması', 'ikinci']);
    assert.deepEqual(hattinDuyurulari(LISTE, 'm1a').map((d) => d.mesaj), ['bakım']);
    assert.deepEqual(hattinDuyurulari(LISTE, null), []);
  });
});

describe('hatlarinDuyurulari', () => {
  it('hat sırasını korur, aynı hattı iki kez eklemez', () => {
    assert.deepEqual(
      hatlarinDuyurulari(LISTE, ['M1A', '98A', '98A', undefined]).map((d) => d.mesaj),
      ['bakım', 'yol çalışması', 'ikinci'],
    );
  });
});
