// 2 · Hedef arama: yer ve durak araması, kategori kısayolları, Ev/İş kaydetme.
//
// İki kaynak birlikte aranır: rota motorundaki duraklar ve uygulamanın içindeki
// OpenStreetMap ilgi noktaları (hastane, okul, eczane, benzinlik, kırtasiye…).
// "eczane" gibi bir kategori adı yazılırsa tek tek isim aramak yerine yakındakiler listelenir.

import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GeriCubugu, HataKutusu, Ikon, useStiller, Yukleniyor, type IkonAdi } from '@/components/ulasim';
import { mesafeMetre } from '@/lib/cografya';
import { aramaKaydet, useKayitlar, yerKaydet, type YerTuru } from '@/lib/kayitlar';
import { useKonum } from '@/lib/konum';
import { durakAra, OtpHatasi, type Durak, type Konum } from '@/lib/otp';
import {
  kategoriEslesmesi,
  poiAra,
  poiHazirla,
  poiSimgesi,
  poiTureGore,
  type PoiSonuc,
  type PoiTuru,
} from '@/lib/poi';
import { baslikYap, trBuyuk, useTema, yonYaz, type Tema } from '@/lib/tema';
import { mesafeYaz } from '@/lib/zaman';

type Parametreler = { kLat?: string; kLon?: string; kAd?: string; kaydet?: YerTuru };

const YER_ADI: Record<YerTuru, string> = { ev: 'Ev', is: 'İş' };

// Boş ekranda gösterilen kısayollar. Metne dokunmak kategori aramasını başlatır.
const KISAYOLLAR: { tur: string; ad: string }[] = [
  { tur: 'eczane', ad: 'Eczane' },
  { tur: 'hastane', ad: 'Hastane' },
  { tur: 'market', ad: 'Market' },
  { tur: 'benzinlik', ad: 'Benzin istasyonu' },
  { tur: 'avm', ad: 'AVM' },
  { tur: 'kafe', ad: 'Kafe' },
  { tur: 'park', ad: 'Park' },
  { tur: 'atm', ad: 'ATM' },
  { tur: 'kirtasiye', ad: 'Kırtasiye' },
  { tur: 'otopark', ad: 'Otopark' },
];

type DurakSonucu = Durak & { mesafe: number };

export default function AraEkrani() {
  const kenar = useSafeAreaInsets();
  const tema = useTema();
  const s = useStiller(stiller);
  const p = useLocalSearchParams<Parametreler>();
  const { yerler } = useKayitlar();
  const konum = useKonum();

  const [metin, setMetin] = useState('');
  const [duraklar, setDuraklar] = useState<DurakSonucu[] | null>(null);
  const [yerSonuclari, setYerSonuclari] = useState<PoiSonuc[] | null>(null);
  const [kategori, setKategori] = useState<PoiTuru | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);

  // Aramanın ölçüldüğü nokta: rota başlangıcı verilmişse o, yoksa kullanıcının konumu.
  const merkez = useMemo(() => {
    const lat = Number(p.kLat);
    const lon = Number(p.kLon);
    return Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0
      ? { latitude: lat, longitude: lon }
      : konum.nokta;
  }, [p.kLat, p.kLon, konum.nokta]);

  // Veritabanını ekran açılır açılmaz hazırla; ilk aramada bekleme olmasın.
  useEffect(() => poiHazirla(), []);

  useEffect(() => {
    const aranan = metin.trim();
    if (aranan.length < 3) {
      setDuraklar(null);
      setYerSonuclari(null);
      setKategori(null);
      setHata(null);
      return;
    }
    const iptal = new AbortController();
    const zamanlayici = setTimeout(async () => {
      setYukleniyor(true);
      try {
        const kat = await kategoriEslesmesi(aranan);
        setKategori(kat);
        // Yer araması telefonda yapılır, durak araması sunucuya gider: ikisi paralel.
        const [yerler, durakListesi] = await Promise.all([
          kat ? poiTureGore(kat.anahtar, merkez, 25) : poiAra(aranan, merkez, 20),
          durakAra(trBuyuk(aranan), iptal.signal).catch((e) => {
            if (e instanceof OtpHatasi) return [] as Durak[];
            throw e;
          }),
        ]);
        if (iptal.signal.aborted) return;
        setYerSonuclari(yerler);
        setDuraklar(duraklariHazirla(durakListesi, merkez));
        setHata(null);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setHata(e instanceof OtpHatasi ? e.message : 'Arama yapılamadı.');
        }
      } finally {
        setYukleniyor(false);
      }
    }, 300);
    return () => {
      clearTimeout(zamanlayici);
      iptal.abort();
    };
  }, [metin, merkez]);

  const hedefSec = useCallback(
    async (hedef: Konum, alt?: string) => {
      if (p.kaydet) {
        await yerKaydet(p.kaydet, hedef);
        router.back();
        return;
      }
      // Seçilen hedef Kayıtlı sekmesindeki "son aramalar" listesine girer.
      aramaKaydet({ ad: hedef.ad, lat: hedef.lat, lon: hedef.lon, alt });
      router.replace({
        pathname: '/rota',
        params: {
          kLat: p.kLat ?? '',
          kLon: p.kLon ?? '',
          kAd: p.kAd ?? 'Konumum',
          vLat: String(hedef.lat),
          vLon: String(hedef.lon),
          vAd: hedef.ad,
        },
      });
    },
    [p.kaydet, p.kLat, p.kLon, p.kAd],
  );

  const kaydetSor = (hedef: Konum) => {
    Alert.alert(hedef.ad, 'Bu yeri kısayol olarak kaydet', [
      { text: 'Ev olarak kaydet', onPress: () => yerKaydet('ev', hedef) },
      { text: 'İş olarak kaydet', onPress: () => yerKaydet('is', hedef) },
      { text: 'Vazgeç', style: 'cancel' },
    ]);
  };

  const baslik = p.kaydet ? `${YER_ADI[p.kaydet]} adresini seç` : 'Nereye gidiyorsun?';
  const kisa = metin.trim().length < 3;
  const bosSonuc = !kisa && !yukleniyor && !hata && (yerSonuclari?.length ?? 0) === 0 && (duraklar?.length ?? 0) === 0;

  // Tek bir listede iki bölüm: önce yerler, sonra duraklar.
  type Satir =
    | { tip: 'baslik'; anahtar: string; yazi: string }
    | { tip: 'yer'; anahtar: string; veri: PoiSonuc }
    | { tip: 'durak'; anahtar: string; veri: DurakSonucu };

  const satirlar = useMemo<Satir[]>(() => {
    const liste: Satir[] = [];
    if (yerSonuclari?.length) {
      liste.push({
        tip: 'baslik',
        anahtar: 'b-yer',
        yazi: kategori ? `YAKININDAKİ ${trBuyuk(kategori.ad)}` : 'YERLER',
      });
      for (const y of yerSonuclari) liste.push({ tip: 'yer', anahtar: `y${y.id}`, veri: y });
    }
    if (duraklar?.length) {
      liste.push({ tip: 'baslik', anahtar: 'b-durak', yazi: 'DURAKLAR' });
      for (const d of duraklar) liste.push({ tip: 'durak', anahtar: `d${d.gtfsId}`, veri: d });
    }
    return liste;
  }, [yerSonuclari, duraklar, kategori]);

  return (
    <View style={[s.kok, { paddingTop: kenar.top + 4 }]}>
      <View style={s.ust}>
        <GeriCubugu baslik={baslik} />
        <View style={s.girdi}>
          <Ikon ad="search" renkKodu={tema.soluk} />
          <TextInput
            id="hedef-arama"
            value={metin}
            onChangeText={setMetin}
            placeholder="Yer ya da durak ara (hastane, Taksim, 34)"
            placeholderTextColor={tema.soluk}
            style={s.girdiYazi}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>
      </View>

      {kisa && (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: kenar.bottom + 20 }}>
          {!p.kaydet &&
            (['ev', 'is'] as YerTuru[]).map((tur) => {
              const yer = yerler[tur];
              return (
                <Pressable
                  key={tur}
                  style={s.satir}
                  onPress={() => (yer ? hedefSec(yer) : router.setParams({ kaydet: tur }))}
                >
                  <View style={s.satirIkon}>
                    <Ikon ad={tur === 'ev' ? 'home' : 'briefcase'} boyut={18} renkKodu={tema.vurgu} />
                  </View>
                  <View style={s.satirMetin}>
                    <Text style={s.satirBaslik}>{YER_ADI[tur]}</Text>
                    <Text style={s.satirAlt}>{yer ? baslikYap(yer.ad) : 'Kaydetmek için dokun'}</Text>
                  </View>
                </Pressable>
              );
            })}

          <Text style={s.bolumBaslik}>YAKINIMDA NE VAR?</Text>
          <View style={s.kisayollar}>
            {KISAYOLLAR.map((k) => (
              <Pressable key={k.tur} style={s.kisayol} onPress={() => setMetin(k.ad)} accessibilityRole="button">
                <Ikon ad={poiSimgesi(k.tur) as IkonAdi} boyut={15} renkKodu={tema.vurgu} />
                <Text style={s.kisayolYazi}>{k.ad}</Text>
              </Pressable>
            ))}
          </View>

          <View style={s.ipucu}>
            <Ikon ad="bulb-outline" boyut={16} renkKodu={tema.soluk} />
            <Text style={s.ipucuYazi}>
              Yer adı, kategori ya da durak adı yazabilirsin. Yer aramaları telefonda yapılır, internet gerekmez.
              Ana ekranda haritaya basılı tutarak da hedef seçebilirsin; bir sonuca basılı tutarsan Ev ya da İş
              olarak kaydedilir.
            </Text>
          </View>
        </ScrollView>
      )}

      {hata && <HataKutusu mesaj={hata} />}
      {yukleniyor && satirlar.length === 0 && <Yukleniyor metin="Aranıyor…" />}
      {bosSonuc && <Text style={s.bos}>“{metin.trim()}” için sonuç bulunamadı.</Text>}

      {!kisa && (
        <FlatList
          data={satirlar}
          keyExtractor={(x) => x.anahtar}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingBottom: kenar.bottom + 20 }}
          renderItem={({ item }) => {
            if (item.tip === 'baslik') return <Text style={s.bolumBaslik}>{item.yazi}</Text>;

            if (item.tip === 'yer') {
              const y = item.veri;
              const hedef: Konum = { ad: y.ad, lat: y.lat, lon: y.lon };
              return (
                <Pressable
                  style={s.satir}
                  onPress={() => hedefSec(hedef, [y.turAdi, y.semt].filter(Boolean).join(' · '))}
                  onLongPress={() => kaydetSor(hedef)}
                >
                  <View style={s.satirIkon}>
                    <Ikon ad={poiSimgesi(y.tur) as IkonAdi} boyut={18} renkKodu={tema.vurgu} />
                  </View>
                  <View style={s.satirMetin}>
                    <Text style={s.satirBaslik} numberOfLines={1}>
                      {y.ad}
                    </Text>
                    <Text style={s.satirAlt} numberOfLines={1}>
                      {[y.turAdi, y.semt, mesafeYaz(y.mesafe)].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Ikon ad="chevron-forward" boyut={16} renkKodu={tema.yurume} />
                </Pressable>
              );
            }

            const d = item.veri;
            const hedef: Konum = { ad: baslikYap(d.name), lat: d.lat!, lon: d.lon! };
            return (
              <Pressable
                style={s.satir}
                onPress={() => hedefSec(hedef, 'Durak')}
                onLongPress={() => kaydetSor(hedef)}
              >
                <View style={[s.satirIkon, { backgroundColor: tema.vurguAcik }]}>
                  <Ikon ad="bus-outline" boyut={18} renkKodu={tema.vurgu} />
                </View>
                <View style={s.satirMetin}>
                  <Text style={s.satirBaslik} numberOfLines={1}>
                    {hedef.ad}
                  </Text>
                  <Text style={s.satirAlt} numberOfLines={1}>
                    {[mesafeYaz(d.mesafe), yonYaz(d.desc), d.code ? `Durak kodu ${d.code}` : '']
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
                <Ikon ad="chevron-forward" boyut={16} renkKodu={tema.yurume} />
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

/**
 * Durak sonuçlarını yakınlığa göre sıralar ve aynı addakileri teke indirir.
 * Sıralama önce yapılmalı: "KADIKÖY" adında bir durak Şile'de de var ve sıralama
 * olmadan o satır listeye girip asıl Kadıköy durağını eliyordu.
 */
function duraklariHazirla(liste: Durak[], merkez: { latitude: number; longitude: number }): DurakSonucu[] {
  const gorulen = new Set<string>();
  return liste
    .filter((d) => d.lat != null && d.lon != null)
    .map((d) => ({ ...d, mesafe: mesafeMetre(merkez, { latitude: d.lat!, longitude: d.lon! }) }))
    .sort((a, b) => a.mesafe - b.mesafe)
    .filter((d) => {
      const anahtar = d.name.trim();
      if (gorulen.has(anahtar)) return false;
      gorulen.add(anahtar);
      return true;
    })
    .slice(0, 15);
}

const stiller = (t: Tema) =>
  StyleSheet.create({
    kok: { flex: 1, backgroundColor: t.zemin },
    ust: {
      backgroundColor: t.yuzey,
      paddingHorizontal: 14,
      paddingBottom: 12,
      gap: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.cizgi,
    },
    girdi: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: t.zemin,
      borderRadius: 12,
      paddingHorizontal: 12,
      height: 46,
    },
    girdiYazi: { flex: 1, fontSize: 16, color: t.yazi },
    bolumBaslik: {
      fontSize: 11.5,
      letterSpacing: 0.8,
      fontWeight: '700',
      color: t.soluk,
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 7,
    },
    satir: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: t.yuzey,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.cizgi,
    },
    satirIkon: {
      width: 34,
      height: 34,
      borderRadius: 10,
      backgroundColor: t.vurguAcik,
      alignItems: 'center',
      justifyContent: 'center',
    },
    satirMetin: { flex: 1, gap: 2 },
    satirBaslik: { fontSize: 15, fontWeight: '600', color: t.yazi },
    satirAlt: { fontSize: 12.5, color: t.soluk },
    kisayollar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 },
    kisayol: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      height: 36,
      paddingHorizontal: 12,
      borderRadius: 999,
      backgroundColor: t.yuzey,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.cizgi,
    },
    kisayolYazi: { fontSize: 13, fontWeight: '600', color: t.yazi },
    ipucu: { flexDirection: 'row', gap: 8, padding: 16 },
    ipucuYazi: { flex: 1, fontSize: 13, color: t.soluk, lineHeight: 19 },
    bos: { color: t.soluk, textAlign: 'center', padding: 20 },
  });
