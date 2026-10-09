// Tarife: bir hattın bir duraktan bütün günkü kalkışları, saat saat.
//
// Hat ekranındaki "… durağından tarife" düğmesiyle açılıyor (ya da hat ekranında bir
// durağa basılı tutunca). Üstte Hafta içi / Cumartesi / Pazar; bugünün türü seçili
// açılıyor. Bugünün tablosunda geçmiş kalkışlar soluk, sıradaki vurgulu ve tablo şimdiki
// saate kayıyor. Görünüm iPhone'un kendi başlığı ve geri düğmesiyle (‹ 15F).
//
// Saatli seferi olmayan hatlar (Tünel F2, F3, minibüs, dolmuş): veride yalnız "07:56–21:00
// arası her 5 dk" gibi pencereler var (assets/veri/siklik.json). OTP bunları durak
// kalkışlarında vermediği için tablo boş gelince bu pencereler gösteriliyor: üstte "Şu an
// her 5 dk", altında günün aralıkları. Minibüs ve dolmuş hat ekranından `siklik=1` ile,
// durak seçmeden açılıyor (sıklık bütün hattın).

import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Pressable } from '@/components/dokun';
import { HataKutusu, HatRozeti, useStiller, Yukleniyor } from '@/components/ulasim';
import { isletmeciAdi } from '@/lib/hat-adi';
import { secimTiki } from '@/lib/dokunsal';
import { istanbulTarihi } from '@/lib/ozel-gunler';
import { OZEL_GUNLER } from '@/lib/ozel-gun-verisi';
import { durakTarifesiGetir, OtpHatasi } from '@/lib/otp';
import { dakikadanSaat, gununPencereleri, istanbulAni, siklikSimdi, type GunPenceresi, type SiklikSimdi } from '@/lib/siklik';
import { hatPencereleri } from '@/lib/siklik-verisi';
import {
  bugununTarifesi,
  saatlereBol,
  siradakiKalkis,
  TARIFE_GUNLERI,
  tarifeTarihleri,
  type TarifeGunu,
} from '@/lib/tarife';
import { baslikYap, hatEtiketi, useTema, type Tema } from '@/lib/tema';

type Parametreler = {
  /** Yalnız sıklıkla açılınca (siklik=1) yok. */
  durak?: string;
  durakAd?: string;
  /** Virgülle ayrılmış desen kodları: hattın bu yöndeki desenleri. */
  desenler?: string;
  baslik?: string;
  kisaAd?: string;
  mod?: string;
  renk?: string;
  isletmeci?: string;
  /** GTFS route_long_name: kodlu minibüste sıklık "KOD|GÜZERGÂH" ile bulunuyor. */
  uzunAd?: string;
  /** "1": durak yok, yalnız hattın sefer sıklığı (minibüs, dolmuş). */
  siklik?: string;
};

/** "20261005" → 0 (pazartesi) … 6 (pazar). */
function haftaGunu(gun: string): number {
  const d = new Date(Date.UTC(+gun.slice(0, 4), +gun.slice(4, 6) - 1, +gun.slice(6, 8)));
  return (d.getUTCDay() + 6) % 7;
}

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
  const yalnizSiklik = p.siklik === '1' || !p.durak;
  const pencereler = useMemo(() => hatPencereleri(p.kisaAd, p.uzunAd), [p.kisaAd, p.uzunAd]);

  const bugun = istanbulTarihi(Date.now());
  const tarihler = useMemo(() => tarifeTarihleri(bugun, OZEL_GUNLER), [bugun]);
  const bugununTuru = useMemo(() => bugununTarifesi(bugun, OZEL_GUNLER), [bugun]);
  const [gun, setGun] = useState<TarifeGunu>(bugununTuru);

  // Her günün tablosu bir kez çekiliyor; günler arasında gidip gelince yeniden sorulmuyor.
  const [tablolar, setTablolar] = useState<Partial<Record<TarifeGunu, number[]>>>({});
  const [hata, setHata] = useState<string | null>(null);
  const yukle = useCallback(
    async (tur: TarifeGunu, sinyal?: AbortSignal) => {
      if (!p.durak) return;
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
    if (eldeki || yalnizSiklik) return;
    const iptal = new AbortController();
    yukle(gun, iptal.signal);
    return () => iptal.abort();
  }, [gun, eldeki, yukle, yalnizSiklik]);

  const satirlar = useMemo(() => (eldeki ? saatlereBol(eldeki) : []), [eldeki]);
  const bugunMu = gun === bugununTuru;
  // Saatli tablo boşsa ve hattın sıklık verisi varsa pencereler gösterilir.
  const siklikModu = !!pencereler && (yalnizSiklik || (!!eldeki && satirlar.length === 0));
  const gunPencereleri = useMemo(() => {
    const g = haftaGunu(tarihler[gun]);
    return { bugun: gununPencereleri(pencereler, g), dun: gununPencereleri(pencereler, (g + 6) % 7) };
  }, [pencereler, tarihler, gun]);
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

  // Kodsuz minibüsün kısa adı güzergâhın kendisi; geri düğmesinde rozetteki ad.
  const kisaAd = hatEtiketi(p.kisaAd, p.mod, p.isletmeci).rozet || 'Hat';
  const tasit = isletmeciAdi(p.isletmeci);
  const hat = { shortName: p.kisaAd, mode: p.mod, color: p.renk, agency: p.isletmeci ? { name: p.isletmeci } : null };

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: yalnizSiklik ? 'Sefer sıklığı' : 'Tarife',
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
              {yalnizSiklik
                ? `${tasit || 'Hat'} · belli aralıklarla`
                : `${baslikYap(p.durakAd) || 'Bu durak'} durağından ${siklikModu ? '· belli aralıklarla' : 'kalkışlar'}`}
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

        {hata && !siklikModu && <HataKutusu mesaj={hata} tekrarDene={() => yukle(gun)} />}
        {!hata && !eldeki && !siklikModu && <Yukleniyor metin="Tarife yükleniyor…" />}
        {siklikModu && (
          <SiklikGorunumu
            gunluk={gunPencereleri.bugun}
            simdi={bugunMu ? siklikSimdi(gunPencereleri.bugun, gunPencereleri.dun, istanbulAni(Date.now()).dakika) : null}
            bosMetin={`${tarihYaz(tarihler[gun])} ${yalnizSiklik ? 'bu hatta' : 'bu duraktan bu yöne'} sefer yok.`}
            dipnot={
              tasit
                ? `${tasit === 'Dolmuş' ? 'Dolmuşların' : 'Minibüslerin'} saatli tarifesi yok; bu aralıklarla kalkıyorlar. Yoğunluğa göre değişebilir.`
                : 'Bu hattın saatli tarifesi yok; araçlar bu aralıklarla kalkıyor. Saatler hattın başından kalkışa göre.'
            }
            altBosluk={kenar.bottom + 24}
          />
        )}
        {!hata && !siklikModu && eldeki && satirlar.length === 0 && (
          <Text style={s.bos}>{`${tarihYaz(tarihler[gun])} bu duraktan bu yöne sefer yok.`}</Text>
        )}

        {!siklikModu && satirlar.length > 0 && (
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

/**
 * Saatli seferi olmayan hattın günü: üstte (yalnız bugün) "Şu an her 5 dk" kutusu,
 * altında aralıklar (şu anki vurgulu, geçenler soluk), en altta ilk ve son sefer.
 */
function SiklikGorunumu({
  gunluk,
  simdi,
  bosMetin,
  dipnot,
  altBosluk,
}: {
  gunluk: GunPenceresi[];
  simdi: SiklikSimdi | null;
  bosMetin: string;
  dipnot: string;
  altBosluk: number;
}) {
  const s = useStiller(stiller);
  if (!gunluk.length && !simdi) return <Text style={s.bos}>{bosMetin}</Text>;
  const dakika = istanbulAni(Date.now()).dakika;
  const ilk = gunluk.length ? Math.min(...gunluk.map((p) => p.bas)) : null;
  const son = gunluk.length ? Math.max(...gunluk.map((p) => p.bit)) : null;
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: altBosluk }}>
      {simdi && (
        <View style={s.simdiKutu} accessible accessibilityLabel={[simdi.ana, simdi.ek].filter(Boolean).join(', ')}>
          <View style={s.simdiNokta} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.simdiAna}>{simdi.ana}</Text>
            {!!simdi.ek && <Text style={s.simdiEk}>{simdi.ek}</Text>}
          </View>
        </View>
      )}
      {gunluk.length > 0 ? (
        <View style={s.tablo}>
          {gunluk.map((p, i) => {
            const simdiki = !!simdi && simdi.simdiki === i;
            const gecti = !!simdi && !simdiki && p.bit <= dakika;
            return (
              <View
                key={`${p.bas}-${p.bit}-${p.aralik}`}
                style={[s.pencere, i > 0 && s.ayrac, simdiki && s.pencereSimdi, gecti && { opacity: 0.45 }]}
                accessible
                accessibilityLabel={`${dakikadanSaat(p.bas)} ile ${dakikadanSaat(p.bit)} arası her ${p.aralik} dakika${simdiki ? ', şu an' : ''}`}
              >
                <View style={s.pencereAra}>
                  <Text style={s.pencereSaat}>{`${dakikadanSaat(p.bas)} – ${dakikadanSaat(p.bit)}`}</Text>
                  {simdiki && <Text style={s.simdiEtiket}>ŞU AN</Text>}
                </View>
                <Text style={[s.pencereHer, simdiki && s.vurguYazi]}>{`her ${p.aralik} dk`}</Text>
              </View>
            );
          })}
        </View>
      ) : (
        <Text style={s.bos}>{bosMetin}</Text>
      )}
      {ilk != null && son != null && (
        <View style={s.ilkSon}>
          <View style={s.ilkSonKutu}>
            <Text style={s.ilkSonBaslik}>İLK SEFER</Text>
            <Text style={s.ilkSonSaat}>{dakikadanSaat(ilk)}</Text>
          </View>
          <View style={s.ilkSonKutu}>
            <Text style={s.ilkSonBaslik}>SON SEFER</Text>
            <Text style={s.ilkSonSaat}>{dakikadanSaat(son)}</Text>
          </View>
        </View>
      )}
      <Text style={s.dipnot}>{dipnot}</Text>
    </ScrollView>
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
    simdiKutu: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: t.vurguAcik,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: 10,
    },
    simdiNokta: { width: 9, height: 9, borderRadius: 5, backgroundColor: t.vurgu },
    simdiAna: { fontSize: 15, fontWeight: '700', color: t.vurgu },
    simdiEk: { fontSize: 12.5, color: t.soluk, marginTop: 2 },
    pencere: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
    pencereSimdi: { backgroundColor: t.vurguAcik, borderLeftWidth: 3, borderLeftColor: t.vurgu, paddingLeft: 11 },
    pencereAra: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
    pencereSaat: { fontSize: 15, color: t.yazi, fontVariant: ['tabular-nums'] },
    pencereHer: { fontSize: 15, fontWeight: '700', color: t.yazi, fontVariant: ['tabular-nums'] },
    vurguYazi: { color: t.vurgu },
    simdiEtiket: {
      fontSize: 10.5,
      fontWeight: '800',
      color: t.vurguYazi,
      backgroundColor: t.vurgu,
      borderRadius: 4,
      overflow: 'hidden',
      paddingHorizontal: 5,
      paddingVertical: 1,
    },
    ilkSon: { flexDirection: 'row', gap: 10, marginTop: 10 },
    ilkSonKutu: { flex: 1, backgroundColor: t.yuzey, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
    ilkSonBaslik: { fontSize: 11.5, color: t.soluk, letterSpacing: 0.4 },
    ilkSonSaat: { fontSize: 17, fontWeight: '700', color: t.yazi, marginTop: 2, fontVariant: ['tabular-nums'] },
  });
