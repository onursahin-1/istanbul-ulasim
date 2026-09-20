// Hat detayı: seçilen hattın yönleri ve o yöndeki durak sırası.
//
// Bir hattın her yönü rota motorunda ayrı bir "desen" (pattern) olarak durur.
// Bazı hatlarda ring seferi ya da kısa güzergâh gibi ek desenler de bulunur;
// bunlar da yön seçeneği olarak listelenir.

import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HataKutusu, HatRozeti, Ikon, useStiller, Yukleniyor } from '@/components/ulasim';
import { hatDetayiGetir, OtpHatasi, type HatDetayi } from '@/lib/otp';
import { aracAdi, baslikYap, hatRengi, hatYaziRengi, useTema, type Tema } from '@/lib/tema';

export default function HatEkrani() {
  const kenar = useSafeAreaInsets();
  const tema = useTema();
  const s = useStiller(stiller);
  const { id } = useLocalSearchParams<{ id: string }>();

  const [hat, setHat] = useState<HatDetayi | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [yon, setYon] = useState(0);

  const yukle = useCallback(async () => {
    if (!id) return;
    setHata(null);
    try {
      const sonuc = await hatDetayiGetir(id);
      if (!sonuc) setHata('Bu hat bulunamadı.');
      else setHat(sonuc);
    } catch (e) {
      setHata(e instanceof OtpHatasi ? e.message : 'Hat bilgisi yüklenemedi.');
    }
  }, [id]);

  useEffect(() => {
    yukle();
  }, [yukle]);

  // Duraksız desenler listeye girmez; en çok durağı olan desen varsayılan yön olur.
  const desenler = useMemo(() => {
    const liste = (hat?.patterns ?? []).filter((d) => (d.stops?.length ?? 0) > 1);
    return liste.sort((a, b) => (b.stops?.length ?? 0) - (a.stops?.length ?? 0));
  }, [hat]);

  const secili = desenler[Math.min(yon, Math.max(desenler.length - 1, 0))];
  const duraklar = secili?.stops ?? [];
  const renkKodu = hat ? hatRengi(hat, tema) : tema.vurgu;
  const yaziKodu = hat ? hatYaziRengi(hat, tema) : tema.vurguYazi;

  const yonAdi = (d: (typeof desenler)[number] | undefined) => {
    if (!d) return '';
    const bitis = d.stops?.[d.stops.length - 1]?.name;
    return baslikYap(d.headsign) || (bitis ? `${baslikYap(bitis)} yönü` : baslikYap(d.name));
  };

  return (
    <View style={s.kok}>
      <View style={[s.tepe, { backgroundColor: renkKodu, paddingTop: kenar.top + 8 }]}>
        <View style={s.tepeSatir}>
          <Pressable onPress={() => router.back()} accessibilityLabel="Geri" hitSlop={12}>
            <Ikon ad="chevron-back" boyut={24} renkKodu={yaziKodu} />
          </Pressable>
          {hat && <HatRozeti hat={hat} />}
        </View>
        <Text style={[s.tepeBaslik, { color: yaziKodu }]} numberOfLines={2}>
          {baslikYap(hat?.longName) || hat?.shortName || 'Hat'}
        </Text>
        <Text style={[s.tepeAlt, { color: yaziKodu }]}>
          {[hat?.agency?.name, aracAdi(hat?.mode)].filter(Boolean).join(' · ')}
        </Text>
      </View>

      {hata && <HataKutusu mesaj={hata} tekrarDene={yukle} />}
      {!hat && !hata && <Yukleniyor metin="Hat bilgisi yükleniyor…" />}

      {hat && desenler.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.yonSeridi} contentContainerStyle={s.yonlar}>
          {desenler.map((d, i) => {
            const aktif = i === Math.min(yon, desenler.length - 1);
            return (
              <Pressable
                key={d.code}
                onPress={() => setYon(i)}
                style={[s.yon, aktif && { backgroundColor: tema.vurguAcik, borderColor: tema.vurgu }]}
                accessibilityState={{ selected: aktif }}
              >
                <Text style={[s.yonYazi, aktif && { color: tema.vurgu }]} numberOfLines={1}>
                  {yonAdi(d)}
                </Text>
                <Text style={s.yonSayi}>{d.stops?.length ?? 0} durak</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {hat && (
        <ScrollView contentContainerStyle={{ paddingBottom: kenar.bottom + 24 }}>
          {desenler.length === 1 && (
            <Text style={s.tekYon}>{yonAdi(secili)} · {duraklar.length} durak</Text>
          )}
          {duraklar.length === 0 && <Text style={s.bos}>Bu hattın durak bilgisi veride yok.</Text>}
          <View style={s.liste}>
            {duraklar.map((d, i) => {
              const ilk = i === 0;
              const son = i === duraklar.length - 1;
              return (
                <Pressable
                  key={`${d.gtfsId}-${i}`}
                  style={s.durak}
                  onPress={() => router.push({ pathname: '/durak/[id]', params: { id: d.gtfsId } })}
                  accessibilityRole="button"
                >
                  <View style={s.cizgiSutun}>
                    {!ilk && <View style={[s.cizgiUst, { backgroundColor: renkKodu }]} />}
                    {!son && <View style={[s.cizgiAlt, { backgroundColor: renkKodu }]} />}
                    <View
                      style={
                        ilk || son
                          ? [s.noktaUc, { backgroundColor: renkKodu }]
                          : [s.nokta, { borderColor: renkKodu, backgroundColor: tema.yuzey }]
                      }
                    />
                  </View>
                  <Text style={[s.durakAd, (ilk || son) && s.durakAdKalin]} numberOfLines={1}>
                    {baslikYap(d.name)}
                  </Text>
                  <Ikon ad="chevron-forward" boyut={15} renkKodu={tema.yurume} />
                </Pressable>
              );
            })}
          </View>
          <Text style={s.dipnot}>
            Durak sırası rota motorundaki güzergâh desenine göredir. Bir durağa dokunarak yaklaşan seferlerini
            görebilirsin.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const stiller = (t: Tema) =>
  StyleSheet.create({
    kok: { flex: 1, backgroundColor: t.yuzey },
    tepe: { paddingHorizontal: 16, paddingBottom: 16, gap: 10 },
    tepeSatir: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    tepeBaslik: { fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
    tepeAlt: { fontSize: 13, opacity: 0.85 },
    yonSeridi: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.cizgi },
    yonlar: { gap: 8, padding: 12 },
    yon: {
      maxWidth: 230,
      paddingHorizontal: 13,
      paddingVertical: 8,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.cizgi,
      backgroundColor: t.yuzeyIkincil,
      gap: 2,
    },
    yonYazi: { fontSize: 13.5, fontWeight: '700', color: t.yazi },
    yonSayi: { fontSize: 11.5, color: t.soluk },
    tekYon: { fontSize: 13, fontWeight: '600', color: t.soluk, padding: 14 },
    liste: { paddingHorizontal: 16 },
    durak: { flexDirection: 'row', alignItems: 'center', gap: 11, height: 44 },
    cizgiSutun: { width: 16, height: '100%', alignItems: 'center', justifyContent: 'center' },
    cizgiUst: { position: 'absolute', top: 0, height: '50%', width: 3 },
    cizgiAlt: { position: 'absolute', bottom: 0, height: '50%', width: 3 },
    nokta: { width: 10, height: 10, borderRadius: 6, borderWidth: 3 },
    noktaUc: { width: 13, height: 13, borderRadius: 7 },
    durakAd: { flex: 1, fontSize: 14, color: t.yazi },
    durakAdKalin: { fontWeight: '700' },
    bos: { color: t.soluk, textAlign: 'center', padding: 20 },
    dipnot: { color: t.soluk, fontSize: 12, lineHeight: 18, paddingHorizontal: 16, paddingTop: 18 },
  });
