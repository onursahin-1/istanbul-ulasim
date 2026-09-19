// Hedef arama: durak adına göre arama, kayıtlı yerler ve Ev/İş kaydetme.

import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GeriCubugu, HataKutusu, Ikon, useStiller, Yukleniyor } from '@/components/ulasim';
import { mesafeMetre } from '@/lib/cografya';
import { useKayitlar, yerKaydet, type YerTuru } from '@/lib/kayitlar';
import { useKonum } from '@/lib/konum';
import { durakAra, OtpHatasi, type Durak, type Konum } from '@/lib/otp';
import { baslikYap, trBuyuk, useTema, yonYaz, type Tema } from '@/lib/tema';
import { mesafeYaz } from '@/lib/zaman';

type Parametreler = { kLat?: string; kLon?: string; kAd?: string; kaydet?: YerTuru };

const YER_ADI: Record<YerTuru, string> = { ev: 'Ev', is: 'İş' };

export default function AraEkrani() {
  const kenar = useSafeAreaInsets();
  const tema = useTema();
  const s = useStiller(stiller);
  const p = useLocalSearchParams<Parametreler>();
  const { yerler } = useKayitlar();
  const konum = useKonum();
  const [metin, setMetin] = useState('');
  const [sonuclar, setSonuclar] = useState<Durak[] | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);

  // Kullanıcı yazmayı bırakınca (350 ms) arama yapılır.
  useEffect(() => {
    const aranan = metin.trim();
    if (aranan.length < 3) {
      setSonuclar(null);
      setHata(null);
      return;
    }
    const iptal = new AbortController();
    const zamanlayici = setTimeout(async () => {
      setYukleniyor(true);
      try {
        setSonuclar(await durakAra(trBuyuk(aranan), iptal.signal));
        setHata(null);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setHata(e instanceof OtpHatasi ? e.message : 'Arama yapılamadı.');
      } finally {
        setYukleniyor(false);
      }
    }, 350);
    return () => {
      clearTimeout(zamanlayici);
      iptal.abort();
    };
  }, [metin]);

  // Aramanın ölçüldüğü nokta: rota başlangıcı verilmişse o, yoksa kullanıcının konumu.
  const merkez = useMemo(() => {
    const lat = Number(p.kLat);
    const lon = Number(p.kLon);
    return Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0
      ? { latitude: lat, longitude: lon }
      : konum.nokta;
  }, [p.kLat, p.kLon, konum.nokta]);

  /**
   * Sonuçlar önce yakınlığa göre sıralanır, sonra aynı addakiler tek satıra indirilir.
   * Sıralama önce yapılmalı: "KADIKÖY" adında bir durak Şile'de de var ve sıralama
   * olmadan o satır listeye girip asıl Kadıköy durağını eliyordu.
   */
  const tekilSonuclar = useMemo(() => {
    const gorulen = new Set<string>();
    return (sonuclar ?? [])
      .filter((d) => d.lat != null && d.lon != null)
      .map((d) => ({ ...d, mesafe: mesafeMetre(merkez, { latitude: d.lat!, longitude: d.lon! }) }))
      .sort((a, b) => a.mesafe - b.mesafe)
      .filter((d) => {
        const anahtar = d.name.trim();
        if (gorulen.has(anahtar)) return false;
        gorulen.add(anahtar);
        return true;
      })
      .slice(0, 25);
  }, [sonuclar, merkez]);

  const hedefSec = async (hedef: Konum) => {
    if (p.kaydet) {
      await yerKaydet(p.kaydet, hedef);
      router.back();
      return;
    }
    router.replace({
      pathname: '/rota',
      params: { kLat: p.kLat ?? '', kLon: p.kLon ?? '', kAd: p.kAd ?? 'Konumum', vLat: String(hedef.lat), vLon: String(hedef.lon), vAd: hedef.ad },
    });
  };

  const kaydetSor = (hedef: Konum) => {
    Alert.alert(baslikYap(hedef.ad), 'Bu durağı kısayol olarak kaydet', [
      { text: 'Ev olarak kaydet', onPress: () => yerKaydet('ev', hedef) },
      { text: 'İş olarak kaydet', onPress: () => yerKaydet('is', hedef) },
      { text: 'Vazgeç', style: 'cancel' },
    ]);
  };

  const baslik = p.kaydet ? `${YER_ADI[p.kaydet]} adresini seç` : 'Nereye gidiyorsun?';

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
            placeholder="Durak adı yaz (ör. Taksim, Mecidiyeköy)"
            placeholderTextColor={tema.soluk}
            style={s.girdiYazi}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>
      </View>

      {metin.trim().length < 3 && (
        <View style={s.bolum}>
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
          <View style={s.ipucu}>
            <Ikon ad="bulb-outline" boyut={16} renkKodu={tema.soluk} />
            <Text style={s.ipucuYazi}>
              En az 3 harf yaz. Şimdilik yalnızca durak adlarında arama yapılıyor; adres aramak yerine ana ekranda haritaya
              basılı tutarak da hedef seçebilirsin. Bir sonuca basılı tutarsan Ev ya da İş olarak kaydedebilirsin.
            </Text>
          </View>
        </View>
      )}

      {hata && <HataKutusu mesaj={hata} />}
      {yukleniyor && !sonuclar && <Yukleniyor metin="Aranıyor…" />}
      {sonuclar && tekilSonuclar.length === 0 && !yukleniyor && (
        <Text style={s.bos}>"{metin.trim()}" adında durak bulunamadı.</Text>
      )}

      <FlatList
        data={tekilSonuclar}
        keyExtractor={(d) => d.gtfsId}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: kenar.bottom + 20 }}
        renderItem={({ item }) => {
          const hedef: Konum = { ad: baslikYap(item.name), lat: item.lat!, lon: item.lon! };
          return (
            <Pressable style={s.satir} onPress={() => hedefSec(hedef)} onLongPress={() => kaydetSor(hedef)}>
              <View style={s.satirIkon}>
                <Ikon ad="bus-outline" boyut={18} renkKodu={tema.vurgu} />
              </View>
              <View style={s.satirMetin}>
                <Text style={s.satirBaslik}>{hedef.ad}</Text>
                <Text style={s.satirAlt}>
                  {[mesafeYaz(item.mesafe), yonYaz(item.desc), item.code ? `Durak kodu ${item.code}` : '']
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              <Ikon ad="chevron-forward" boyut={16} renkKodu="#aab6b0" />
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
  ust: { backgroundColor: t.yuzey, paddingHorizontal: 14, paddingBottom: 12, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.cizgi },
  girdi: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.zemin, borderRadius: 12, paddingHorizontal: 12, height: 46 },
  girdiYazi: { flex: 1, fontSize: 16, color: t.yazi },
  bolum: { paddingTop: 6 },
  satir: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: t.yuzey, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.cizgi },
  satirIkon: { width: 34, height: 34, borderRadius: 10, backgroundColor: t.vurguAcik, alignItems: 'center', justifyContent: 'center' },
  satirMetin: { flex: 1, gap: 2 },
  satirBaslik: { fontSize: 15, fontWeight: '600', color: t.yazi },
  satirAlt: { fontSize: 12.5, color: t.soluk },
  ipucu: { flexDirection: 'row', gap: 8, padding: 16 },
  ipucuYazi: { flex: 1, fontSize: 13, color: t.soluk, lineHeight: 19 },
  bos: { color: t.soluk, textAlign: 'center', padding: 20 },
});
