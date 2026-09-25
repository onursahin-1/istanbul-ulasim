// Hatlar sekmesi: ağdaki bütün hatlara araç tipine göre göz atma ve hat arama.
//
// Hat listesi rota motorundan bir kez çekilip bellekte tutulur (~3.700 hat);
// süzme ve arama telefonda yapılır, her tuşa basışta sunucuya gidilmez.

import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HataKutusu, HatRozeti, Ikon, ROZET_SUTUNU, useStiller, Yukleniyor } from '@/components/ulasim';
import { hatlariGetir, OtpHatasi, type HatOzeti } from '@/lib/otp';
import { hatlariTekille } from '@/lib/hat-tekil';
import { sadelestir } from '@/lib/poi';
import { aracAdi, baslikYap, useTema, type Tema } from '@/lib/tema';

type Suzgec = { anahtar: string; ad: string; modlar: string[] | null };

const SUZGECLER: Suzgec[] = [
  { anahtar: 'tumu', ad: 'Tümü', modlar: null },
  { anahtar: 'metro', ad: 'Metro', modlar: ['SUBWAY'] },
  { anahtar: 'tren', ad: 'Marmaray', modlar: ['RAIL'] },
  { anahtar: 'vapur', ad: 'Vapur', modlar: ['FERRY'] },
  { anahtar: 'tramvay', ad: 'Tramvay', modlar: ['TRAM'] },
  { anahtar: 'egimli', ad: 'Füniküler', modlar: ['FUNICULAR', 'CABLE_CAR', 'GONDOLA'] },
  { anahtar: 'otobus', ad: 'Otobüs', modlar: ['BUS', 'TROLLEYBUS', 'COACH'] },
];

// Listede bölüm başlıklarının sırası: raylı sistemler önce, otobüsler sonda.
const MOD_SIRASI = ['SUBWAY', 'RAIL', 'TRAM', 'FUNICULAR', 'CABLE_CAR', 'GONDOLA', 'FERRY', 'BUS'];

type Satir = { tip: 'baslik'; anahtar: string; yazi: string } | { tip: 'hat'; anahtar: string; veri: HatOzeti };

export default function HatlarEkrani() {
  const kenar = useSafeAreaInsets();
  const tema = useTema();
  const s = useStiller(stiller);

  const [hatlar, setHatlar] = useState<HatOzeti[] | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [metin, setMetin] = useState('');
  const [suzgec, setSuzgec] = useState('tumu');

  const yukle = useCallback(async () => {
    setHata(null);
    try {
      setHatlar(await hatlariGetir());
    } catch (e) {
      setHata(e instanceof OtpHatasi ? e.message : 'Hat listesi alınamadı.');
    }
  }, []);

  useEffect(() => {
    yukle();
  }, [yukle]);

  // İETT her yönü ayrı güzergâh olarak yayımlıyor (T2 iki kez görünüyordu); hat başına bir satır.
  const tekil = useMemo(() => (hatlar ? hatlariTekille(hatlar) : null), [hatlar]);

  const satirlar = useMemo<Satir[]>(() => {
    if (!tekil) return [];
    const secili = SUZGECLER.find((x) => x.anahtar === suzgec) ?? SUZGECLER[0];
    const aranan = sadelestir(metin);

    const suzulmus = tekil.filter((h) => {
      const mod = (h.mode ?? '').toUpperCase();
      if (secili.modlar && !secili.modlar.includes(mod)) return false;
      if (!aranan) return true;
      return sadelestir(`${h.shortName ?? ''} ${h.longName ?? ''}`).includes(aranan);
    });

    // Otobüs hatları çok kalabalık; arama yokken listeyi makul bir uzunlukta tutuyoruz.
    const sinir = aranan ? 300 : suzgec === 'tumu' ? 120 : 400;

    const gruplar = new Map<string, HatOzeti[]>();
    for (const h of suzulmus) {
      const mod = (h.mode ?? 'BUS').toUpperCase();
      if (!gruplar.has(mod)) gruplar.set(mod, []);
      gruplar.get(mod)!.push(h);
    }

    const liste: Satir[] = [];
    let sayac = 0;
    const sirali = [...gruplar.entries()].sort(
      (a, b) => (MOD_SIRASI.indexOf(a[0]) + 99) % 100 - ((MOD_SIRASI.indexOf(b[0]) + 99) % 100),
    );
    for (const [mod, grup] of sirali) {
      if (sayac >= sinir) break;
      grup.sort((a, b) => (a.shortName ?? '').localeCompare(b.shortName ?? '', 'tr', { numeric: true }));
      liste.push({ tip: 'baslik', anahtar: `b-${mod}`, yazi: (aracAdi(mod) || 'Diğer').toLocaleUpperCase('tr') });
      for (const h of grup) {
        if (sayac >= sinir) break;
        liste.push({ tip: 'hat', anahtar: h.gtfsId, veri: h });
        sayac++;
      }
    }
    return liste;
  }, [tekil, metin, suzgec]);

  const toplam = tekil?.length ?? 0;

  return (
    <View style={[s.kok, { paddingTop: kenar.top + 6 }]}>
      <View style={s.ust}>
        <View style={s.baslikSatiri}>
          <Text style={s.baslik}>Hatlar</Text>
          <Pressable
            onPress={() => router.push('/ag')}
            style={s.haritaDugmesi}
            accessibilityRole="button"
            accessibilityLabel="Ağ haritası"
          >
            <Ikon ad="map-outline" boyut={16} renkKodu={tema.vurgu} />
            <Text style={s.haritaYazi}>Harita</Text>
          </Pressable>
        </View>
        <View style={s.girdi}>
          <Ikon ad="search" boyut={18} renkKodu={tema.soluk} />
          <TextInput
            value={metin}
            onChangeText={setMetin}
            placeholder="Hat numarası ya da adı"
            placeholderTextColor={tema.soluk}
            style={s.girdiYazi}
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
        </View>
      </View>

      <FlatList
        data={SUZGECLER}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(x) => x.anahtar}
        style={s.suzgecSeridi}
        contentContainerStyle={s.suzgecler}
        renderItem={({ item }) => {
          const secili = item.anahtar === suzgec;
          return (
            <Pressable
              onPress={() => setSuzgec(item.anahtar)}
              style={[s.suzgec, secili && s.suzgecSecili]}
              accessibilityState={{ selected: secili }}
            >
              <Text style={[s.suzgecYazi, secili && { color: tema.vurguYazi }]}>{item.ad}</Text>
            </Pressable>
          );
        }}
      />

      {hata && <HataKutusu mesaj={hata} tekrarDene={yukle} />}
      {!hatlar && !hata && <Yukleniyor metin="Hatlar yükleniyor…" />}
      {hatlar && satirlar.length === 0 && (
        <Text style={s.bos}>{metin.trim() ? `“${metin.trim()}” için hat bulunamadı.` : 'Bu tipte hat yok.'}</Text>
      )}

      <FlatList
        data={satirlar}
        keyExtractor={(x) => x.anahtar}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: kenar.bottom + 16 }}
        ListFooterComponent={
          hatlar && satirlar.length > 0 ? (
            <Text style={s.dipnot}>
              {metin.trim()
                ? `${satirlar.filter((x) => x.tip === 'hat').length} hat gösteriliyor`
                : `Ağda toplam ${toplam.toLocaleString('tr-TR')} hat var. Aramak için yukarıya yaz.`}
            </Text>
          ) : null
        }
        renderItem={({ item }) => {
          if (item.tip === 'baslik') return <Text style={s.bolumBaslik}>{item.yazi}</Text>;
          const h = item.veri;
          return (
            <Pressable
              style={s.satir}
              onPress={() => router.push({ pathname: '/hat/[id]', params: { id: h.gtfsId } })}
              accessibilityRole="button"
            >
              <View style={s.rozetKutusu}>
                <HatRozeti hat={h} />
              </View>
              <View style={s.satirMetin}>
                <Text style={s.satirBaslik} numberOfLines={1}>
                  {baslikYap(h.longName) || h.shortName || h.gtfsId}
                </Text>
                <Text style={s.satirAlt} numberOfLines={1}>
                  {h.agency?.name ?? aracAdi(h.mode)}
                </Text>
              </View>
              <Ikon ad="chevron-forward" boyut={16} renkKodu={tema.yurume} />
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const stiller = (t: Tema) =>
  StyleSheet.create({
    kok: { flex: 1, backgroundColor: t.zemin },
    ust: { backgroundColor: t.yuzey, paddingHorizontal: 16, paddingBottom: 12, gap: 10 },
    baslikSatiri: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    baslik: { fontSize: 26, fontWeight: '800', color: t.yazi, letterSpacing: -0.4 },
    haritaDugmesi: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingVertical: 7,
      paddingHorizontal: 12,
      borderRadius: 999,
      backgroundColor: t.vurguAcik,
    },
    haritaYazi: { fontSize: 13.5, fontWeight: '600', color: t.vurgu },
    girdi: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: t.zemin,
      borderRadius: 12,
      paddingHorizontal: 12,
      height: 44,
    },
    girdiYazi: { flex: 1, fontSize: 15, color: t.yazi },
    suzgecSeridi: { flexGrow: 0, backgroundColor: t.yuzey, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.cizgi },
    suzgecler: { gap: 7, paddingHorizontal: 16, paddingBottom: 12 },
    suzgec: {
      height: 32,
      paddingHorizontal: 13,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: t.cizgi,
      backgroundColor: t.yuzeyIkincil,
      alignItems: 'center',
      justifyContent: 'center',
    },
    suzgecSecili: { backgroundColor: t.vurgu, borderColor: t.vurgu },
    suzgecYazi: { fontSize: 13, fontWeight: '600', color: t.yazi },
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
      gap: 11,
      paddingHorizontal: 16,
      paddingVertical: 11,
      backgroundColor: t.yuzey,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.cizgi,
    },
    rozetKutusu: { minWidth: ROZET_SUTUNU },
    satirMetin: { flex: 1, gap: 2 },
    satirBaslik: { fontSize: 14.5, fontWeight: '600', color: t.yazi },
    satirAlt: { fontSize: 12, color: t.soluk },
    bos: { color: t.soluk, textAlign: 'center', padding: 20 },
    dipnot: { color: t.soluk, fontSize: 12, textAlign: 'center', padding: 18, lineHeight: 18 },
  });
