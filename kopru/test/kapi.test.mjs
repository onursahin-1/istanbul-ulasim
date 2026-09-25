import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { SaatlikButce } from '../butce.mjs';
import { ArizaHatasi, Kapi } from '../iett.mjs';

const asilFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = asilFetch;
});

/** Sırayla verilen yanıtları döndüren sahte fetch; kaç kez çağrıldığını sayar. */
function sahteFetch(yanitlar) {
  const f = async () => {
    f.cagri++;
    const y = yanitlar.shift();
    if (y instanceof Error) throw y;
    return { status: y.status, text: async () => y.govde ?? '' };
  };
  f.cagri = 0;
  return f;
}
const basarili = { status: 200, govde: '<GetXResult>[1,2]</GetXResult>' };
const kapiYap = () => new Kapi({ butce: new SaatlikButce({ saatte: 1000, enAzAralikMs: 0 }) });

describe('Kapi arıza geri çekilmesi', () => {
  it('HTTP 503 sonrası istek göndermeden hata verir, bütçe harcanmaz', async () => {
    globalThis.fetch = sahteFetch([{ status: 503 }, basarili]);
    const kapi = kapiYap();
    await assert.rejects(kapi.cagir('http://x', 'GetX'), ArizaHatasi);
    const once = kapi.butce.kullanilan();
    await assert.rejects(kapi.cagir('http://x', 'GetX'), (e) => e instanceof ArizaHatasi && /HTTP 503/.test(e.message));
    assert.equal(globalThis.fetch.cagri, 1, 'ikinci istek gönderilmemeli');
    assert.equal(kapi.butce.kullanilan(), once);
    assert.ok(kapi.kalanAriza() > 60_000);
  });

  it('bağlantı hatası da arıza sayılır; bekleme katlanır, başarı sıfırlar', async () => {
    globalThis.fetch = sahteFetch([new TypeError('fetch failed'), { status: 503 }, basarili]);
    const kapi = kapiYap();
    await assert.rejects(kapi.cagir('http://x', 'GetX'), /bağlantı kurulamadı/);
    assert.ok(kapi.kalanAriza() <= 2 * 60_000);
    kapi.arizaBitis = 0; // bekleme bitmiş gibi
    await assert.rejects(kapi.cagir('http://x', 'GetX'), ArizaHatasi);
    assert.ok(kapi.kalanAriza() > 2 * 60_000, 'ikinci arızada 4 dk');
    kapi.arizaBitis = 0;
    assert.deepEqual(await kapi.cagir('http://x', 'GetX'), [1, 2]);
    assert.equal(kapi.arizaAdimi, 2 * 60_000);
  });

  it('4xx arıza sayılmaz', async () => {
    globalThis.fetch = sahteFetch([{ status: 404 }]);
    const kapi = kapiYap();
    await assert.rejects(kapi.cagir('http://x', 'GetX'), (e) => !(e instanceof ArizaHatasi) && /HTTP 404/.test(e.message));
    assert.equal(kapi.kalanAriza(), 0);
  });
});
