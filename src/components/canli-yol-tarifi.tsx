// Canlı yol tarifi: "Yolculuğu başlat"tan sonraki adım adım görünüm.
//
// Üstte adım sekmeleri (🚶 › 89T › 🚶 › 28T › 🚶), altta sağa-sola kaydırılan adım
// kartları. Her kart yalnız o anda gereken bilgiyi gösteriyor: yürürken mesafe ve
// sıradaki binişe yetişip yetişmediğin, beklerken otobüsün kaç dakika/durak uzakta
// olduğu, otobüsteyken nerede ineceğin. Hangi adımda olunduğunu konum belirliyor
// (src/lib/yolculuk.ts); kaydırarak başka adımlara bakılabiliyor.
//
// Tasarım: C:\otp\Claude outputs\canli-yol-tarifi-maket.html

import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { canliRenk, HatRozeti, Ikon, NabizNoktasi, useStiller, YaklasmaSeridi } from '@/components/ulasim';
import type { YerlesikArac } from '@/lib/arac-konum';
import { kalanYaz, yasYaz } from '@/lib/arac-konum';
import { bacakCanli } from '@/lib/canli';
import type { Bacak } from '@/lib/otp';
import type { SeferBilgisi } from '@/lib/sefer';
import { baslikYap, hatRengi, useTema, type Tema } from '@/lib/tema';
import { aktarmaPayi, binmeIfadesi, siradakiDuraklar, type Adim, type YolculukDurumu } from '@/lib/yolculuk';
import { mesafeYaz, saatYaz, saniyedenSaat, sureYaz } from '@/lib/zaman';

export type YolTarifiVerisi = {
  bacaklar: Bacak[];
  /** Araç bacaklarının durakları (biniş → iniş); yürüyüşte boş. */
  duraklar: { ad: string }[][];
  adimlar: Adim[];
  durum: YolculukDurumu;
  /** Yürüme bacaklarının ilk tarif satırı ("Sağa dön · Bağdat Caddesi"). */
  ilkTarif: (string | null)[];
  binisOtobusleri: Record<number, { otobus: YerlesikArac; kalan: number }>;
  seferler: Record<number, SeferBilgisi>;
  yaklasmaUyarisi: Record<number, boolean>;
  uyariDegistir: (bacak: number) => void;
  hedef?: string;
  /** Saat yazıları için; üst bileşen yarım dakikada bir tazeliyor. */
  simdi: number;
};

const iso = (b: Bacak, uc: 'start' | 'end') => b[uc].estimated?.time ?? b[uc].scheduledTime;
const an = (b: Bacak, uc: 'start' | 'end') => Date.parse(iso(b, uc) ?? '');

/** Sekmede ve listede adımın kısa adı. */
function adimEtiketi(v: YolTarifiVerisi, a: Adim): string {
  if (a.tur === 'yuru') return 'Yürü';
  return v.bacaklar[a.bacak]?.route?.shortName ?? 'Araç';
}

// ---------------------------------------------------------------- sekmeler

/** Üstteki adım sekmeleri: biten soluk ve işaretli, bakılan vurgulu. */
export function AdimSekmeleri({ v, gorunen, sec }: { v: YolTarifiVerisi; gorunen: number; sec: (i: number) => void }) {
  const tema = useTema();
  const s = useStiller(stiller);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.sekmeler} contentContainerStyle={s.sekmeIc}>
      {v.adimlar.map((a, i) => {
        const bitti = i < v.durum.adim || (v.durum.faz === 'vardi' && i === v.durum.adim);
        const bakilan = i === gorunen;
        const b = v.bacaklar[a.bacak];
        const renk = a.tur === 'arac' ? hatRengi(b?.route, tema) : tema.yazi;
        return (
          <View key={i} style={s.sekmeSarici}>
            {i > 0 && <Text style={s.ayrac}>›</Text>}
            <Pressable
              onPress={() => sec(i)}
              style={[s.sekme, bakilan && { borderColor: renk, backgroundColor: tema.vurguAcik }, bitti && s.sekmeBitti]}
              accessibilityRole="tab"
              accessibilityState={{ selected: bakilan }}
              accessibilityLabel={`Adım ${i + 1}: ${adimEtiketi(v, a)}${bitti ? ', tamamlandı' : ''}`}
              hitSlop={4}
            >
              {a.tur === 'yuru' ? (
                <Ikon ad="walk" boyut={14} renkKodu={bakilan ? tema.yazi : tema.soluk} />
              ) : (
                <Text style={[s.sekmeYazi, { color: renk }]}>{b?.route?.shortName ?? '•'}</Text>
              )}
              {bitti && <Ikon ad="checkmark" boyut={11} renkKodu={tema.soluk} />}
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}

// ---------------------------------------------------------------- kartlar

/**
 * Alttaki adım kartları. Sağa-sola kaydırılıyor; bakılan adım `gorunen`. Kart
 * alanının yüksekliği `onBoy` ile bildiriliyor (harita o kadar boşluk bıraksın).
 */
export function AdimKartlari({
  v,
  gorunen,
  sec,
  onBitir,
  onTumAdimlar,
  onBoy,
}: {
  v: YolTarifiVerisi;
  gorunen: number;
  sec: (i: number) => void;
  onBitir: () => void;
  onTumAdimlar: () => void;
  onBoy: (boy: number) => void;
}) {
  const tema = useTema();
  const s = useStiller(stiller);
  const kenar = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const liste = useRef<ScrollView>(null);
  const kaydiriliyor = useRef(false);

  // Bakılan adım dışarıdan değişince (sekme, kendiliğinden geçiş) kart oraya kaysın.
  useEffect(() => {
    if (kaydiriliyor.current) return;
    liste.current?.scrollTo({ x: gorunen * width, animated: true });
  }, [gorunen, width]);

  const kaydirmaBitti = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    kaydiriliyor.current = false;
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== gorunen) sec(i);
  };

  const simdiki = v.durum.adim;
  const gorunenAdim = v.adimlar[gorunen];
  const zilBacagi = gorunenAdim?.tur === 'arac' && v.binisOtobusleri[gorunenAdim.bacak] ? gorunenAdim.bacak : -1;
  const zilAcik = zilBacagi >= 0 && !!v.yaklasmaUyarisi[zilBacagi];
  const vardi = v.durum.faz === 'vardi';

  return (
    <View style={[s.kart, { paddingBottom: kenar.bottom + 10 }]} onLayout={(e) => onBoy(e.nativeEvent.layout.height)}>
      {gorunen !== simdiki && (
        <Pressable style={s.donDugmesi} onPress={() => sec(simdiki)} accessibilityRole="button">
          <Ikon ad="locate" boyut={14} renkKodu={tema.vurguYazi} />
          <Text style={s.donYazi}>Şu anki adıma dön</Text>
        </Pressable>
      )}
      <View style={s.noktalar}>
        {v.adimlar.map((_, i) => (
          <View key={i} style={[s.nokta, i === gorunen && s.noktaAktif]} />
        ))}
      </View>
      <ScrollView
        ref={liste}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScrollBeginDrag={() => (kaydiriliyor.current = true)}
        onMomentumScrollEnd={kaydirmaBitti}
        contentOffset={{ x: gorunen * width, y: 0 }}
      >
        {v.adimlar.map((a, i) => (
          <View key={i} style={{ width, paddingHorizontal: 16 }}>
            <AdimKarti v={v} sira={i} />
          </View>
        ))}
      </ScrollView>
      <View style={s.eylemler}>
        <Pressable
          style={[s.dugme, vardi ? s.dugmeDolu : s.dugmeBitir]}
          onPress={onBitir}
          accessibilityRole="button"
        >
          <Text style={[s.dugmeYazi, { color: vardi ? tema.vurguYazi : tema.hata }]}>{vardi ? 'Tamam' : 'Bitir'}</Text>
        </Pressable>
        <Pressable style={[s.dugme, { flex: 1 }]} onPress={onTumAdimlar} accessibilityRole="button">
          <Ikon ad="list" boyut={16} renkKodu={tema.yazi} />
          <Text style={s.dugmeYazi}>Tüm adımlar</Text>
        </Pressable>
        {zilBacagi >= 0 && (
          <Pressable
            style={[s.dugme, s.zil, zilAcik && { backgroundColor: hatRengi(v.bacaklar[zilBacagi]?.route, tema) }]}
            onPress={() => v.uyariDegistir(zilBacagi)}
            accessibilityRole="switch"
            accessibilityState={{ checked: zilAcik }}
            accessibilityLabel="Otobüs 3 durak kalınca haber ver"
          >
            <Ikon ad={zilAcik ? 'notifications' : 'notifications-outline'} boyut={17} renkKodu={zilAcik ? '#fff' : tema.soluk} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

/** Tek bir adımın kartı. İçerik adımın türüne ve (şimdiki adımsa) evresine göre. */
function AdimKarti({ v, sira }: { v: YolTarifiVerisi; sira: number }) {
  const tema = useTema();
  const s = useStiller(stiller);
  const a = v.adimlar[sira];
  const b = v.bacaklar[a.bacak];
  const simdiki = sira === v.durum.adim;
  const bitti = sira < v.durum.adim;
  const ust = `ADIM ${sira + 1} / ${v.adimlar.length}`;

  if (simdiki && v.durum.faz === 'vardi') {
    return (
      <View style={s.icerik}>
        <Text style={s.adimNo}>{`${ust} · VARIŞ`}</Text>
        <Text style={s.komut}>Vardın</Text>
        <Text style={s.detay}>
          {v.hedef ? `${baslikYap(v.hedef)} · ` : ''}
          {saatYaz(iso(v.bacaklar[v.bacaklar.length - 1], 'end'))}
        </Text>
        <View style={[s.kutu, s.kutuIyi]}>
          <Ikon ad="checkmark-circle" boyut={17} renkKodu={tema.vurgu} />
          <Text style={s.kutuYazi}>Yolculuk tamamlandı. İyi günler!</Text>
        </View>
      </View>
    );
  }

  const etiketler = <Text style={s.adimNo}>{`${ust} · ${adimTuruYazisi(v, sira)}${bitti ? ' · TAMAMLANDI' : ''}`}</Text>;

  // ---- yürüme
  if (a.tur === 'yuru') {
    const sonrakiAdim = v.adimlar.slice(sira + 1).find((x) => x.tur === 'arac');
    const sonraki = sonrakiAdim ? v.bacaklar[sonrakiAdim.bacak] : null;
    const hedefDurak = baslikYap(b.to.name);
    const komut =
      a.rol === 'aktarma' && sonraki
        ? `${sonraki.route?.shortName ?? ''} için ${hedefDurak} durağına yürü`
        : a.rol === 'varis' || a.rol === 'tek'
          ? 'Varış noktasına yürü'
          : `${hedefDurak} durağına yürü`;
    return (
      <View style={s.icerik}>
        {etiketler}
        <Text style={s.komut}>{komut}</Text>
        <Text style={s.detay}>
          <Text style={s.kalin}>{`${mesafeYaz(b.distance)} · ${sureYaz(b.duration)}`}</Text>
          {v.ilkTarif[a.bacak] ? ` · ${v.ilkTarif[a.bacak]}` : ''}
          {(a.rol === 'varis' || a.rol === 'tek') && v.hedef ? ` · ${baslikYap(v.hedef)}` : ''}
        </Text>
        {sonraki && sonrakiAdim && <SonrakiBinisKutusu v={v} yuruyus={a.bacak} binis={sonrakiAdim.bacak} simdiki={simdiki} />}
      </View>
    );
  }

  // ---- araç: içindeyken
  const renk = hatRengi(b.route, tema);
  if (simdiki && v.durum.faz === 'icinde') {
    const kalan = v.durum.kalanDurak ?? v.duraklar[a.bacak].length - 1;
    const inisDk = Math.max(0, Math.round((an(b, 'end') - v.simdi) / 60_000));
    const siradaki = siradakiDuraklar(v.duraklar[a.bacak].length, kalan);
    return (
      <View style={s.icerik}>
        {etiketler}
        <Text style={s.komut}>
          {kalan === 0 ? `Şimdi in: ${baslikYap(b.to.name)}` : `${baslikYap(b.to.name)} durağında in`}
        </Text>
        <View style={s.buyukSatir}>
          <Text style={s.sayac}>
            {kalan === 0 ? '' : kalan}
            <Text style={s.sayacBirim}>{kalan === 0 ? 'Bu durakta in' : ' durak kaldı'}</Text>
          </Text>
          <Text style={[s.detay, { textAlign: 'right' }]}>
            <Text style={s.kalin}>{`~${inisDk} dk`}</Text>
            {`\niniş ${saatYaz(iso(b, 'end'))}`}
          </Text>
        </View>
        <View style={s.kalanListe}>
          {siradaki.map((j, k) =>
            j < 0 ? (
              <Text key={`bosluk-${k}`} style={s.kalanBosluk}>
                ⋮
              </Text>
            ) : (
              <View key={j} style={s.kalanSatir}>
                <View
                  style={[
                    j === v.duraklar[a.bacak].length - 1 ? s.kalanInis : s.kalanNokta,
                    { borderColor: renk },
                    j === v.duraklar[a.bacak].length - 1 && { backgroundColor: renk },
                  ]}
                />
                <Text
                  style={[s.kalanAd, j === v.duraklar[a.bacak].length - 1 && s.kalin]}
                  numberOfLines={1}
                >
                  {baslikYap(v.duraklar[a.bacak][j]?.ad)}
                  {j === v.duraklar[a.bacak].length - 1 ? ' · in' : ''}
                </Text>
              </View>
            ),
          )}
        </View>
      </View>
    );
  }

  // ---- araç: binmeden önce (ya da bakılan gelecek/geçmiş adım)
  const kalkis = an(b, 'start');
  const dk = Math.max(0, Math.round((kalkis - v.simdi) / 60_000));
  const canli = bacakCanli(b.start.scheduledTime, b.start.estimated?.time);
  const otobus = v.binisOtobusleri[a.bacak];
  return (
    <View style={s.icerik}>
      {etiketler}
      <View style={s.komutSatir}>
        <HatRozeti hat={b.route} />
        <Text style={[s.komut, { flex: 1 }]} numberOfLines={2}>
          {binmeIfadesi(b.route?.mode ?? b.mode, b.route?.agency?.name)}
        </Text>
      </View>
      <Text style={s.detay} numberOfLines={1}>
        {[b.headsign ? `${baslikYap(b.headsign)} yönü` : null, `${baslikYap(b.from.name)} durağı`]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      <View style={s.buyukSatir}>
        <View>
          <View style={s.sayacSatir}>
            {canli && <NabizNoktasi renk={canliRenk(canli.sinif, tema)} />}
            <Text style={s.sayac}>
              {dk}
              <Text style={s.sayacBirim}> dk</Text>
            </Text>
          </View>
          <Text style={[s.detay, canli && { color: canliRenk(canli.sinif, tema), fontWeight: '600' }]}>
            {`${saatYaz(iso(b, 'start'))} · ${canli ? canli.metin : 'tarifeye göre'}`}
          </Text>
        </View>
        {otobus && <YaklasmaSeridi kalan={otobus.kalan} renk={renk} soluk={otobus.otobus.sinif === 'eski'} />}
      </View>
      {otobus ? (
        <Text style={s.detay}>
          <Text style={s.kalin}>{`Otobüs ${kalanYaz(otobus.kalan)}`}</Text>
          {` · konum ${yasYaz(otobus.otobus.yasSn)}`}
        </Text>
      ) : (
        <Text style={s.detay}>{`${Math.max(v.duraklar[a.bacak].length - 1, 1)} durak · ${sureYaz(b.duration)}`}</Text>
      )}
    </View>
  );
}

/** Yürürken sıradaki biniş: kalkış saati, otobüs nerede, aktarmada yetişme payı. */
function SonrakiBinisKutusu({
  v,
  yuruyus,
  binis,
  simdiki,
}: {
  v: YolTarifiVerisi;
  yuruyus: number;
  binis: number;
  simdiki: boolean;
}) {
  const tema = useTema();
  const s = useStiller(stiller);
  const yb = v.bacaklar[yuruyus];
  const bb = v.bacaklar[binis];
  const hat = bb.route?.shortName ?? '';
  const canli = bacakCanli(bb.start.scheduledTime, bb.start.estimated?.time);
  const otobus = v.binisOtobusleri[binis];
  // Durağa varış: şu anki adımsa şimdi + yürüme süresi, değilse planlanan.
  const varis = simdiki ? v.simdi + (yb.duration ?? 0) * 1000 : an(yb, 'end');
  const pay = aktarmaPayi(varis, an(bb, 'start'));
  const sonrakiSefer = v.seferler[binis]?.sonrakiSaniye;
  const yetisilmez = !Number.isNaN(pay) && pay < 1;

  return (
    <View style={[s.kutu, yetisilmez ? s.kutuDikkat : s.kutuIyi]}>
      {canli ? (
        <NabizNoktasi renk={canliRenk(canli.sinif, tema)} />
      ) : (
        <Ikon ad="time-outline" boyut={15} renkKodu={yetisilmez ? tema.uyari : tema.vurgu} />
      )}
      <Text style={s.kutuYazi}>
        <Text style={s.kalin}>{hat}</Text>
        {` kalkışı ${saatYaz(iso(bb, 'start'))}`}
        {otobus ? ` · otobüs ${kalanYaz(otobus.kalan)}` : ''}
        {yetisilmez
          ? `. Yetişmek zor${sonrakiSefer != null ? `; sonraki ${hat} ${saniyedenSaat(sonrakiSefer)}` : ''}.`
          : Number.isNaN(pay)
            ? ''
            : `. ${pay} dk payın var.`}
      </Text>
    </View>
  );
}

function adimTuruYazisi(v: YolTarifiVerisi, sira: number): string {
  const a = v.adimlar[sira];
  if (a.tur === 'yuru') return a.rol === 'aktarma' ? 'AKTARMA' : 'YÜRÜ';
  if (sira === v.durum.adim && v.durum.faz === 'icinde') return 'YOLDA';
  return 'BİN';
}

// ---------------------------------------------------------------- tüm adımlar

/** Bütün yolculuk tek listede: biten soluk, şu anki vurgulu. Satıra dokununca o adıma gider. */
export function TumAdimlar({
  v,
  acik,
  kapat,
  sec,
}: {
  v: YolTarifiVerisi;
  acik: boolean;
  kapat: () => void;
  sec: (i: number) => void;
}) {
  const tema = useTema();
  const s = useStiller(stiller);
  const kenar = useSafeAreaInsets();
  const son = v.bacaklar[v.bacaklar.length - 1];
  const varisDk = son ? Math.max(0, Math.round((an(son, 'end') - v.simdi) / 60_000)) : 0;
  const aktarma = v.adimlar.filter((a) => a.tur === 'arac').length - 1;
  const git = (i: number) => {
    sec(i);
    kapat();
  };
  return (
    <Modal visible={acik} transparent animationType="slide" onRequestClose={kapat}>
      <Pressable style={s.perde} onPress={kapat} accessibilityLabel="Kapat" />
      <View style={[s.sayfa, { paddingBottom: kenar.bottom + 12 }]}>
        <View style={s.tutamac} />
        <Text style={s.sayfaBaslik}>{v.hedef ? `${baslikYap(v.hedef)} yolculuğu` : 'Yolculuk'}</Text>
        <Text style={s.detay}>
          {`Varış ${saatYaz(son ? iso(son, 'end') : null)} · ${varisDk} dk kaldı`}
          {aktarma > 0 ? ` · ${aktarma} aktarma` : ''}
        </Text>
        <ScrollView style={{ marginTop: 8 }}>
          {v.adimlar.map((a, i) => {
            const b = v.bacaklar[a.bacak];
            const bitti = i < v.durum.adim || (v.durum.faz === 'vardi' && i === v.durum.adim);
            const simdiki = i === v.durum.adim && !bitti;
            return (
              <Pressable key={i} style={[s.satir, simdiki && s.satirSimdi, bitti && { opacity: 0.55 }]} onPress={() => git(i)}>
                <Text style={s.satirSaat}>{saatYaz(iso(b, 'start'))}</Text>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  {a.tur === 'arac' ? (
                    <View style={s.komutSatir}>
                      <HatRozeti hat={b.route} kucuk />
                      <Text style={s.satirBaslik} numberOfLines={1}>
                        {`${baslikYap(b.to.name)} durağına`}
                      </Text>
                    </View>
                  ) : (
                    <Text style={s.satirBaslik} numberOfLines={1}>
                      {a.rol === 'aktarma'
                        ? `Aktarma: ${baslikYap(b.to.name)} durağına yürü`
                        : a.rol === 'varis' || a.rol === 'tek'
                          ? 'Varış noktasına yürü'
                          : `${baslikYap(b.to.name)} durağına yürü`}
                    </Text>
                  )}
                  <Text style={s.satirAlt} numberOfLines={1}>
                    {a.tur === 'arac'
                      ? `${Math.max(v.duraklar[a.bacak].length - 1, 1)} durak · ${sureYaz(b.duration)}`
                      : `${mesafeYaz(b.distance)} · ${sureYaz(b.duration)}`}
                  </Text>
                </View>
                <Text style={[s.durumCipi, simdiki ? { color: tema.vurgu, backgroundColor: tema.vurguAcik } : null]}>
                  {bitti ? 'bitti' : simdiki ? 'şimdi' : 'sonra'}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Pressable style={[s.dugme, s.dugmeDolu, { marginTop: 10 }]} onPress={() => git(v.durum.adim)}>
          <Text style={[s.dugmeYazi, { color: tema.vurguYazi }]}>Şu anki adıma dön</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------- stiller

const stiller = (t: Tema) =>
  StyleSheet.create({
    sekmeler: {
      flexGrow: 0,
      backgroundColor: t.yuzey,
      borderRadius: 14,
      shadowColor: '#000',
      shadowOpacity: t.koyu ? 0.5 : 0.2,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
    },
    sekmeIc: { paddingHorizontal: 6, paddingVertical: 5, alignItems: 'center' },
    sekmeSarici: { flexDirection: 'row', alignItems: 'center' },
    ayrac: { color: t.soluk, fontSize: 12, marginHorizontal: 2, opacity: 0.7 },
    sekme: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      height: 28,
      paddingHorizontal: 7,
      borderRadius: 8,
      borderWidth: 1.5,
      borderColor: 'transparent',
    },
    sekmeBitti: { opacity: 0.55 },
    sekmeYazi: { fontSize: 12.5, fontWeight: '800' },

    kart: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: t.yuzey,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      paddingTop: 10,
      shadowColor: '#000',
      shadowOpacity: t.koyu ? 0.5 : 0.18,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: -4 },
    },
    donDugmesi: {
      position: 'absolute',
      top: -46,
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: t.vurgu,
      paddingHorizontal: 14,
      height: 34,
      borderRadius: 17,
    },
    donYazi: { color: t.vurguYazi, fontWeight: '700', fontSize: 13 },
    noktalar: { flexDirection: 'row', justifyContent: 'center', gap: 5, marginBottom: 8 },
    nokta: { width: 6, height: 6, borderRadius: 3, backgroundColor: t.cizgi },
    noktaAktif: { width: 16, backgroundColor: t.vurgu },
    icerik: { minHeight: 196, gap: 4 },
    adimNo: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, color: t.soluk },
    komutSatir: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    komut: { fontSize: 21, fontWeight: '800', letterSpacing: -0.3, color: t.yazi, lineHeight: 26 },
    detay: { fontSize: 13, color: t.soluk, lineHeight: 18 },
    kalin: { fontWeight: '700', color: t.yazi },
    buyukSatir: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginVertical: 6 },
    sayacSatir: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    sayac: { fontSize: 34, fontWeight: '800', color: t.yazi, fontVariant: ['tabular-nums'] },
    sayacBirim: { fontSize: 14, fontWeight: '600', color: t.soluk },
    kutu: { flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 12, padding: 10, marginTop: 8 },
    kutuIyi: { backgroundColor: t.vurguAcik },
    kutuDikkat: { backgroundColor: t.uyariAcik },
    kutuYazi: { flex: 1, fontSize: 12.5, color: t.yazi, lineHeight: 17 },
    kalanListe: { marginTop: 4, gap: 2 },
    kalanSatir: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 24 },
    kalanNokta: { width: 10, height: 10, borderRadius: 5, borderWidth: 2.5, marginLeft: 2 },
    kalanInis: { width: 14, height: 14, borderRadius: 7, borderWidth: 2.5 },
    kalanAd: { flex: 1, fontSize: 13.5, color: t.yazi },
    kalanBosluk: { color: t.soluk, marginLeft: 4, height: 16, lineHeight: 16 },
    eylemler: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: 10 },
    dugme: {
      height: 42,
      borderRadius: 12,
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: t.yuzeyIkincil,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.cizgi,
    },
    dugmeBitir: {},
    dugmeDolu: { backgroundColor: t.vurgu, borderColor: t.vurgu },
    dugmeYazi: { fontSize: 13.5, fontWeight: '700', color: t.yazi },
    zil: { width: 42, paddingHorizontal: 0 },

    perde: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
    sayfa: {
      backgroundColor: t.yuzey,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      paddingHorizontal: 16,
      paddingTop: 8,
      maxHeight: '80%',
    },
    tutamac: { width: 38, height: 5, borderRadius: 3, backgroundColor: t.cizgi, alignSelf: 'center', marginBottom: 8 },
    sayfaBaslik: { fontSize: 18, fontWeight: '800', color: t.yazi },
    satir: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.cizgi,
    },
    satirSimdi: { borderLeftWidth: 3, borderLeftColor: t.vurgu, paddingLeft: 8 },
    satirSaat: { width: 42, fontSize: 12.5, fontWeight: '700', color: t.yazi, fontVariant: ['tabular-nums'] },
    satirBaslik: { flexShrink: 1, fontSize: 13.5, fontWeight: '700', color: t.yazi },
    satirAlt: { fontSize: 12, color: t.soluk },
    durumCipi: {
      fontSize: 11,
      fontWeight: '700',
      color: t.soluk,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 999,
      overflow: 'hidden',
      backgroundColor: t.yuzeyIkincil,
    },
  });
