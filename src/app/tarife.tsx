// Tarife: bir hattın bir duraktan bütün günkü kalkışları, saat saat.
//
// Hat ekranındaki "… durağından tarife" düğmesiyle açılıyor (ya da hat ekranında bir
// durağa basılı tutunca). Üstte Hafta içi / Cumartesi / Pazar; bugünün türü seçili
// açılıyor. Bugünün tablosunda geçmiş kalkışlar soluk, sıradaki vurgulu ve tablo şimdiki
// saate kayıyor. Görünüm iPhone'un kendi başlığı ve geri düğmesiyle (‹ 15F).

import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Pressable } from '@/components/dokun';
import { HataKutusu, HatRozeti, useStiller, Yukleniyor } from '@/components/ulasim';
import { secimTiki } from '@/lib/dokunsal';
import { istanbulTarihi } from '@/lib/ozel-gunler';
import { OZEL_GUNLER } from '@/lib/ozel-gun-verisi';
import { durakTarifesiGetir, OtpHatasi } from '@/lib/otp';
import {
  bugununTarifesi,
  saatlereBol,
  siradakiKalkis,
  TARIFE_GUNLERI,
  tarifeTarihleri,
  type TarifeGunu,
} from '@/lib/tarife';
import { baslikYap, useTema, type Tema } from '@/lib/tema';

type Parametreler = {
  durak: string;
  durakAd?: string;
  /** Virgülle ayrılmış desen kodları: hattın bu yöndeki desenleri. */
  desenler?: string;
  baslik?: string;
  kisaAd?: string;
  mod?: string;
  renk?: string;
  isletmeci?: string;
};

/** "20261005" → "5 Ekim Pazartesi" */
function tarihYaz(gun: string): string {
  const d = new Date(`${gun.slice(0, 4)}-${gun.slice(4, 6)}-${gun.slice(6, 8)}T12:00:00Z`);
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long', timeZone: 'UTC' });
}

export default function TarifeEkrani() {
  const kenar = useSafeAreaInsets();
  const tema = useTema();
  const s = useStiller(stiller);
  const p = useLocalSearchParams<Parametreler>();
  const desenler = useMemo(() => (p.desenler ? p.desenler.split(',').filter(Boolean) : []), [p.desenler]);

  const bugun = istanbulTarihi(Date.now());
  const tarihler = useMemo(() => tarifeTarihleri(bugun, OZEL_GUNLER), [bugun]);
  const bugununTuru = useMemo(() => bugununTarifesi(bugun, OZEL_GUNLER), [bugun]);
  const [gun, setGun] = useState<TarifeGunu>(bugununTuru);

  // Her günün tablosu bir kez çekiliyor; günler arasında gidip gelince yeniden sorulmuyor.
  const [tablolar, setTablolar] = useState<Partial<Record<TarifeGunu, number[]>>>({});
  const [hata, setHata] = useState<string | null>(null);
  const yukle = useCallback(
    async (tur: TarifeGunu, sinyal?: AbortSignal) => {
      setHata(null);
      try {
        const saniyeler = await durakTarifesiGetir(p.durak, desenler, tarihler[tur], sinyal);
        setTablolar((t) => ({ ...t, [tur]: saniyeler }));
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        setHata(e instanceof OtpHatasi ? e.message : 'Tarife yüklenemedi.');
      }
    },
    [p.durak, desenler, tarihler],
  );
  const eldeki = tablolar[gun];
  useEffect(() => {
    if (eldeki) return;
    const iptal = new AbortController();
    yukle(gun, iptal.signal);
    return () => iptal.abort();
  }, [gun, eldeki, yukle]);

  const satirlar = useMemo(() => (eldeki ? saatlereBol(eldeki) : []), [eldeki]);
  const bugunMu = gun === bugununTuru;
  // İstanbul saatiyle gün başından saniye.
  const simdi = Math.floor((Date.now() / 1000 + 3 * 3600) % 86_400);
  const siradaki = bugunMu ? siradakiKalkis(satirlar, simdi) : null;

  // Bugünün tablosu açılınca şimdiki saate kaydır (bir saat öncesi de görünsün).
  const kaydirma = useRef<ScrollView>(null);
  const kaydirildi = useRef<TarifeGunu | null>(null);
  const satirKonumu = (saat: number, y: number) => {
    if (!bugunMu || kaydirildi.current === gun) return;
    const simdikiSaat = Math.floor(simdi / 3600);
    if (saat !== Math.max(0, simdikiSaat - 1) && saat !== simdikiSaat) return;
    kaydirildi.current = gun;
    kaydirma.current?.scrollTo({ y: Math.max(0, y - 8), animated: false });
  };

  const kisaAd = p.kisaAd || 'Hat';
  const hat = { shortName: p.kisaAd, mode: p.mod, color: p.renk, agency: p.isletmeci ? { name: p.isletmeci } : null };

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Tarife',
          headerBackTitle: kisaAd,
          headerTintColor: tema.vurgu,
          headerTitleStyle: { color: tema.yazi },
          headerStyle: { backgroundColor: tema.zemin },
          headerShadowVisible: false,
          headerTransparent: false,
        }}
      />
      <View style={s.kok}>
        <View style={s.ust}>
          <HatRozeti hat={hat} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.baslik} numberOfLines={1}>
              {p.baslik || kisaAd}
            </Text>
            <Text style={s.alt} numberOfLines={1}>
              {`${baslikYap(p.durakAd) || 'Bu durak'} durağından kalkışlar`}
            </Text>
          </View>
        </View>

        <View style={s.secici} accessibilityRole="tablist">
          {TARIFE_GUNLERI.map(([tur, ad]) => {
            const secili = tur === gun;
            return (
              <Pressable
                key={tur}
                geriBildirim={false}
                style={[s.secenek, secili && s.secenekSecili]}
                onPress={() => {
                  if (secili) return;
                  secimTiki();
                  setGun(tur);
                }}
                accessibilityRole="tab"
                accessibilityState={{ selected: secili }}
              >
                <Text style={[s.secenekYazi, secili && s.secenekYaziSecili]}>{ad}</Text>
              </Pressable>
            );
          })}
        </View>

        {hata && <HataKutusu mesaj={hata} tekrarDene={() => yukle(gun)} />}
        {!hata && !eldeki && <Yukleniyor metin="Tarife yükleniyor…" />}
        {!hata && eldeki && satirlar.length === 0 && (
          <Text style={s.bos}>{`${tarihYaz(tarihler[gun])} bu duraktan bu yöne sefer yok.`}</Text>
        )}

        {satirlar.length > 0 && (
          <ScrollView
            ref={kaydirma}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: kenar.bottom + 24 }}
          >
            <View style={s.tablo}>
              {satirlar.map((satir, i) => {
                const simdikiSatir =
                  bugunMu && satir.kalkislar.some((k) => Math.floor(k.saniye / 3600) === Math.floor(simdi / 3600));
                return (
                  <View
                    key={`${satir.kalkislar[0].saniye}`}
                    style={[s.satir, i > 0 && s.ayrac]}
                    onLayout={(e) => satirKonumu(satir.saat, e.nativeEvent.layout.y)}
                    accessible
                    accessibilityLabel={`Saat ${satir.saat}: ${satir.kalkislar.map((k) => String(k.dakika)).join(', ')} geçe`}
                  >
                    <View style={[s.saat, simdikiSatir && { backgroundColor: tema.vurgu }]}>
                      <Text style={[s.saatYazi, simdikiSatir && { color: tema.vurguYazi }]}>
                        {String(satir.saat).padStart(2, '0')}
                      </Text>
                    </View>
                    <View style={s.dakikalar}>
                      {satir.kalkislar.map((k) => {
                        const gecti = bugunMu && k.saniye < simdi;
                        const sirada = k.saniye === siradaki;
                        return (
                          <Text
                            key={k.saniye}
                            style={[s.dakika, gecti && { color: tema.soluk, opacity: 0.55 }, sirada && s.siradaki]}
                          >
                            {String(k.dakika).padStart(2, '0')}
                          </Text>
                        );
                      })}
                    </View>
                  </View>
                );
              })}
            </View>
            <Text style={s.dipnot}>
              {`${tarihYaz(tarihler[gun])} tarifesi. Saatler tarifeye göre; otobüsler trafiğe göre gecikebilir.`}
            </Text>
          </ScrollView>
        )}
      </View>
    </>
  );
}

const stiller = (t: Tema) =>
  StyleSheet.create({
    kok: { flex: 1, backgroundColor: t.zemin },
    ust: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12 },
    baslik: { fontSize: 17, fontWeight: '700', color: t.yazi },
    alt: { fontSize: 13, color: t.soluk, marginTop: 2 },
    secici: {
      flexDirection: 'row',
      marginHorizontal: 16,
      marginBottom: 12,
      padding: 2,
      borderRadius: 9,
      backgroundColor: t.cizgi,
    },
    secenek: { flex: 1, height: 32, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
    secenekSecili: {
      backgroundColor: t.yuzey,
      shadowColor: '#000',
      shadowOpacity: 0.12,
      shadowRadius: 3,
      shadowOffset: { width: 0, height: 1 },
      elevation: 1,
    },
    secenekYazi: { fontSize: 13.5, fontWeight: '500', color: t.yazi },
    secenekYaziSecili: { fontWeight: '700' },
    bos: { color: t.soluk, textAlign: 'center', padding: 24, lineHeight: 20 },
    tablo: { backgroundColor: t.yuzey, borderRadius: 12, overflow: 'hidden' },
    satir: { flexDirection: 'row', alignItems: 'stretch' },
    ayrac: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.cizgi },
    saat: { width: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: t.yuzeyIkincil, paddingVertical: 9 },
    saatYazi: { fontSize: 15, fontWeight: '800', color: t.yazi, fontVariant: ['tabular-nums'] },
    dakikalar: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 12, rowGap: 4, paddingHorizontal: 12, paddingVertical: 9 },
    dakika: { fontSize: 15, color: t.yazi, fontVariant: ['tabular-nums'] },
    siradaki: {
      color: t.vurguYazi,
      backgroundColor: t.vurgu,
      fontWeight: '700',
      borderRadius: 5,
      overflow: 'hidden',
      paddingHorizontal: 4,
    },
    dipnot: { fontSize: 12.5, color: t.soluk, lineHeight: 17, paddingHorizontal: 16, paddingTop: 10 },
  });
