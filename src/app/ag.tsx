// Ağ haritası: bütün raylı hatlar tek haritada.
//
// Veri sunucudan gelmiyor, uygulamayla birlikte geliyor (src/lib/ag.ts): harita
// çevrimdışı da açılıyor ve anında çiziliyor. Çizgiler OSM'den gelen asıl ray
// geometrisi, istasyonlar GTFS'ten.
//
// Tasarım: harita tam ekran, üstte araç tipi süzgeci, bir hatta basınca
// istasyonları alttan açılıyor. Süzgeç araç tipine göre çünkü 24 hat rozetini
// alt şeritte tutmak hem yer yiyor hem kaydırma gerektiriyordu.

import { router } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GeriCubugu, HatRozeti, Ikon, useStiller } from '@/components/ulasim';
import { agCizgisi, agSiniri, AG_HATLARI, AG_SUZGECLERI, suzgeceUyar, type AgHatti } from '@/lib/ag';
import { durakAra, hatlariGetir, OtpHatasi } from '@/lib/otp';
import { karistir } from '@/lib/renk';
import { aracModu, baslikYap, hatRengi, useTema, type Tema } from '@/lib/tema';

/** Seçili hattın çizgisi bu kadar kalın; diğerleri ince ve soluk. */
const KALIN = 5;
const INCE = 3.4;
/**
 * Seçim varken diğer hatlar zemine doğru karıştırılıyor: ağ bağlamda kalsın ama
 * öne çıkmasın. Polyline'ın saydamlık ayarı yok, renk karıştırmak gerekiyor.
 */
const SOLUK = 0.78;

export default function AgEkrani() {
  const kenar = useSafeAreaInsets();
  const tema = useTema();
  const s = useStiller(stiller);
  const harita = useRef<MapView>(null);

  const [suzgec, setSuzgec] = useState('tumu');
  const [secili, setSecili] = useState<AgHatti | null>(null);
  const [gidiliyor, setGidiliyor] = useState(false);

  const gorunen = useMemo(() => {
    const s = AG_SUZGECLERI.find((x) => x.anahtar === suzgec) ?? AG_SUZGECLERI[0];
    return AG_HATLARI.filter((h) => suzgeceUyar(h, s));
  }, [suzgec]);

  const bolge = useMemo(() => agSiniri(), []);

  const suzgecDegis = useCallback((anahtar: string) => {
    setSuzgec(anahtar);
    setSecili(null);
  }, []);

  const hattaGit = useCallback(async (hat: AgHatti) => {
    // ag.json hattın kendi GTFS kimliğini besleme ön eki olmadan taşıyor; hat
    // ekranı ise OTP'nin "besleme:kimlik" biçimini istiyor. Kısa addan eşliyoruz.
    setGidiliyor(true);
    try {
      const hepsi = await hatlariGetir();
      const eş = hepsi.find((h) => (h.shortName ?? '').trim() === hat.kod);
      if (eş) router.push({ pathname: '/hat/[id]', params: { id: eş.gtfsId } });
    } catch {
      // Sunucu kapalıysa harita çalışmaya devam ediyor; sadece hat ekranına geçemiyoruz.
    } finally {
      setGidiliyor(false);
    }
  }, []);

  const duragaGit = useCallback(async (ad: string, lat: number, lon: number) => {
    setGidiliyor(true);
    try {
      const sonuc = await durakAra(ad.toLocaleUpperCase('tr-TR'));
      // Aynı adda birden çok durak olabilir; haritadaki noktaya en yakını.
      const en = sonuc
        .filter((d) => d.lat != null && d.lon != null)
        .sort((a, b) => (a.lat! - lat) ** 2 + (a.lon! - lon) ** 2 - ((b.lat! - lat) ** 2 + (b.lon! - lon) ** 2))[0];
      if (en) router.push({ pathname: '/durak/[id]', params: { id: en.gtfsId } });
    } catch (e) {
      if (!(e instanceof OtpHatasi)) throw e;
    } finally {
      setGidiliyor(false);
    }
  }, []);

  const renk = useCallback(
    (h: AgHatti) => hatRengi({ shortName: h.kod, color: h.renk, mode: aracModu(h.tur) }, tema),
    [tema],
  );

  return (
    <View style={s.kok}>
      <MapView
        ref={harita}
        style={StyleSheet.absoluteFill}
        userInterfaceStyle={tema.haritaStili}
        initialRegion={bolge}
        showsPointsOfInterests={false}
        toolbarEnabled={false}
        onPress={() => setSecili(null)}
        mapPadding={{ top: 110, right: 0, bottom: secili ? 300 : 20, left: 0 }}
      >
        {gorunen.map((h) => {
          const seciliMi = secili?.id === h.id;
          return (
            <Polyline
              key={h.id}
              coordinates={agCizgisi(h.id)}
              strokeColor={secili && !seciliMi ? karistir(renk(h), tema.zemin, SOLUK) : renk(h)}
              strokeWidth={seciliMi ? KALIN : INCE}
              zIndex={seciliMi ? 3 : 1}
              tappable
              onPress={() => setSecili(h)}
            />
          );
        })}

        {secili?.duraklar.map((i) => (
          <Marker
            key={`${secili.id}-${i.id}`}
            coordinate={{ latitude: i.lat, longitude: i.lon }}
            title={baslikYap(i.ad)}
            pinColor={renk(secili)}
            onCalloutPress={() => duragaGit(i.ad, i.lat, i.lon)}
          />
        ))}
      </MapView>

      <View style={[s.ust, { paddingTop: kenar.top }]}>
        <GeriCubugu baslik="Ağ haritası" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.suzgecler}>
          {AG_SUZGECLERI.map((x) => {
            const acik = x.anahtar === suzgec;
            return (
              <Pressable
                key={x.anahtar}
                onPress={() => suzgecDegis(x.anahtar)}
                style={[s.suzgec, acik && { backgroundColor: tema.vurgu, borderColor: tema.vurgu }]}
                accessibilityRole="button"
                accessibilityState={{ selected: acik }}
              >
                <Text style={[s.suzgecYazi, acik && { color: tema.vurguYazi }]}>{x.ad}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {!secili && (
        <View style={[s.ipucu, { bottom: kenar.bottom + 16 }]}>
          <Ikon ad="hand-left-outline" boyut={15} renkKodu={tema.soluk} />
          <Text style={s.ipucuYazi}>
            {gorunen.length} hat çizili — istasyonlarını görmek için bir hatta dokun
          </Text>
        </View>
      )}

      {secili && (
        <View style={[s.yaprak, { paddingBottom: kenar.bottom }]}>
          <View style={s.tut} />
          <View style={s.yaprakBas}>
            <HatRozeti hat={{ shortName: secili.kod, color: secili.renk, mode: aracModu(secili.tur) }} />
            <Pressable style={s.yaprakAd} onPress={() => hattaGit(secili)} accessibilityRole="button">
              <Text style={s.yaprakBaslik} numberOfLines={1}>
                {baslikYap(secili.ad)}
              </Text>
              <Text style={s.yaprakAlt}>{secili.duraklar.length} istasyon · sefer saatleri için dokun</Text>
            </Pressable>
            {gidiliyor ? (
              <ActivityIndicator color={tema.vurgu} />
            ) : (
              <Pressable onPress={() => setSecili(null)} hitSlop={10} accessibilityLabel="Kapat">
                <Ikon ad="close" boyut={20} renkKodu={tema.soluk} />
              </Pressable>
            )}
          </View>
          <FlatList
            data={secili.duraklar}
            keyExtractor={(i, n) => `${i.id}-${n}`}
            style={s.liste}
            renderItem={({ item, index }) => (
              <Pressable style={s.istSatir} onPress={() => duragaGit(item.ad, item.lat, item.lon)}>
                <View style={s.izKutu}>
                  <View style={[s.iz, { backgroundColor: renk(secili) }]} />
                  <View
                    style={[
                      s.nokta,
                      { borderColor: renk(secili), backgroundColor: tema.yuzey },
                      index === 0 || index === secili.duraklar.length - 1 ? s.ucNokta : null,
                    ]}
                  />
                </View>
                <Text style={s.istAd} numberOfLines={1}>
                  {baslikYap(item.ad)}
                </Text>
              </Pressable>
            )}
          />
        </View>
      )}
    </View>
  );
}

const stiller = (t: Tema) =>
  StyleSheet.create({
    kok: { flex: 1, backgroundColor: t.zemin },
    ust: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: t.yuzey, paddingBottom: 8 },
    suzgecler: { paddingHorizontal: 12, gap: 8 },
    suzgec: {
      paddingHorizontal: 13,
      paddingVertical: 7,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.cizgi,
      backgroundColor: t.zemin,
    },
    suzgecYazi: { fontSize: 13, color: t.yazi },
    ipucu: {
      position: 'absolute',
      left: 16,
      right: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      backgroundColor: t.yuzey,
      borderRadius: 12,
      paddingVertical: 9,
      paddingHorizontal: 12,
    },
    ipucuYazi: { flex: 1, fontSize: 12.5, color: t.soluk },
    yaprak: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      maxHeight: '58%',
      backgroundColor: t.yuzey,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.cizgi,
    },
    tut: { width: 34, height: 4, borderRadius: 2, backgroundColor: t.cizgi, alignSelf: 'center', marginTop: 8 },
    yaprakBas: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.cizgi,
    },
    yaprakAd: { flex: 1, minWidth: 0 },
    yaprakBaslik: { fontSize: 15, fontWeight: '600', color: t.yazi },
    yaprakAlt: { fontSize: 12, color: t.soluk, marginTop: 1 },
    liste: { paddingHorizontal: 14 },
    istSatir: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 38 },
    izKutu: { width: 14, alignItems: 'center', alignSelf: 'stretch', justifyContent: 'center' },
    iz: { position: 'absolute', top: 0, bottom: 0, width: 3, borderRadius: 2 },
    nokta: { width: 9, height: 9, borderRadius: 5, borderWidth: 2 },
    ucNokta: { width: 13, height: 13, borderRadius: 7 },
    istAd: { flex: 1, fontSize: 14, color: t.yazi },
  });
