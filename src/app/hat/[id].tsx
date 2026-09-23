// Hat detayı: seçilen hattın yönleri ve o yöndeki durak sırası.
//
// Bir hattın her yönü rota motorunda ayrı bir "desen" (pattern) olarak durur.
// Bazı hatlarda ring seferi ya da kısa güzergâh gibi ek desenler de bulunur;
// bunlar da yön seçeneği olarak listelenir.
//
// Canlı konum: seçili yöndeki otobüsler durak listesinin arasına giriyor (hangi iki
// durağın arasında oldukları arac-konum.ts'te hesaplanıyor). Durak ekranından
// gelindiyse o durak işaretleniyor: "bana en yakın otobüs hangisi" bir bakışta okunur.

import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { canliRenk, HataKutusu, HatRozeti, Ikon, NabizNoktasi, useStiller, Yukleniyor } from '@/components/ulasim';
import { araclariYerlestir, gecikmeKisa, yasYaz, type HamArac, type YerlesikArac } from '@/lib/arac-konum';
import { canliBilgi } from '@/lib/canli';
import { trKucuk } from '@/lib/metin';
import { hatAraclariGetir, hatDetayiGetir, OtpHatasi, type HatDetayi } from '@/lib/otp';
import { aracAdi, baslikYap, haritaRengi, hatRengi, useTema, yaziRengi, type Tema } from '@/lib/tema';

export default function HatEkrani() {
  const kenar = useSafeAreaInsets();
  const tema = useTema();
  const s = useStiller(stiller);
  // desen, durak, durakAd: durak ekranından gelindiğinde o yön seçilir, o durak işaretlenir.
  const { id, desen, durak: gelinenDurak, durakAd } = useLocalSearchParams<{
    id: string;
    desen?: string;
    durak?: string;
    durakAd?: string;
  }>();

  const [hat, setHat] = useState<HatDetayi | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [yon, setYon] = useState<number | null>(null);
  const [araclar, setAraclar] = useState<Record<string, HamArac[]>>({});
  const [simdi, setSimdi] = useState(() => Date.now());
  const liste = useRef<ScrollView>(null);
  const kaydirildi = useRef(false);

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

  // Otobüs konumları yarım dakikada bir; yaşları 15 saniyede bir yeniden yazılır.
  // Konum alınamazsa sessizce geçilir: canlı konum süs, hat ekranı onsuz da çalışır.
  useEffect(() => {
    if (!id) return;
    let acik = true;
    const araclariYukle = () =>
      hatAraclariGetir(id)
        .then((sonuc) => {
          if (!acik) return;
          setAraclar(sonuc);
          setSimdi(Date.now());
        })
        .catch(() => {});
    araclariYukle();
    const konum = setInterval(araclariYukle, 30_000);
    const saat = setInterval(() => setSimdi(Date.now()), 15_000);
    return () => {
      acik = false;
      clearInterval(konum);
      clearInterval(saat);
    };
  }, [id]);

  // Duraksız desenler listeye girmez; en çok durağı olan desen varsayılan yön olur.
  const desenler = useMemo(() => {
    const liste = (hat?.patterns ?? []).filter((d) => (d.stops?.length ?? 0) > 1);
    return liste.sort((a, b) => (b.stops?.length ?? 0) - (a.stops?.length ?? 0));
  }, [hat]);

  // Seçim yapılmadıysa: durak ekranından gelinen yön, yoksa en uzun desen.
  const baslangicYonu = Math.max(0, desenler.findIndex((d) => d.code === desen));
  const yonNo = Math.min(yon ?? baslangicYonu, Math.max(desenler.length - 1, 0));
  const secili = desenler[yonNo];
  const duraklar = useMemo(() => secili?.stops ?? [], [secili]);

  // İşaretlenecek durak: kimliği tutan, tutmuyorsa (istasyondan gelindi) adı tutan.
  const isaretli = useMemo(() => {
    if (!gelinenDurak && !durakAd) return -1;
    const kimlikle = duraklar.findIndex((d) => d.gtfsId === gelinenDurak);
    if (kimlikle >= 0) return kimlikle;
    const ad = trKucuk(durakAd ?? '').trim();
    return ad ? duraklar.findIndex((d) => trKucuk(d.name ?? '').trim() === ad) : -1;
  }, [duraklar, gelinenDurak, durakAd]);

  const otobusler = useMemo(
    () => (secili ? araclariYerlestir(duraklar, araclar[secili.code], simdi) : []),
    [secili, duraklar, araclar, simdi],
  );
  // Durağın arkasına (durakta ya da ondan sonraki durağa giderken) düşen otobüsler.
  const durakSonrasi = useMemo(() => {
    const m = new Map<number, YerlesikArac[]>();
    for (const o of otobusler) {
      const i = Math.floor(o.konum);
      m.set(i, [...(m.get(i) ?? []), o]);
    }
    return m;
  }, [otobusler]);
  const enTaze = otobusler.length ? Math.min(...otobusler.map((o) => o.yasSn)) : null;
  // Durak çizgisi rozetle aynı renkte (koyu temada açılmış ton), başlık şeridi ise
  // hattın resmî rengini kullanır; geniş bir alanı açılmış tonla boyamak göz alıyor.
  const renkKodu = hat ? hatRengi(hat, tema) : tema.vurgu;
  const seritRengi = hat ? haritaRengi(hat, tema) : tema.vurgu;
  const yaziKodu = yaziRengi(seritRengi);

  const yonAdi = (d: (typeof desenler)[number] | undefined) => {
    if (!d) return '';
    const bitis = d.stops?.[d.stops.length - 1]?.name;
    const ad = baslikYap(d.headsign) || baslikYap(bitis) || baslikYap(d.name);
    return ad ? `${ad} yönü` : '';
  };

  return (
    <View style={s.kok}>
      <View style={[s.tepe, { backgroundColor: seritRengi, paddingTop: kenar.top + 8 }]}>
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
            const aktif = i === yonNo;
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
        <ScrollView ref={liste} contentContainerStyle={{ paddingBottom: kenar.bottom + 24 }}>
          {desenler.length === 1 && (
            <Text style={s.tekYon}>{yonAdi(secili)} · {duraklar.length} durak</Text>
          )}
          {otobusler.length > 0 && enTaze != null && (
            <View style={s.canliOzet}>
              <NabizNoktasi renk={tema.vurgu} boyut={6} />
              <Text style={s.canliOzetYazi}>
                <Text style={s.kalin}>{`Bu yönde şu an ${otobusler.length} otobüs`}</Text>
                {` · ${yasYaz(enTaze)} güncellendi`}
              </Text>
            </View>
          )}
          {duraklar.length === 0 && <Text style={s.bos}>Bu hattın durak bilgisi veride yok.</Text>}
          <View style={s.liste}>
            {duraklar.map((d, i) => {
              const ilk = i === 0;
              const son = i === duraklar.length - 1;
              const buDurak = i === isaretli;
              return (
                <View key={`${d.gtfsId}-${i}`}>
                  <Pressable
                    style={s.durak}
                    onPress={() => router.push({ pathname: '/durak/[id]', params: { id: d.gtfsId } })}
                    accessibilityRole="button"
                    onLayout={
                      buDurak
                        ? (e) => {
                            // Gelinen durağı ekranın üst kısmına getir; bir kez.
                            if (kaydirildi.current) return;
                            kaydirildi.current = true;
                            liste.current?.scrollTo({ y: Math.max(0, e.nativeEvent.layout.y - 160), animated: false });
                          }
                        : undefined
                    }
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
                    <Text style={[s.durakAd, (ilk || son || buDurak) && s.durakAdKalin]} numberOfLines={1}>
                      {baslikYap(d.name)}
                    </Text>
                    {buDurak && <Text style={[s.durakEtiket, { color: renkKodu, borderColor: renkKodu }]}>durağın</Text>}
                    <Ikon ad="chevron-forward" boyut={15} renkKodu={tema.yurume} />
                  </Pressable>
                  {(durakSonrasi.get(i) ?? []).map((o) => (
                    <OtobusSatiri
                      key={o.kimlik}
                      otobus={o}
                      renkKodu={renkKodu}
                      sonDurak={son}
                      durakAdi={baslikYap(duraklar[o.durak]?.name)}
                    />
                  ))}
                </View>
              );
            })}
          </View>
          <Text style={s.dipnot}>
            Durak sırası rota motorundaki güzergâh desenine göredir. Bir durağa dokunarak yaklaşan seferlerini
            görebilirsin.
            {otobusler.length > 0 &&
              ' Otobüs konumları İETT\'den iki dakikada bir geliyor; 5 dakikadan eski konumlar soluk, 10 dakikadan eskileri gösterilmiyor.'}
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

/**
 * Durak listesinin arasındaki otobüs: çizginin üstünde otobüs simgesi, yanında ne
 * durumda olduğu. Taze konumda gecikme ve yaş; 5 dakikadan eskide yalnız "… civarı,
 * N dk önce görüldü", soluk.
 */
function OtobusSatiri({
  otobus,
  renkKodu,
  sonDurak,
  durakAdi,
}: {
  otobus: YerlesikArac;
  renkKodu: string;
  sonDurak: boolean;
  durakAdi: string;
}) {
  const tema = useTema();
  const s = useStiller(stiller);
  const eski = otobus.sinif === 'eski';
  const simgeRengi = eski ? tema.soluk : renkKodu;
  const gecikme = otobus.gecikme != null ? canliBilgi(otobus.gecikme) : null;
  const etiket = eski
    ? `${durakAdi} civarında, ${yasYaz(otobus.yasSn)} görüldü`
    : [
        otobus.durum === 'durakta' ? `${durakAdi} durağında` : `${durakAdi} durağına yaklaşıyor`,
        gecikme?.metin,
        `konum ${yasYaz(otobus.yasSn)}`,
      ]
        .filter(Boolean)
        .join(', ');
  return (
    <View style={s.otobus} accessible accessibilityLabel={`Otobüs ${otobus.etiket}: ${etiket}`}>
      <View style={s.cizgiSutun}>
        <View style={[s.cizgiTam, { backgroundColor: renkKodu }, sonDurak && { opacity: 0 }]} />
        <View style={[s.otobusSimge, { backgroundColor: simgeRengi, borderColor: tema.yuzey }]}>
          <Ikon ad="bus" boyut={12} renkKodu={tema.yuzey} />
        </View>
      </View>
      {eski ? (
        <Text style={s.otobusSoluk} numberOfLines={1}>
          {`${durakAdi} civarı · ${yasYaz(otobus.yasSn)} görüldü`}
        </Text>
      ) : (
        <Text style={s.otobusYazi} numberOfLines={1}>
          <Text style={s.kalin}>{otobus.durum === 'durakta' ? 'Durakta' : 'Yaklaşıyor'}</Text>
          {gecikme && (
            <Text style={{ color: canliRenk(gecikme.sinif, tema), fontWeight: '700' }}>
              {`  ${gecikmeKisa(otobus.gecikme!)}`}
            </Text>
          )}
          <Text style={s.otobusYas}>{`  ${yasYaz(otobus.yasSn)}`}</Text>
        </Text>
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
    yonSeridi: {
      flexGrow: 0,
      height: 76,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.cizgi,
    },
    yonlar: { gap: 8, paddingHorizontal: 12, paddingVertical: 12, alignItems: 'center' },
    yon: {
      maxWidth: 240,
      height: 52,
      paddingHorizontal: 14,
      justifyContent: 'center',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.cizgi,
      backgroundColor: t.yuzeyIkincil,
    },
    yonYazi: { fontSize: 13.5, lineHeight: 18, fontWeight: '700', color: t.yazi },
    yonSayi: { fontSize: 11.5, lineHeight: 15, color: t.soluk, marginTop: 2 },
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
    kalin: { fontWeight: '700', color: t.yazi },
    canliOzet: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 },
    canliOzetYazi: { flex: 1, fontSize: 12.5, color: t.soluk },
    durakEtiket: {
      fontSize: 10.5,
      fontWeight: '700',
      borderWidth: 1,
      borderRadius: 6,
      paddingHorizontal: 5,
      paddingVertical: 1,
      overflow: 'hidden',
    },
    otobus: { flexDirection: 'row', alignItems: 'center', gap: 11, height: 34 },
    cizgiTam: { position: 'absolute', top: 0, bottom: 0, width: 3 },
    otobusSimge: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    otobusYazi: { flex: 1, fontSize: 12.5, color: t.yazi },
    otobusYas: { color: t.soluk },
    otobusSoluk: { flex: 1, fontSize: 12.5, color: t.soluk, fontStyle: 'italic' },
  });
