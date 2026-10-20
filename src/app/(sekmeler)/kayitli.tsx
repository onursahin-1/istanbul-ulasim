// Kayıtlı sekmesi: Ev/İş kısayolları, favori yerler, favori duraklar ve son aranan yerler.

import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/dokun';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { KaydirmaliSatir } from '@/components/kaydirmali-satir';
import { Dakika, Ikon, useStiller } from '@/components/ulasim';
import { aramalariTemizle, aramaSil, favoriDegistir, yerSil, favoriYerDegistir, useKayitlar, type YerTuru } from '@/lib/kayitlar';
import { useKonum } from '@/lib/konum';
import { durakDetayiGetir, type Hat } from '@/lib/otp';
import { useCanliAralik } from '@/lib/canli-aralik';
import { baslikYap, hatEtiketi, rozetRenkleri, useTema, type Tema } from '@/lib/tema';
import { ekranAc } from '@/lib/gezinti';
import { useScrollToTop } from 'expo-router';

const YER_ADI: Record<YerTuru, string> = { ev: 'Ev', is: 'İş' };

/**
 * Favori durakların sıradaki kalkışı: durak kimliği → kalkış (an: Unix saniyesi, hat, yön);
 * "yok": bugün sefer kalmadı; "hata": sorulamadı. Kayıt yoksa yükleniyor.
 */
type SiradakiKalkis = { an: number; hat: Hat | null; yon: string };
type Dakikalar = Record<string, SiradakiKalkis | 'yok' | 'hata'>;
/** Sekme açıkken bu aralıkla yenilenir (sekmeye dönünce hemen). */
const YENILEME_MS = 30_000;

export default function KayitliEkrani() {
  // Seçili sekmeye yeniden dokununca liste başa kayar (iPhone'daki gibi).
  const liste = useRef<ScrollView>(null);
  useScrollToTop(liste);
  const kenar = useSafeAreaInsets();
  const tema = useTema();
  const s = useStiller(stiller);
  const konum = useKonum();
  const { yerler, favoriler, favoriYerler, aramalar } = useKayitlar();

  const [dakikalar, setDakikalar] = useState<Dakikalar>({});
  const [yenileniyor, setYenileniyor] = useState(false);

  const kalkislariYukle = useCallback(async () => {
    if (!favoriler.length) return;
    const sonuc: Dakikalar = {};
    await Promise.all(
      favoriler.map(async (f) => {
        try {
          const durak = await durakDetayiGetir(f.gtfsId);
          const simdi = Date.now() / 1000 - 30;
          const sirada = (durak?.kalkislar ?? [])
            .map((k) => ({ k, an: (k.serviceDay ?? 0) + (k.realtimeDeparture ?? k.scheduledDeparture ?? 0) }))
            .filter((x) => x.an >= simdi)
            .sort((a, b) => a.an - b.an)[0];
          sonuc[f.gtfsId] = sirada
            ? {
                an: sirada.an,
                hat: sirada.k.trip?.route ?? null,
                yon: baslikYap(sirada.k.trip?.pattern?.headsign ?? sirada.k.headsign ?? ''),
              }
            : 'yok';
        } catch {
          sonuc[f.gtfsId] = 'hata';
        }
      }),
    );
    setDakikalar(sonuc);
  }, [favoriler]);

  useEffect(() => {
    kalkislariYukle();
  }, [kalkislariYukle]);
  // Sekme açıkken yenilenir; başka sekmedeyken durur, dönünce hemen tazelenir. Eskiden
  // yalnız açılışta yükleniyordu: "7 dk" değişmeden kalıyordu.
  useCanliAralik(kalkislariYukle, YENILEME_MS, favoriler.length > 0);

  const evIsMenusu = (tur: YerTuru, ad: string) => {
    Haptics.selectionAsync().catch(() => {});
    Alert.alert(YER_ADI[tur], baslikYap(ad), [
      { text: 'Değiştir', onPress: () => ekranAc({ pathname: '/ara', params: { kaydet: tur } }) },
      { text: 'Kaldır', style: 'destructive', onPress: () => yerSil(tur) },
      { text: 'Vazgeç', style: 'cancel' },
    ]);
  };

  const hedefeGit = (hedef: { ad: string; lat: number; lon: number }) =>
    ekranAc({
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

  // Kaydırılan içerik durum çubuğunun altında başlar ve orada kesilir: eskiden başlık
  // kaydırılınca saatin üstüne biniyordu. (Yenileme göstergesi de durum çubuğunun altında.)
  return (
    <View style={[s.kok, { paddingTop: kenar.top }]}>
      <ScrollView
        ref={liste}
        style={s.kok}
        contentContainerStyle={{ paddingTop: 6, paddingBottom: kenar.bottom + 24 }}
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
                onPress={() => (yer ? hedefeGit(yer) : ekranAc({ pathname: '/ara', params: { kaydet: tur } }))}
                // Basılı tutunca değiştir ya da kaldır (eskiden kaydedilen yer değiştirilemiyordu).
                onLongPress={yer ? () => evIsMenusu(tur, yer.ad) : undefined}
                accessibilityRole="button"
                accessibilityLabel={`${YER_ADI[tur]}${yer ? `: ${baslikYap(yer.ad)}` : ', ekle'}`}
                accessibilityHint={yer ? 'Rota açılır. Değiştirmek ya da kaldırmak için basılı tut.' : undefined}
                accessibilityActions={
                  yer
                    ? [
                        { name: 'degistir', label: 'Değiştir' },
                        { name: 'kaldir', label: 'Kaldır' },
                      ]
                    : undefined
                }
                onAccessibilityAction={(e) => {
                  if (e.nativeEvent.actionName === 'degistir') ekranAc({ pathname: '/ara', params: { kaydet: tur } });
                  if (e.nativeEvent.actionName === 'kaldir') yerSil(tur);
                }}
              >
                <View style={s.kartIkon}>
                  <Ikon ad={tur === 'ev' ? 'home' : 'briefcase'} boyut={17} renkKodu={tema.vurgu} />
                </View>
                <Text style={s.kartBaslik}>{YER_ADI[tur]}</Text>
                <Text style={s.kartAlt} numberOfLines={1}>
                  {yer ? baslikYap(yer.ad) : 'Ekle'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={s.bolumBaslik}>FAVORİ YERLER</Text>
        {/* Kaydırma ipucu her satırda değil, bölümün başında bir kez. */}
        {favoriYerler.length > 0 && <Text style={s.ipucu}>Silmek için satırı sola kaydır.</Text>}
        {favoriYerler.length === 0 ? (
          <Text style={s.bos}>
            Henüz favori yerin yok. Ana ekranda haritaya basılı tutup "Favorilere ekle"ye dokunarak ekleyebilirsin.
          </Text>
        ) : (
          <View style={s.liste}>
            {favoriYerler.map((y) => (
              <KaydirmaliSatir key={`${y.lat},${y.lon}`} onSil={() => favoriYerDegistir(y)} silEtiketi="Favorilerden çıkar">
                <Pressable style={s.satir} onPress={() => hedefeGit(y)} accessibilityRole="button">
                  <View style={s.satirIkon}>
                    <Ikon ad="star" boyut={17} renkKodu={tema.vurgu} />
                  </View>
                  <View style={s.satirMetin}>
                    <Text style={s.satirBaslik} numberOfLines={1}>
                      {y.ad}
                    </Text>
                    {!!y.alt && (
                      <Text style={s.satirAlt} numberOfLines={1}>
                        {y.alt}
                      </Text>
                    )}
                  </View>
                  <Ikon ad="chevron-forward" boyut={16} renkKodu={tema.soluk} />
                </Pressable>
              </KaydirmaliSatir>
            ))}
          </View>
        )}

        <Text style={s.bolumBaslik}>FAVORİ DURAKLAR</Text>
        {favoriler.length > 0 && <Text style={s.ipucu}>Silmek için satırı sola kaydır.</Text>}
        {favoriler.length === 0 ? (
          <Text style={s.bos}>
            Henüz favori durağın yok. Bir durak ekranını açıp yıldızlı düğmeye basarak buraya ekleyebilirsin.
          </Text>
        ) : (
          <View style={s.liste}>
            {favoriler.map((f) => (
              <KaydirmaliSatir key={f.gtfsId} onSil={() => favoriDegistir(f)} silEtiketi="Favorilerden çıkar">
                <Pressable
                  style={s.satir}
                  onPress={() => ekranAc({ pathname: '/durak/[id]', params: { id: f.gtfsId } })}
                  accessibilityRole="button"
                >
                  <View style={s.satirIkon}>
                    <Ikon ad="star" boyut={17} renkKodu={tema.vurgu} />
                  </View>
                  <View style={s.satirMetin}>
                    <Text style={s.satirBaslik} numberOfLines={1}>
                      {baslikYap(f.ad)}
                    </Text>
                    <FavoriKalkisAlti k={dakikalar[f.gtfsId]} />
                  </View>
                  <FavoriKalkisi k={dakikalar[f.gtfsId]} />
                </Pressable>
              </KaydirmaliSatir>
            ))}
          </View>
        )}

        <View style={s.bolumSatiri}>
          <Text style={s.bolumBaslik}>SON ARAMALAR</Text>
          {aramalar.length > 0 && (
            <Pressable
              onPress={() =>
                Alert.alert(
                  'Son aramalar silinsin mi?',
                  `${aramalar.length} arama kaydı silinecek. Ev, İş, favori yerlerin ve durakların yerinde kalır.`,
                  [
                    { text: 'Vazgeç', style: 'cancel' },
                    { text: 'Sil', style: 'destructive', onPress: () => aramalariTemizle() },
                  ],
                )
              }
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Son aramaları temizle"
            >
              <Text style={s.temizle}>Temizle</Text>
            </Pressable>
          )}
        </View>
        {aramalar.length === 0 ? (
          <Text style={s.bos}>Aradığın yerler burada birikecek.</Text>
        ) : (
          <View style={s.liste}>
            {/* Sola kaydırınca silinir. Anahtar kayda bağlı: sıra numarası olsaydı silinen satırın
                kapanmış yüksekliği alttaki kayda geçerdi. */}
            {aramalar.map((a) => (
              <KaydirmaliSatir key={`${a.lat},${a.lon},${a.ad}`} onSil={() => aramaSil(a)} silEtiketi="Aramayı sil">
                <Pressable style={s.satir} onPress={() => hedefeGit(a)} accessibilityRole="button">
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
                  <Ikon ad="chevron-forward" boyut={16} renkKodu={tema.soluk} />
                </Pressable>
              </KaydirmaliSatir>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

/** Favori durak satırının alt yazısı: sıradaki kalkışın hattı ve yönü, ya da durumu. */
function FavoriKalkisAlti({ k }: { k: Dakikalar[string] | undefined }) {
  const tema = useTema();
  const s = useStiller(stiller);
  if (k === undefined) return <View style={[s.yukleniyorCubugu, { backgroundColor: tema.cizgi }]} />;
  if (k === 'yok') return <Text style={s.satirAlt}>Bugün sefer kalmadı</Text>;
  if (k === 'hata') return <Text style={s.satirAlt}>Bağlantı yok</Text>;
  const renk = k.hat ? rozetRenkleri(k.hat, tema) : null;
  const kod = k.hat ? hatEtiketi(k.hat.shortName, k.hat.mode, k.hat.agency?.name).rozet : '';
  return (
    <View style={s.kalkisAlti}>
      {!!kod && renk && <Text style={[s.hatKodu, { backgroundColor: renk.zemin, color: renk.yazi }]}>{kod}</Text>}
      {!!k.yon && (
        <Text style={[s.satirAlt, { flexShrink: 1 }]} numberOfLines={1}>
          {`${k.yon} yönü`}
        </Text>
      )}
    </View>
  );
}

/** Favori durak satırının sağı: dakika (30 sn'de bir yenilenen veriyle), yüklenirken gri çubuk. */
function FavoriKalkisi({ k }: { k: Dakikalar[string] | undefined }) {
  const tema = useTema();
  const s = useStiller(stiller);
  if (k === undefined) return <View style={[s.yukleniyorCubugu, { width: 34, backgroundColor: tema.cizgi }]} />;
  if (typeof k === 'string') return null;
  return <Dakika an={k.an} />;
}

const stiller = (t: Tema) =>
  StyleSheet.create({
    kok: { flex: 1, backgroundColor: t.zemin },
    baslik: { fontSize: 34, fontWeight: '700', color: t.yazi, letterSpacing: 0.37, paddingHorizontal: 16, paddingBottom: 14 },
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
    ipucu: { fontSize: 11.5, color: t.soluk, paddingHorizontal: 16, marginTop: -2, marginBottom: 6 },
    kalkisAlti: { flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 0 },
    hatKodu: { fontSize: 11, fontWeight: '800', paddingHorizontal: 5, borderRadius: 5, overflow: 'hidden' },
    yukleniyorCubugu: { height: 10, width: 90, borderRadius: 5, marginTop: 3 },
    bos: { color: t.soluk, fontSize: 13, lineHeight: 19, paddingHorizontal: 16, paddingBottom: 6 },
  });
