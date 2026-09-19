# Büyük bir OSM özetini (ör. Marmara) verilen dikdörtgene kırpar.
#
# Neden gerekiyor: OTP klasördeki .pbf dosyasının tamamını derler. Marmara özeti
# Bursa'yı, Edirne'yi, Çanakkale'yi de içeriyor; onları da derlemek hem yavaş hem
# gereksiz büyük bir grafik demek.
#
# Yöntem (iki geçiş, "tam yollar"):
#   1. Kutunun içindeki düğümlerin kimlikleri toplanır.
#   2. Dosya baştan okunur; kutudaki düğümler, BÜTÜN düğümleri kutuda olan yollar
#      ve tutulan bir öğeye bağlı ilişkiler yazılır.
# Kenardaki yollar kopmasın diye kutuya küçük bir taşma payı eklenir.

import faulthandler
import sys
import time

import osmium

faulthandler.enable()


def yaz(*parcalar):
    print(*parcalar, flush=True)


class DugumToplayici(osmium.SimpleHandler):
    def __init__(self, kutu):
        super().__init__()
        self.alt, self.ust, self.sol, self.sag = kutu
        self.kimlikler = set()

    def node(self, n):
        k = n.location
        if self.alt <= k.lat <= self.ust and self.sol <= k.lon <= self.sag:
            self.kimlikler.add(n.id)


class Yazici(osmium.SimpleHandler):
    def __init__(self, yazici, dugumler):
        super().__init__()
        self.yazici = yazici
        self.dugumler = dugumler
        self.yollar = set()
        self.sayac = {'dugum': 0, 'yol': 0, 'iliski': 0}
        self.gorulen = 0
        self.zaman = time.time()

    def _ilerleme(self, tur):
        self.gorulen += 1
        if self.gorulen % 2_000_000 == 0:
            yaz(f'    {self.gorulen:,} öğe okundu (son: {tur}, {time.time() - self.zaman:.0f} sn)'.replace(',', '.'))

    def node(self, n):
        self._ilerleme('düğüm')
        if n.id in self.dugumler:
            self.yazici.add_node(n)
            self.sayac['dugum'] += 1

    def way(self, w):
        self._ilerleme('yol')
        if len(w.nodes) == 0:
            return
        for d in w.nodes:
            if d.ref not in self.dugumler:
                return
        self.yazici.add_way(w)
        self.yollar.add(w.id)
        self.sayac['yol'] += 1

    def relation(self, r):
        self._ilerleme('ilişki')
        for u in r.members:
            if (u.type == 'w' and u.ref in self.yollar) or (u.type == 'n' and u.ref in self.dugumler):
                self.yazici.add_relation(r)
                self.sayac['iliski'] += 1
                return


def main():
    girdi, cikti = sys.argv[1], sys.argv[2]
    alt, ust, sol, sag = (float(x) for x in sys.argv[3:7])
    pay = 0.03  # kenardaki yolların kopmaması için taşma payı
    kutu = (alt - pay, ust + pay, sol - pay, sag + pay)
    yaz(f'kutu: enlem {kutu[0]:.3f}..{kutu[1]:.3f}  boylam {kutu[2]:.3f}..{kutu[3]:.3f}')

    t = time.time()
    toplayici = DugumToplayici(kutu)
    toplayici.apply_file(girdi)
    dugumler = toplayici.kimlikler
    yaz(f'  kutu içindeki düğüm: {len(dugumler):,}'.replace(',', '.'))
    yaz(f'  1. geçiş bitti: {time.time() - t:.0f} sn')

    t = time.time()
    yazici = osmium.SimpleWriter(cikti)
    try:
        h = Yazici(yazici, dugumler)
        h.apply_file(girdi)
    finally:
        yazici.close()
    yaz(f'  2. geçiş bitti: {time.time() - t:.0f} sn')
    yaz('yazılan:', h.sayac)


main()
