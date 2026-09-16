// 2 · Rota sonuçları: nereden–nereye, sıralama seçenekleri ve güzergâh kartları.

import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BacakZinciri, GeriCubugu, HataKutusu, Ikon, SureSeridi, Yukleniyor } from '@/components/ulasim';
import { OtpHatasi, rotaPlanla, type Guzergah, type Konum } from '@/lib/otp';
import { guzergahlariSakla } from '@/lib/secim';
import { baslikYap, renk } from '@/lib/tema';
import { istanbulSaat, istanbulSimdi, saatYaz, sureYaz } from '@/lib/zaman';

type Parametreler = { kLat: string; kLon: string; kAd: string; vLat: string; vLon: string; vAd: string };
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

  const sirali = useMemo(() => {
    if (!guzergahlar) return [];
    const liste = guzergahlar.map((g, sira) => ({ g, sira }));
    const sure = (g: Guzergah) => g.duration ?? Infinity;
    if (siralama === 'aktarma') liste.sort((a, b) => a.g.numberOfTransfers - b.g.numberOfTransfers || sure(a.g) - sure(b.g));
    else if (siralama === 'yurume') liste.sort((a, b) => (a.g.walkTime ?? 0) - (b.g.walkTime ?? 0) || sure(a.g) - sure(b.g));
    else liste.sort((a, b) => sure(a.g) - sure(b.g));
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
            <Ikon ad="swap-vertical" boyut={18} renkKodu={renk.soluk} />
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filtreler}>
          <Pressable style={[s.filtre, s.filtreKoyu]} onPress={() => ara()}>
            <Text style={[s.filtreYazi, { color: '#fff' }]}>Şimdi · {aramaSaati}</Text>
          </Pressable>
          {SIRALAMALAR.map((x) => (
            <Pressable
              key={x.anahtar}
              style={[s.filtre, siralama === x.anahtar && s.filtreSecili]}
              onPress={() => setSiralama(x.anahtar)}
              accessibilityState={{ selected: siralama === x.anahtar }}
            >
              <Text style={[s.filtreYazi, siralama === x.anahtar && { color: renk.vurgu }]}>{x.ad}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={[s.sonuclar, { paddingBottom: kenar.bottom + 20 }]}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => ara()} tintColor={renk.vurgu} />}
      >
        {hata && <HataKutusu mesaj={hata} tekrarDene={() => ara()} />}
        {!hata && !guzergahlar && <Yukleniyor metin="En uygun rotalar hesaplanıyor…" />}
        {bilgi && <Text style={s.bilgi}>{bilgi}</Text>}
        {sirali.map(({ g, sira }, i) => {
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
                  {`${ilkArac.route?.shortName ?? ''} · ${baslikYap(ilkArac.from.name)} durağından ${saatYaz(ilkArac.start.estimated?.time ?? ilkArac.start.scheduledTime)}`}
                </Text>
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

const s = StyleSheet.create({
  kok: { flex: 1, backgroundColor: renk.zemin },
  ust: { backgroundColor: renk.yuzey, paddingHorizontal: 14, paddingBottom: 12, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: renk.cizgi },
  nerede: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  noktalar: { width: 18, alignItems: 'center', gap: 3 },
  baslangicNokta: { width: 11, height: 11, borderRadius: 6, borderWidth: 3, borderColor: renk.vurgu },
  kesik: { width: 2, height: 18, backgroundColor: '#c5cfca' },
  bitisNokta: { width: 10, height: 10, borderRadius: 3, backgroundColor: renk.yazi },
  alan: { backgroundColor: renk.zemin, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontWeight: '600', fontSize: 14, color: renk.yazi },
  degistir: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: renk.cizgi, alignItems: 'center', justifyContent: 'center' },
  filtreler: { gap: 6 },
  filtre: { borderWidth: 1, borderColor: renk.cizgi, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  filtreKoyu: { backgroundColor: renk.yazi, borderColor: renk.yazi },
  filtreSecili: { borderColor: renk.vurgu, backgroundColor: renk.vurguAcik },
  filtreYazi: { fontSize: 12.5, fontWeight: '600', color: renk.soluk },
  sonuclar: { padding: 12, gap: 10 },
  bilgi: { color: renk.soluk, textAlign: 'center', padding: 20, lineHeight: 20 },
  kart: { backgroundColor: renk.yuzey, borderRadius: 16, padding: 14, gap: 10, borderWidth: 1, borderColor: renk.cizgi },
  kartOneri: { borderColor: renk.vurgu, borderWidth: 2 },
  kartUst: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  sure: { fontSize: 24, fontWeight: '800', color: renk.yazi, letterSpacing: -0.5 },
  saat: { fontSize: 13.5, fontWeight: '600', color: renk.soluk, fontVariant: ['tabular-nums'] },
  etiket: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, color: renk.vurgu, backgroundColor: renk.vurguAcik, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, overflow: 'hidden' },
  kartAlt: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  altYazi: { fontSize: 12.5, color: renk.soluk, fontVariant: ['tabular-nums'] },
  kalin: { color: renk.yazi, fontWeight: '700' },
  ilkArac: { fontSize: 12.5, color: renk.vurgu, fontWeight: '600' },
  not: { fontSize: 12, color: renk.soluk, textAlign: 'center', paddingTop: 6 },
});
