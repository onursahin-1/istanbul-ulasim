// 2 · Rota sonuçları: nereden–nereye, sıralama seçenekleri ve güzergâh kartları.

import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BacakZinciri, GeriCubugu, HataKutusu, Ikon, SureSeridi, useStiller, Yukleniyor } from '@/components/ulasim';
import { OtpHatasi, rotaPlanla, type Guzergah, type Konum } from '@/lib/otp';
import { guzergahlariSakla } from '@/lib/secim';
import { aracAdi, baslikYap, useTema, type Tema } from '@/lib/tema';
import { isoDakikaSonra, istanbulSaat, istanbulSimdi, saatYaz, sureYaz } from '@/lib/zaman';

type Parametreler = { kLat: string; kLon: string; kAd: string; vLat: string; vLon: string; vAd: string };
type Sirali = { g: Guzergah; sira: number };
type Grup = { ana: Sirali; sonrakiler: Sirali[] };

const SONRAKI_SAYISI = 3;

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

type Siralama = 'hizli' | 'aktarma' | 'yurume';

const SIRALAMALAR: { anahtar: Siralama; ad: string }[] = [
  { anahtar: 'hizli', ad: 'En hızlı' },
  { anahtar: 'aktarma', ad: 'Az aktarma' },
  { anahtar: 'yurume', ad: 'Az yürüme' },
];

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
  const [siralama, setSiralama] = useState<Siralama>('hizli');
  const [guzergahlar, setGuzergahlar] = useState<Guzergah[] | null>(null);
  const [bilgi, setBilgi] = useState<string | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [aramaSaati, setAramaSaati] = useState(istanbulSaat());

  const nereden: Konum = useMemo(() => ({ ad: p.kAd ?? 'Konumum', lat: Number(p.kLat), lon: Number(p.kLon) }), [p.kAd, p.kLat, p.kLon]);
  const nereye: Konum = useMemo(() => ({ ad: p.vAd ?? 'Hedef', lat: Number(p.vLat), lon: Number(p.vLon) }), [p.vAd, p.vLat, p.vLon]);

  const ara = useCallback(
    async (sinyal?: AbortSignal) => {
      if ([nereden.lat, nereden.lon, nereye.lat, nereye.lon].some((d) => !Number.isFinite(d))) {
        setHata('Başlangıç ya da varış noktası eksik. Geri dönüp tekrar seç.');
        return;
      }
      setGuzergahlar(null);
      setHata(null);
      setBilgi(null);
      setAramaSaati(istanbulSaat());
      try {
        const sonuc = await rotaPlanla(nereden, nereye, istanbulSimdi(), sinyal);
        setGuzergahlar(sonuc.guzergahlar);
        if (sonuc.guzergahlar.length === 0) {
          const kod = sonuc.hatalar[0]?.code;
          setBilgi((kod && HATA_METINLERI[kod]) ?? 'Bu saatte uygun bir rota bulunamadı.');
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        setHata(e instanceof OtpHatasi ? e.message : 'Rota aranırken beklenmeyen bir sorun oluştu.');
      }
    },
    [nereden, nereye],
  );

  useEffect(() => {
    const iptal = new AbortController();
    ara(iptal.signal);
    return () => iptal.abort();
  }, [ara]);

  const gruplar = useMemo(() => {
    if (!guzergahlar) return [];
    const liste = gruplandir(guzergahlar);
    const sure = (x: Grup) => x.ana.g.duration ?? Infinity;
    const erken = (x: Grup) => Date.parse(x.ana.g.start ?? '') || 0;
    if (siralama === 'aktarma') liste.sort((a, b) => a.ana.g.numberOfTransfers - b.ana.g.numberOfTransfers || sure(a) - sure(b));
    else if (siralama === 'yurume') liste.sort((a, b) => (a.ana.g.walkTime ?? 0) - (b.ana.g.walkTime ?? 0) || sure(a) - sure(b));
    else liste.sort((a, b) => sure(a) - sure(b) || erken(a) - erken(b));
    return liste;
  }, [guzergahlar, siralama]);

  const enHizli = useMemo(() => Math.min(...(guzergahlar ?? []).map((g) => g.duration ?? Infinity)), [guzergahlar]);

  const yerDegistir = () =>
    router.setParams({ kLat: p.vLat, kLon: p.vLon, kAd: p.vAd, vLat: p.kLat, vLon: p.kLon, vAd: p.kAd });

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
            <Text style={s.alan} numberOfLines={1}>
              {baslikYap(nereden.ad)}
            </Text>
            <Text style={s.alan} numberOfLines={1}>
              {baslikYap(nereye.ad)}
            </Text>
          </View>
          <Pressable style={s.degistir} onPress={yerDegistir} accessibilityLabel="Başlangıç ve varışı değiştir">
            <Ikon ad="swap-vertical" boyut={18} renkKodu={tema.soluk} />
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filtreler}>
          <Pressable style={[s.filtre, s.filtreKoyu]} onPress={() => ara()}>
            <Text style={[s.filtreYazi, { color: tema.zemin }]}>Şimdi · {aramaSaati}</Text>
          </Pressable>
          {SIRALAMALAR.map((x) => (
            <Pressable
              key={x.anahtar}
              style={[s.filtre, siralama === x.anahtar && s.filtreSecili]}
              onPress={() => setSiralama(x.anahtar)}
              accessibilityState={{ selected: siralama === x.anahtar }}
            >
              <Text style={[s.filtreYazi, siralama === x.anahtar && { color: tema.vurgu }]}>{x.ad}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={[s.sonuclar, { paddingBottom: kenar.bottom + 20 }]}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => ara()} tintColor={tema.vurgu} />}
      >
        {hata && <HataKutusu mesaj={hata} tekrarDene={() => ara()} />}
        {!hata && !guzergahlar && <Yukleniyor metin="En uygun rotalar hesaplanıyor…" />}
        {bilgi && <Text style={s.bilgi}>{bilgi}</Text>}
        {gruplar.map(({ ana: { g, sira }, sonrakiler }, i) => {
          const ilkArac = g.legs.find((b) => b.transitLeg);
          const oneri = i === 0 && siralama === 'hizli' && g.duration === enHizli;
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
              </View>
              {ilkArac && (
                <Text style={s.ilkArac}>
                  {`${[aracAdi(ilkArac.route?.mode ?? ilkArac.mode), ilkArac.route?.shortName]
                    .filter(Boolean)
                    .join(' ')} · ${baslikYap(ilkArac.from.name)} durağından ${saatYaz(ilkArac.start.estimated?.time ?? ilkArac.start.scheduledTime)}`}
                </Text>
              )}
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
          <Text style={s.not}>Süreler İETT tarifesine göredir. Şimdilik yalnızca otobüs ve Metrobüs hatları dahil.</Text>
        )}
      </ScrollView>
    </View>
  );
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
  filtreler: { gap: 6 },
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
  ilkArac: { fontSize: 12.5, color: t.vurgu, fontWeight: '600' },
  not: { fontSize: 12, color: t.soluk, textAlign: 'center', paddingTop: 6 },
  sonraki: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.cizgi, paddingTop: 10, gap: 7 },
  sonrakiBaslik: { fontSize: 11, letterSpacing: 0.6, color: t.soluk, fontWeight: '700' },
  hapiSatiri: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  hap: { flexDirection: 'row', alignItems: 'baseline', gap: 4, borderWidth: 1, borderColor: t.cizgi, backgroundColor: t.zemin, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
  hapSaat: { fontSize: 13, fontWeight: '700', color: t.yazi, fontVariant: ['tabular-nums'] },
  hapDakika: { fontSize: 11, color: t.soluk },
});
