// 2 · Rota sonuçları: nereden–nereye, sıralama seçenekleri ve güzergâh kartları.

import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  BacakZinciri,
  canliRenk,
  CevrimdisiSerit,
  GeriCubugu,
  HataKutusu,
  Ikon,
  NabizNoktasi,
  SureSeridi,
  useStiller,
  Yukleniyor,
  type IkonAdi,
} from '@/components/ulasim';
import { bacakCanli } from '@/lib/canli';
import { OtpHatasi, rotaPlanlaYedekli, type Guzergah, type Konum, type RotaTercihi } from '@/lib/otp';
import { rotaSecenekleriKaydet, useKayitlar } from '@/lib/kayitlar';
import { guzergahlariSakla } from '@/lib/secim';
import { ucretKisa, yolculukUcreti } from '@/lib/ucret';
import { baslikYap, hatEtiketi, useTema, type Tema } from '@/lib/tema';
import {
  gunEtiketi,
  gunTarihi,
  isoDakikaSonra,
  istanbulSaat,
  istanbulSimdi,
  istanbulZamanYap,
  saatDakikaYaz,
  saatYaz,
  sureYaz,
} from '@/lib/zaman';

type Parametreler = { kLat: string; kLon: string; kAd: string; vLat: string; vLon: string; vAd: string };
type Sirali = { g: Guzergah; sira: number };
type Grup = { ana: Sirali; sonrakiler: Sirali[] };

const SONRAKI_SAYISI = 3;

/** Zaman seçiminde kaç gün ileri gidilebilir (bugün dahil). */
const GUN_SAYISI = 7;
const DAKIKALAR = [0, 15, 30, 45];

/** Rota motoruna gönderilen arama tercihleri. */
const TERCIHLER: { anahtar: RotaTercihi; ad: string; kisa: string; aciklama: string; simge: IkonAdi }[] = [
  {
    anahtar: 'dengeli',
    ad: 'En hızlı',
    kisa: 'En hızlı',
    aciklama: 'Süre, yürüme ve aktarma arasında motorun kendi dengesi. Liste süreye göre sıralanır.',
    simge: 'flash-outline',
  },
  {
    anahtar: 'azYurume',
    ad: 'Az yürüyeyim',
    kisa: 'Az yürüme',
    aciklama: 'Yürüme rota motorunda daha maliyetli sayılır ve liste yürüme süresine göre sıralanır.',
    simge: 'walk-outline',
  },
  {
    anahtar: 'azAktarma',
    ad: 'Az aktarma yapayım',
    kisa: 'Az aktarma',
    aciklama: 'Her aktarma 20 dakikalık ceza sayılır ve liste aktarma sayısına göre sıralanır.',
    simge: 'git-compare-outline',
  },
];

/**
 * Kullanıcının seçtiği zaman. null ise "şimdi yola çıkıyorum".
 * tur 'varis' ise saat, hedefte en geç olunması gereken an ("9:00'da orada olmalıyım").
 */
type ZamanTuru = 'kalkis' | 'varis';
type ZamanSecimi = { tur: ZamanTuru; gun: number; saat: number; dakika: number } | null;

/**
 * Aynı hatları aynı sırayla ve aynı duraklardan binerek kullanan güzergâhlar "aynı rota" sayılır.
 * Yalnızca yürüyüşten oluşan güzergâhlar kendi başına kalır.
 */
function rotaAnahtari(g: Guzergah): string {
  const araclar = g.legs.filter((b) => b.transitLeg);
  if (!araclar.length) return `yuru-${g.start}`;
  return araclar.map((b) => `${b.route?.gtfsId ?? b.route?.shortName}@${b.from.stop?.gtfsId ?? b.from.name}`).join('|');
}

function binisSaati(g: Guzergah): string | null {
  const ilk = g.legs.find((b) => b.transitLeg);
  return ilk ? (ilk.start.estimated?.time ?? ilk.start.scheduledTime) : g.start;
}

function gruplandir(guzergahlar: Guzergah[]): Grup[] {
  const gruplar = new Map<string, Sirali[]>();
  guzergahlar.forEach((g, sira) => {
    const anahtar = rotaAnahtari(g);
    gruplar.set(anahtar, [...(gruplar.get(anahtar) ?? []), { g, sira }]);
  });
  return [...gruplar.values()].map((liste) => {
    const siralanmis = [...liste].sort((a, b) => Date.parse(a.g.start ?? '') - Date.parse(b.g.start ?? ''));
    return { ana: siralanmis[0], sonrakiler: siralanmis.slice(1, 1 + SONRAKI_SAYISI) };
  });
}



// Rota motorunun İngilizce hata kodları için Türkçe açıklamalar.
const HATA_METINLERI: Record<string, string> = {
  NO_TRANSIT_CONNECTION: 'Bu iki nokta arasında toplu taşıma bağlantısı bulunamadı.',
  NO_TRANSIT_CONNECTION_IN_SEARCH_WINDOW: 'Seçilen saatte uygun sefer yok. Biraz sonra tekrar dene.',
  OUTSIDE_SERVICE_PERIOD: 'Seçilen tarih, sefer tarifesinin kapsamı dışında.',
  OUTSIDE_BOUNDS: 'Seçilen nokta haritanın kapsamı dışında.',
  LOCATION_NOT_FOUND: 'Başlangıç ya da varış noktası yol ağına bağlanamadı. Yakındaki bir durağı seçmeyi dene.',
  NO_STOPS_IN_RANGE: 'Yürüme mesafesinde durak bulunamadı.',
  WALKING_BETTER_THAN_TRANSIT: 'Bu mesafe için yürümek toplu taşımadan daha hızlı.',
};

export default function RotaEkrani() {
  const kenar = useSafeAreaInsets();
  const tema = useTema();
  const s = useStiller(stiller);
  const p = useLocalSearchParams<Parametreler>();
  const [guzergahlar, setGuzergahlar] = useState<Guzergah[] | null>(null);
  const [bilgi, setBilgi] = useState<string | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [cevrimdisi, setCevrimdisi] = useState<number | null>(null);
  const [aramaSaati, setAramaSaati] = useState(istanbulSaat());
  const [zaman, setZaman] = useState<ZamanSecimi>(null);
  const [zamanAcik, setZamanAcik] = useState(false);
  const [taslak, setTaslak] = useState<{ tur: ZamanTuru; gun: number; saat: number; dakika: number }>({
    tur: 'kalkis',
    gun: 0,
    saat: 8,
    dakika: 0,
  });

  const { ucretTuru, rotaSecenekleri: kayitliSecenekler, yuklendi } = useKayitlar();
  // Kayıtlar her okunuşta yeni bir nesne geliyor (bir favori eklenince bile); aramayı
  // yalnız tercihin kendisi değişince yenile. Eskiden ekran her açılışta iki kez arıyordu:
  // önce varsayılanla, kayıt okununca bir daha.
  const { tercih, erisilebilir } = kayitliSecenekler;
  const rotaSecenekleri = useMemo(() => ({ tercih, erisilebilir }), [tercih, erisilebilir]);
  const [tercihAcik, setTercihAcik] = useState(false);
  const nereden: Konum = useMemo(() => ({ ad: p.kAd ?? 'Konumum', lat: Number(p.kLat), lon: Number(p.kLon) }), [p.kAd, p.kLat, p.kLon]);
  const nereye: Konum = useMemo(() => ({ ad: p.vAd ?? 'Hedef', lat: Number(p.vLat), lon: Number(p.vLon) }), [p.vAd, p.vLat, p.vLon]);

  // Yalnız en son aramanın sonucu ekrana yazılır. Konum ilk açılışta bir kez daha
  // inceldiğinde arama yeniden başlıyor; öncekinin geç gelen hatası yenisinin
  // sonuçlarının üstüne kırmızı kutu olarak düşüyordu.
  const sonArama = useRef(0);

  const ara = useCallback(
    async (sinyal?: AbortSignal) => {
      const no = ++sonArama.current;
      const eski = () => no !== sonArama.current || !!sinyal?.aborted;
      if ([nereden.lat, nereden.lon, nereye.lat, nereye.lon].some((d) => !Number.isFinite(d))) {
        setHata('Başlangıç ya da varış noktası eksik. Geri dönüp tekrar seç.');
        return;
      }
      setGuzergahlar(null);
      setHata(null);
      setBilgi(null);
      setCevrimdisi(null);
      setAramaSaati(istanbulSaat());
      try {
        const aramaZamani = zaman
          ? { tur: zaman.tur, an: istanbulZamanYap(zaman.gun, zaman.saat, zaman.dakika) }
          : { tur: 'kalkis' as const, an: istanbulSimdi() };
        const sonuc = await rotaPlanlaYedekli(nereden, nereye, aramaZamani, rotaSecenekleri, sinyal);
        if (eski()) return;
        setGuzergahlar(sonuc.guzergahlar);
        setCevrimdisi(sonuc.cevrimdisi);
        if (sonuc.guzergahlar.length === 0) {
          const kod = sonuc.hatalar[0]?.code;
          const temel = (kod && HATA_METINLERI[kod]) ?? 'Bu saatte uygun bir rota bulunamadı.';
          // Tercihler sonucu daraltmış olabilir; kullanıcı neyi gevşetebileceğini bilsin.
          const ipucu = rotaSecenekleri.erisilebilir
            ? ' Basamaksız güzergâh açık; kapatırsan daha çok seçenek çıkabilir.'
            : rotaSecenekleri.tercih !== 'dengeli'
              ? ' Rota tercihini "Dengeli"ye almayı deneyebilirsin.'
              : '';
          setBilgi(temel + ipucu);
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError' || eski()) return;
        setHata(e instanceof OtpHatasi ? e.message : 'Rota aranırken beklenmeyen bir sorun oluştu.');
      }
    },
    [nereden, nereye, zaman, rotaSecenekleri],
  );

  useEffect(() => {
    if (!yuklendi) return;
    const iptal = new AbortController();
    ara(iptal.signal);
    return () => iptal.abort();
  }, [ara, yuklendi]);

  const gruplar = useMemo(() => {
    if (!guzergahlar) return [];
    const liste = gruplandir(guzergahlar);
    const sure = (x: Grup) => x.ana.g.duration ?? Infinity;
    const erken = (x: Grup) => Date.parse(x.ana.g.start ?? '') || 0;
    // Sıralama ayrı bir seçim değil: seçilen tercihin karşılığı. "Az yürüme" diyen biri
    // listenin de yürümeye göre sıralanmasını bekler.
    const tercih = rotaSecenekleri.tercih;
    if (tercih === 'azAktarma') liste.sort((a, b) => a.ana.g.numberOfTransfers - b.ana.g.numberOfTransfers || sure(a) - sure(b));
    else if (tercih === 'azYurume') liste.sort((a, b) => (a.ana.g.walkTime ?? 0) - (b.ana.g.walkTime ?? 0) || sure(a) - sure(b));
    else liste.sort((a, b) => sure(a) - sure(b) || erken(a) - erken(b));
    return liste;
  }, [guzergahlar, rotaSecenekleri.tercih]);

  const enHizli = useMemo(() => Math.min(...(guzergahlar ?? []).map((g) => g.duration ?? Infinity)), [guzergahlar]);

  /** Başlangıç ya da varış alanına dokununca arama ekranı açılır; seçim buraya geri döner. */
  const yerSec = (alan: 'baslangic' | 'varis') =>
    router.push({
      pathname: '/ara',
      params: {
        alan,
        kLat: p.kLat ?? '',
        kLon: p.kLon ?? '',
        kAd: p.kAd ?? '',
        vLat: p.vLat ?? '',
        vLon: p.vLon ?? '',
        vAd: p.vAd ?? '',
      },
    });

  const yerDegistir = () =>
    router.setParams({ kLat: p.vLat, kLon: p.vLon, kAd: p.vAd, vLat: p.kLat, vLon: p.kLon, vAd: p.kAd });

  // Ücret hesabı bacak dizisine bakıyor; kart başına bir kez hesaplanıp saklanıyor.
  const ucretler = useMemo(() => {
    const tablo: Record<number, string> = {};
    for (const { ana, sonrakiler } of gruplar) {
      for (const { g, sira } of [ana, ...sonrakiler]) {
        tablo[sira] = ucretKisa(yolculukUcreti(g.legs, ucretTuru));
      }
    }
    return tablo;
  }, [gruplar, ucretTuru]);

  const detayaGit = (sira: number) => {
    if (!guzergahlar) return;
    guzergahlariSakla(guzergahlar);
    router.push({ pathname: '/rota-detay', params: { sira: String(sira), hedef: nereye.ad } });
  };

  return (
    <View style={s.kok}>
      <View style={[s.ust, { paddingTop: kenar.top + 4 }]}>
        <GeriCubugu baslik="Rota seçenekleri" />
        <View style={s.nerede}>
          <View style={s.noktalar}>
            <View style={s.baslangicNokta} />
            <View style={s.kesik} />
            <View style={s.bitisNokta} />
          </View>
          <View style={{ flex: 1, gap: 6 }}>
            <Pressable onPress={() => yerSec('baslangic')} accessibilityRole="button" accessibilityLabel="Başlangıcı değiştir">
              <Text style={s.alan} numberOfLines={1}>
                {baslikYap(nereden.ad)}
              </Text>
            </Pressable>
            <Pressable onPress={() => yerSec('varis')} accessibilityRole="button" accessibilityLabel="Varışı değiştir">
              <Text style={s.alan} numberOfLines={1}>
                {baslikYap(nereye.ad)}
              </Text>
            </Pressable>
          </View>
          <Pressable style={s.degistir} onPress={yerDegistir} accessibilityLabel="Başlangıç ve varışı değiştir">
            <Ikon ad="swap-vertical" boyut={18} renkKodu={tema.soluk} />
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filtreler}>
          <Pressable
            style={[s.filtre, s.filtreKoyu]}
            onPress={() => {
              setTaslak(zaman ?? { tur: 'kalkis', gun: 0, saat: Number(istanbulSaat().slice(0, 2)), dakika: 0 });
              setZamanAcik(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Kalkış ya da varış zamanını seç"
          >
            <Text style={[s.filtreYazi, { color: tema.zemin }]}>
              {zaman
                ? `${gunEtiketi(zaman.gun, true)} · ${zaman.tur === 'varis' ? 'varış ' : ''}${saatDakikaYaz(zaman.saat, zaman.dakika)}`
                : `Şimdi · ${aramaSaati}`}
            </Text>
          </Pressable>
          <Pressable
            style={[s.filtre, s.filtreSecili]}
            onPress={() => setTercihAcik(true)}
            accessibilityRole="button"
            accessibilityLabel="Rota tercihlerini değiştir"
          >
            <Text style={[s.filtreYazi, { color: tema.vurgu }]}>{tercihEtiketi(rotaSecenekleri)}</Text>
          </Pressable>
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={[s.sonuclar, { paddingBottom: kenar.bottom + 20 }]}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => ara()} tintColor={tema.vurgu} />}
      >
        {cevrimdisi != null && <CevrimdisiSerit zaman={cevrimdisi} tekrarDene={() => ara()} />}
        {hata && <HataKutusu mesaj={hata} tekrarDene={() => ara()} />}
        {!hata && !guzergahlar && <Yukleniyor metin="En uygun rotalar hesaplanıyor…" />}
        {bilgi && <Text style={s.bilgi}>{bilgi}</Text>}
        {gruplar.map(({ ana: { g, sira }, sonrakiler }, i) => {
          const ilkArac = g.legs.find((b) => b.transitLeg);
          const oneri = i === 0 && rotaSecenekleri.tercih === 'dengeli' && g.duration === enHizli;
          return (
            <Pressable key={sira} style={[s.kart, oneri && s.kartOneri]} onPress={() => detayaGit(sira)}>
              <View style={s.kartUst}>
                <Text style={s.sure}>{sureYaz(g.duration)}</Text>
                {oneri ? <Text style={s.etiket}>ÖNERİLEN</Text> : <Text style={s.saat}>{`${saatYaz(g.start)}–${saatYaz(g.end)}`}</Text>}
              </View>
              <BacakZinciri bacaklar={g.legs} />
              <SureSeridi bacaklar={g.legs} />
              <View style={s.kartAlt}>
                {oneri && <Text style={[s.altYazi, s.kalin]}>{`${saatYaz(g.start)}–${saatYaz(g.end)}`}</Text>}
                <Text style={s.altYazi}>{sureYaz(g.walkTime)} yürüme</Text>
                <Text style={s.altYazi}>{g.numberOfTransfers === 0 ? 'Aktarmasız' : `${g.numberOfTransfers} aktarma`}</Text>
                {ucretler[sira] && <Text style={[s.altYazi, s.ucret]}>{ucretler[sira]}</Text>}
              </View>
              {ilkArac &&
                (() => {
                  const canli = bacakCanli(ilkArac.start.scheduledTime, ilkArac.start.estimated?.time);
                  const saat = saatYaz(ilkArac.start.estimated?.time ?? ilkArac.start.scheduledTime);
                  const bas = `${hatYazisi(ilkArac)} · ${baslikYap(ilkArac.from.name)} durağından `;
                  if (!canli) return <Text style={s.ilkArac}>{`${bas}${saat}`}</Text>;
                  const renk = canliRenk(canli.sinif, tema);
                  // İlk bacak canlıyken sonraki araçların hangisinin tahmin olduğunu söyle.
                  const tarifeli = g.legs.filter((b) => b.transitLeg && b !== ilkArac && !b.start.estimated);
                  return (
                    <View style={s.canliBlok}>
                      <View style={s.canliSatir}>
                        <NabizNoktasi renk={renk} />
                        <Text style={[s.ilkArac, s.esnek]} numberOfLines={2}>
                          {bas}
                          <Text style={{ color: renk, fontWeight: '700' }}>{`${saat} · ${canli.metin}`}</Text>
                        </Text>
                      </View>
                      {tarifeli.length > 0 && (
                        <Text style={s.tarifeNotu} numberOfLines={1}>
                          {`${[...new Set(tarifeli.map((b) => hatEtiketi(b.route?.shortName, b.route?.mode ?? b.mode, b.route?.agency?.name).rozet))].join(', ')} aktarması tarifeye göre`}
                        </Text>
                      )}
                    </View>
                  );
                })()}
              {sonrakiler.length > 0 && (
                <View style={s.sonraki}>
                  <Text style={s.sonrakiBaslik}>{ilkArac ? 'AYNI ROTADA SONRAKİ KALKIŞLAR' : 'SONRAKİ SEÇENEKLER'}</Text>
                  <View style={s.hapiSatiri}>
                    {sonrakiler.map((x) => {
                      const saat = binisSaati(x.g);
                      const dakika = isoDakikaSonra(saat);
                      return (
                        <Pressable
                          key={x.sira}
                          style={s.hap}
                          onPress={() => detayaGit(x.sira)}
                          accessibilityRole="button"
                          accessibilityLabel={`${saatYaz(saat)} kalkışının detayını aç`}
                        >
                          <Text style={s.hapSaat}>{saatYaz(saat)}</Text>
                          {dakika != null && dakika > 0 && <Text style={s.hapDakika}>{sureYaz(dakika * 60)}</Text>}
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              )}
            </Pressable>
          );
        })}
        {guzergahlar && guzergahlar.length > 0 && (
          <Text style={s.not}>
            Otobüs, Metrobüs, minibüs, metro, Marmaray, tramvay, füniküler ve vapur dahildir. Raylı sistem ve vapur
            saatleri İBB'nin eski verisinden geldiği için yaklaşıktır.
          </Text>
        )}
      </ScrollView>

      {/* Zaman seçimi: gece metrosu gibi ileri saatler ya da "şu saatte orada olmalıyım". */}
      <Modal visible={zamanAcik} transparent animationType="slide" onRequestClose={() => setZamanAcik(false)}>
        <Pressable style={s.perde} onPress={() => setZamanAcik(false)} accessibilityLabel="Kapat" />
        <View style={[s.zamanSayfa, { paddingBottom: kenar.bottom + 16 }]}>
          <View style={s.zamanTutamac} />
          <Text style={s.zamanBaslik}>
            {taslak.tur === 'varis' ? 'Ne zaman orada olmalısın?' : 'Ne zaman yola çıkıyorsun?'}
          </Text>

          <View style={s.turSecici} accessibilityRole="tablist">
            {(
              [
                ['kalkis', 'Çıkış saati'],
                ['varis', 'Varış saati'],
              ] as const
            ).map(([tur, etiket]) => (
              <Pressable
                key={tur}
                style={[s.turDugme, taslak.tur === tur && s.turSecili]}
                onPress={() => setTaslak((t) => ({ ...t, tur }))}
                accessibilityRole="tab"
                accessibilityState={{ selected: taslak.tur === tur }}
              >
                <Text style={[s.turYazi, taslak.tur === tur && { color: tema.yazi }]}>{etiket}</Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            style={[s.simdiDugme, !zaman && s.simdiSecili]}
            onPress={() => {
              setZaman(null);
              setZamanAcik(false);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: !zaman }}
          >
            <Ikon ad="flash" boyut={16} renkKodu={!zaman ? tema.vurgu : tema.soluk} />
            <Text style={[s.simdiYazi, !zaman && { color: tema.vurgu }]}>Şimdi</Text>
          </Pressable>

          <Text style={s.zamanAltBaslik}>GÜN</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.zamanSatiri}>
            {Array.from({ length: GUN_SAYISI }, (_, g) => (
              <Pressable
                key={g}
                style={[s.zamanHap, taslak.gun === g && s.zamanHapSecili]}
                onPress={() => setTaslak((t) => ({ ...t, gun: g }))}
                accessibilityState={{ selected: taslak.gun === g }}
              >
                <Text style={[s.zamanHapYazi, taslak.gun === g && { color: tema.vurgu }]}>{gunEtiketi(g, true)}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <Text style={s.zamanAltBaslik}>SAAT</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.zamanSatiri}>
            {Array.from({ length: 24 }, (_, h) => (
              <Pressable
                key={h}
                style={[s.zamanHap, taslak.saat === h && s.zamanHapSecili]}
                onPress={() => setTaslak((t) => ({ ...t, saat: h }))}
                accessibilityState={{ selected: taslak.saat === h }}
              >
                <Text style={[s.zamanHapYazi, taslak.saat === h && { color: tema.vurgu }]}>
                  {String(h).padStart(2, '0')}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <Text style={s.zamanAltBaslik}>DAKİKA</Text>
          <View style={s.zamanSatiri}>
            {DAKIKALAR.map((d) => (
              <Pressable
                key={d}
                style={[s.zamanHap, taslak.dakika === d && s.zamanHapSecili]}
                onPress={() => setTaslak((t) => ({ ...t, dakika: d }))}
                accessibilityState={{ selected: taslak.dakika === d }}
              >
                <Text style={[s.zamanHapYazi, taslak.dakika === d && { color: tema.vurgu }]}>
                  {String(d).padStart(2, '0')}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={s.zamanOzet}>
            {`${gunTarihi(taslak.gun)}, ${saatDakikaYaz(taslak.saat, taslak.dakika)}`}
            {taslak.tur === 'varis' ? ' · en geç bu saatte varan rotalar' : ''}
            {taslak.saat < 5 ? '  ·  gece metrosu Cuma ve Cumartesi gecelerinde çalışır' : ''}
          </Text>

          <Pressable style={s.zamanOnayla} onPress={() => { setZaman(taslak); setZamanAcik(false); }} accessibilityRole="button">
            <Text style={s.zamanOnaylaYazi}>{taslak.tur === 'varis' ? 'Bu saatte varacak şekilde ara' : 'Bu saate göre ara'}</Text>
          </Pressable>
        </View>
      </Modal>

      <Modal visible={tercihAcik} transparent animationType="slide" onRequestClose={() => setTercihAcik(false)}>
        <Pressable style={s.perde} onPress={() => setTercihAcik(false)} accessibilityLabel="Kapat" />
        <View style={[s.zamanSayfa, { paddingBottom: kenar.bottom + 16 }]}>
          <View style={s.zamanTutamac} />
          <Text style={s.zamanBaslik}>Rota tercihleri</Text>

          <Text style={s.zamanAltBaslik}>NEYE GÖRE ARANSIN</Text>
          <View style={s.tercihListesi}>
            {TERCIHLER.map((x) => {
              const secili = rotaSecenekleri.tercih === x.anahtar;
              return (
                <Pressable
                  key={x.anahtar}
                  style={[s.tercihSatiri, secili && s.tercihSecili]}
                  onPress={() => rotaSecenekleriKaydet({ ...rotaSecenekleri, tercih: x.anahtar })}
                  accessibilityRole="button"
                  accessibilityState={{ selected: secili }}
                >
                  <Ikon ad={x.simge} boyut={19} renkKodu={secili ? tema.vurgu : tema.soluk} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.tercihBaslik, secili && { color: tema.vurgu }]}>{x.ad}</Text>
                    <Text style={s.tercihAlt}>{x.aciklama}</Text>
                  </View>
                  {secili && <Ikon ad="checkmark" boyut={18} renkKodu={tema.vurgu} />}
                </Pressable>
              );
            })}
          </View>

          <Text style={s.zamanAltBaslik}>ERİŞİLEBİLİRLİK</Text>
          <View style={s.tercihAnahtari}>
            <View style={{ flex: 1 }}>
              <Text style={s.tercihBaslik}>Basamaksız güzergâh</Text>
              <Text style={s.tercihAlt}>
                Asansörü ya da rampası olmayan duraklardan ve erişilemeyen seferlerden kaçınılır. Veride bu bilgi
                eksik olan duraklar tamamen elenmez, düşük öncelikli sayılır.
              </Text>
            </View>
            <Switch
              value={rotaSecenekleri.erisilebilir}
              onValueChange={(v) => rotaSecenekleriKaydet({ ...rotaSecenekleri, erisilebilir: v })}
              trackColor={{ true: tema.vurgu }}
            />
          </View>

          <Pressable style={s.zamanOnayla} onPress={() => setTercihAcik(false)} accessibilityRole="button">
            <Text style={s.zamanOnaylaYazi}>Bu tercihlerle ara</Text>
          </Pressable>
        </View>
      </Modal>

    </View>
  );
}

/**
 * Kart altındaki "hangi araç" satırı.
 * Minibüs ve dolmuşta kısa ad güzergâhın tamamı olduğu için rozet araç tipini yazıyor;
 * burada güzergâhı da ekliyoruz, yoksa hangi minibüs olduğu anlaşılmıyor.
 */
function hatYazisi(bacak: Guzergah['legs'][number]): string {
  const e = hatEtiketi(bacak.route?.shortName, bacak.route?.mode ?? bacak.mode, bacak.route?.agency?.name);
  return [e.rozet, e.ayrinti].filter(Boolean).join(' · ');
}

/** Tercih hapındaki etiket: seçili tercih ne ise onu yazar. */
function tercihEtiketi(secenekler: { tercih: RotaTercihi; erisilebilir: boolean }): string {
  const ad = TERCIHLER.find((x) => x.anahtar === secenekler.tercih)?.kisa ?? 'En hızlı';
  return secenekler.erisilebilir ? `${ad} · basamaksız` : ad;
}

const stiller = (t: Tema) =>
  StyleSheet.create({
  kok: { flex: 1, backgroundColor: t.zemin },
  ust: { backgroundColor: t.yuzey, paddingHorizontal: 14, paddingBottom: 12, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.cizgi },
  nerede: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  noktalar: { width: 18, alignItems: 'center', gap: 3 },
  baslangicNokta: { width: 11, height: 11, borderRadius: 6, borderWidth: 3, borderColor: t.vurgu },
  kesik: { width: 2, height: 18, backgroundColor: t.cizgi },
  bitisNokta: { width: 10, height: 10, borderRadius: 3, backgroundColor: t.yazi },
  alan: { backgroundColor: t.zemin, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontWeight: '600', fontSize: 14, color: t.yazi },
  degistir: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: t.cizgi, alignItems: 'center', justifyContent: 'center' },
  tercihListesi: { gap: 7 },
  tercihSatiri: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 12,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.cizgi,
    backgroundColor: t.zemin,
  },
  tercihSecili: { borderColor: t.vurgu, backgroundColor: t.vurguAcik },
  tercihBaslik: { fontSize: 14.5, fontWeight: '700', color: t.yazi },
  tercihAlt: { fontSize: 12, color: t.soluk, lineHeight: 17, marginTop: 2 },
  tercihAnahtari: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingRight: 2 },
  filtreler: { gap: 6, paddingRight: 14 },
  filtre: { borderWidth: 1, borderColor: t.cizgi, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  filtreKoyu: { backgroundColor: t.yazi, borderColor: t.yazi },
  filtreSecili: { borderColor: t.vurgu, backgroundColor: t.vurguAcik },
  filtreYazi: { fontSize: 12.5, fontWeight: '600', color: t.soluk },
  sonuclar: { padding: 12, gap: 10 },
  bilgi: { color: t.soluk, textAlign: 'center', padding: 20, lineHeight: 20 },
  kart: { backgroundColor: t.yuzey, borderRadius: 16, padding: 14, gap: 10, borderWidth: 1, borderColor: t.cizgi },
  kartOneri: { borderColor: t.vurgu, borderWidth: 2 },
  kartUst: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  sure: { fontSize: 24, fontWeight: '800', color: t.yazi, letterSpacing: -0.5 },
  saat: { fontSize: 13.5, fontWeight: '600', color: t.soluk, fontVariant: ['tabular-nums'] },
  etiket: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, color: t.vurgu, backgroundColor: t.vurguAcik, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, overflow: 'hidden' },
  kartAlt: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  altYazi: { fontSize: 12.5, color: t.soluk, fontVariant: ['tabular-nums'] },
  kalin: { color: t.yazi, fontWeight: '700' },
  ucret: { color: t.vurgu, fontWeight: '700' },
  ilkArac: { fontSize: 12.5, color: t.yazi, fontWeight: '600' },
  canliBlok: { gap: 3 },
  canliSatir: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: -3 },
  esnek: { flex: 1, minWidth: 0 },
  tarifeNotu: { fontSize: 11.5, color: t.soluk, paddingLeft: 16 },
  not: { fontSize: 12, color: t.soluk, textAlign: 'center', paddingTop: 6 },
  sonraki: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.cizgi, paddingTop: 10, gap: 7 },
  sonrakiBaslik: { fontSize: 11, letterSpacing: 0.6, color: t.soluk, fontWeight: '700' },
  hapiSatiri: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  hap: { flexDirection: 'row', alignItems: 'baseline', gap: 4, borderWidth: 1, borderColor: t.cizgi, backgroundColor: t.zemin, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
  hapSaat: { fontSize: 13, fontWeight: '700', color: t.yazi, fontVariant: ['tabular-nums'] },
  hapDakika: { fontSize: 11, color: t.soluk },
    perde: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
    zamanSayfa: {
      backgroundColor: t.yuzey,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      paddingHorizontal: 16,
      paddingTop: 8,
      gap: 4,
    },
    zamanTutamac: { width: 38, height: 5, borderRadius: 3, backgroundColor: t.cizgi, alignSelf: 'center', marginBottom: 10 },
    zamanBaslik: { fontSize: 18, fontWeight: '800', color: t.yazi, marginBottom: 10 },
    turSecici: {
      flexDirection: 'row',
      padding: 3,
      borderRadius: 12,
      backgroundColor: t.cizgi,
      marginBottom: 10,
    },
    turDugme: { flex: 1, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
    turSecili: { backgroundColor: t.yuzey },
    turYazi: { fontSize: 14, fontWeight: '700', color: t.soluk },
    simdiDugme: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      height: 44,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.cizgi,
      backgroundColor: t.yuzeyIkincil,
    },
    simdiSecili: { borderColor: t.vurgu, backgroundColor: t.vurguAcik },
    simdiYazi: { fontSize: 15, fontWeight: '700', color: t.soluk },
    zamanAltBaslik: { fontSize: 11, letterSpacing: 0.8, fontWeight: '700', color: t.soluk, marginTop: 14, marginBottom: 6 },
    zamanSatiri: { flexDirection: 'row', gap: 7, paddingRight: 8 },
    zamanHap: {
      minWidth: 46,
      height: 38,
      paddingHorizontal: 12,
      borderRadius: 11,
      borderWidth: 1,
      borderColor: t.cizgi,
      backgroundColor: t.yuzeyIkincil,
      alignItems: 'center',
      justifyContent: 'center',
    },
    zamanHapSecili: { borderColor: t.vurgu, backgroundColor: t.vurguAcik },
    zamanHapYazi: { fontSize: 14, fontWeight: '600', color: t.yazi, fontVariant: ['tabular-nums'] },
    zamanOzet: { fontSize: 12.5, color: t.soluk, marginTop: 14 },
    zamanOnayla: {
      height: 50,
      borderRadius: 14,
      backgroundColor: t.vurgu,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 12,
    },
    zamanOnaylaYazi: { fontSize: 16, fontWeight: '700', color: t.vurguYazi },
  });
