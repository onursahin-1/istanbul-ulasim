// Kayıtlı sekmesi: Ev/İş kısayolları, favori duraklar ve son aranan yerler.

import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Dakika, Ikon, useStiller } from '@/components/ulasim';
import { aramalariTemizle, favoriDegistir, useKayitlar, type YerTuru } from '@/lib/kayitlar';
import { useKonum } from '@/lib/konum';
import { durakDetayiGetir } from '@/lib/otp';
import { baslikYap, useTema, type Tema } from '@/lib/tema';
import { kacDakikaSonra } from '@/lib/zaman';

const YER_ADI: Record<YerTuru, string> = { ev: 'Ev', is: 'İş' };

/** Favori durakların sıradaki kalkışı: durak kimliği → kaç dakika sonra. */
type Dakikalar = Record<string, number | null>;

export default function KayitliEkrani() {
  const kenar = useSafeAreaInsets();
  const tema = useTema();
  const s = useStiller(stiller);
  const konum = useKonum();
  const { yerler, favoriler, aramalar } = useKayitlar();

  const [dakikalar, setDakikalar] = useState<Dakikalar>({});
  const [yenileniyor, setYenileniyor] = useState(false);

  const kalkislariYukle = useCallback(async () => {
    if (!favoriler.length) return;
    const sonuc: Dakikalar = {};
    await Promise.all(
      favoriler.map(async (f) => {
        try {
          const durak = await durakDetayiGetir(f.gtfsId);
          const sirada = (durak?.kalkislar ?? [])
            .map((k) => kacDakikaSonra(k.serviceDay ?? 0, k.realtimeDeparture ?? k.scheduledDeparture ?? 0))
            .filter((d) => d >= 0)
            .sort((a, b) => a - b)[0];
          sonuc[f.gtfsId] = sirada ?? null;
        } catch {
          sonuc[f.gtfsId] = null;
        }
      }),
    );
    setDakikalar(sonuc);
  }, [favoriler]);

  useEffect(() => {
    kalkislariYukle();
  }, [kalkislariYukle]);

  const hedefeGit = (hedef: { ad: string; lat: number; lon: number }) =>
    router.push({
      pathname: '/rota',
      params: {
        kLat: String(konum.nokta.latitude),
        kLon: String(konum.nokta.longitude),
        kAd: konum.tur === 'gercek' ? 'Konumum' : 'Kadıköy (örnek konum)',
        vLat: String(hedef.lat),
        vLon: String(hedef.lon),
        vAd: hedef.ad,
      },
    });

  return (
    <ScrollView
      style={s.kok}
      contentContainerStyle={{ paddingTop: kenar.top + 6, paddingBottom: kenar.bottom + 24 }}
      refreshControl={
        <RefreshControl
          refreshing={yenileniyor}
          tintColor={tema.vurgu}
          onRefresh={async () => {
            setYenileniyor(true);
            await kalkislariYukle();
            setYenileniyor(false);
          }}
        />
      }
    >
      <Text style={s.baslik}>Kayıtlı</Text>

      <View style={s.kartlar}>
        {(['ev', 'is'] as YerTuru[]).map((tur) => {
          const yer = yerler[tur];
          return (
            <Pressable
              key={tur}
              style={s.kart}
              onPress={() => (yer ? hedefeGit(yer) : router.push({ pathname: '/ara', params: { kaydet: tur } }))}
              accessibilityRole="button"
            >
              <View style={s.kartIkon}>
                <Ikon ad={tur === 'ev' ? 'home' : 'briefcase'} boyut={17} renkKodu={tema.vurgu} />
              </View>
              <Text style={s.kartBaslik}>{YER_ADI[tur]}</Text>
              <Text style={s.kartAlt} numberOfLines={1}>
                {yer ? baslikYap(yer.ad) : 'Eklemek için dokun'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={s.bolumBaslik}>FAVORİ DURAKLAR</Text>
      {favoriler.length === 0 ? (
        <Text style={s.bos}>
          Henüz favori durağın yok. Bir durak ekranını açıp kalpli düğmeye basarak buraya ekleyebilirsin.
        </Text>
      ) : (
        <View style={s.liste}>
          {favoriler.map((f) => (
            <Pressable
              key={f.gtfsId}
              style={s.satir}
              onPress={() => router.push({ pathname: '/durak/[id]', params: { id: f.gtfsId } })}
              onLongPress={() =>
                Alert.alert(baslikYap(f.ad), 'Bu durağı favorilerden çıkar?', [
                  { text: 'Çıkar', style: 'destructive', onPress: () => favoriDegistir(f) },
                  { text: 'Vazgeç', style: 'cancel' },
                ])
              }
              accessibilityRole="button"
            >
              <View style={s.satirIkon}>
                <Ikon ad="heart" boyut={17} renkKodu={tema.vurgu} />
              </View>
              <View style={s.satirMetin}>
                <Text style={s.satirBaslik} numberOfLines={1}>
                  {baslikYap(f.ad)}
                </Text>
                <Text style={s.satirAlt}>Kaldırmak için basılı tut</Text>
              </View>
              {dakikalar[f.gtfsId] != null ? (
                <Dakika dakika={dakikalar[f.gtfsId] as number} />
              ) : (
                <Text style={s.satirAlt}>—</Text>
              )}
            </Pressable>
          ))}
        </View>
      )}

      <View style={s.bolumSatiri}>
        <Text style={s.bolumBaslik}>SON ARAMALAR</Text>
        {aramalar.length > 0 && (
          <Pressable onPress={aramalariTemizle} hitSlop={10} accessibilityRole="button">
            <Text style={s.temizle}>Temizle</Text>
          </Pressable>
        )}
      </View>
      {aramalar.length === 0 ? (
        <Text style={s.bos}>Aradığın yerler burada birikecek.</Text>
      ) : (
        <View style={s.liste}>
          {aramalar.map((a, i) => (
            <Pressable key={`${a.ad}-${i}`} style={s.satir} onPress={() => hedefeGit(a)} accessibilityRole="button">
              <View style={[s.satirIkon, { backgroundColor: tema.zemin }]}>
                <Ikon ad="time-outline" boyut={17} renkKodu={tema.soluk} />
              </View>
              <View style={s.satirMetin}>
                <Text style={s.satirBaslik} numberOfLines={1}>
                  {a.ad}
                </Text>
                {!!a.alt && (
                  <Text style={s.satirAlt} numberOfLines={1}>
                    {a.alt}
                  </Text>
                )}
              </View>
              <Ikon ad="chevron-forward" boyut={16} renkKodu={tema.yurume} />
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const stiller = (t: Tema) =>
  StyleSheet.create({
    kok: { flex: 1, backgroundColor: t.zemin },
    baslik: { fontSize: 26, fontWeight: '800', color: t.yazi, letterSpacing: -0.4, paddingHorizontal: 16, paddingBottom: 14 },
    kartlar: { flexDirection: 'row', gap: 10, paddingHorizontal: 16 },
    kart: {
      flex: 1,
      backgroundColor: t.yuzey,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.cizgi,
      borderRadius: 14,
      padding: 12,
      gap: 3,
    },
    kartIkon: {
      width: 32,
      height: 32,
      borderRadius: 10,
      backgroundColor: t.vurguAcik,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 6,
    },
    kartBaslik: { fontSize: 14, fontWeight: '700', color: t.yazi },
    kartAlt: { fontSize: 12, color: t.soluk },
    bolumSatiri: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 16 },
    bolumBaslik: {
      fontSize: 11.5,
      letterSpacing: 0.8,
      fontWeight: '700',
      color: t.soluk,
      paddingHorizontal: 16,
      paddingTop: 20,
      paddingBottom: 7,
    },
    temizle: { fontSize: 12.5, fontWeight: '700', color: t.vurgu, paddingTop: 13 },
    liste: { backgroundColor: t.yuzey, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.cizgi },
    satir: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
      paddingHorizontal: 16,
      paddingVertical: 11,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.cizgiSilik,
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
    satirBaslik: { fontSize: 14.5, fontWeight: '600', color: t.yazi },
    satirAlt: { fontSize: 12, color: t.soluk },
    bos: { color: t.soluk, fontSize: 13, lineHeight: 19, paddingHorizontal: 16, paddingBottom: 6 },
  });
