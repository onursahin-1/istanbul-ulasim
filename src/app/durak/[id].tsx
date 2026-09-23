// 4 · Durak detayı: konum, geçen hatlar ve yaklaşan seferler.

import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  CanliAciklama,
  CevrimdisiSerit,
  Dakika,
  DuyuruKarti,
  HataKutusu,
  HatRozeti,
  Ikon,
  NabizNoktasi,
  ROZET_SUTUNU,
  TarifeEtiketi,
  useStiller,
  YaklasmaSeridi,
  Yukleniyor,
} from '@/components/ulasim';
import { araclariYerlestir, kalanYaz, yaklasanOtobus, yasYaz } from '@/lib/arac-konum';
import { kalkisCanli } from '@/lib/canli';
import { trKucuk } from '@/lib/metin';
import { siklikYaz } from '@/lib/siklik';
import { hatSikligi } from '@/lib/siklik-verisi';
import { favoriDegistir, useKayitlar } from '@/lib/kayitlar';
import { useKonum } from '@/lib/konum';
import { hatlarinDuyurulari, type Duyuru } from '@/lib/duyuru';
import {
  duyurulariGetir,
  durakSaatleriYedekli,
  OtpHatasi,
  saatsizHatlariGetir,
  saatsizHatMi,
  type DurakSaatleri,
  type Hat,
} from '@/lib/otp';
import { baslikYap, hatEtiketi, hatRengi, useTema, yonYaz, type Tema } from '@/lib/tema';
import { istanbulSaatiYaz, kacDakikaSonra, kalkisGosterimi, saniyedenSaat } from '@/lib/zaman';

const YENILEME_ARALIGI = 30_000;

export default function DurakEkrani() {
  const kenar = useSafeAreaInsets();
  const tema = useTema();
  const s = useStiller(stiller);
  const { id } = useLocalSearchParams<{ id: string }>();
  const konum = useKonum();
  const { favoriler } = useKayitlar();
  const [durak, setDurak] = useState<DurakSaatleri | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [cevrimdisi, setCevrimdisi] = useState<number | null>(null);
  const [yenileniyor, setYenileniyor] = useState(false);
  // Minibüs ve dolmuş: saatleri yok; aynı meydandaki aynı adlı duraklardan da toplanıyor.
  const [saatsiz, setSaatsiz] = useState<Hat[]>([]);
  const [tumDuyurular, setTumDuyurular] = useState<Duyuru[]>([]);
  const [tumDuyurularAcik, setTumDuyurularAcik] = useState(false);
  useEffect(() => {
    let acik = true;
    duyurulariGetir().then((l) => acik && setTumDuyurular(l));
    return () => {
      acik = false;
    };
  }, []);

  const yukle = useCallback(async () => {
    if (!id) return;
    try {
      const { durak: sonuc, cevrimdisi: kayitZamani } = await durakSaatleriYedekli(id);
      if (!sonuc) setHata('Bu durak bulunamadı.');
      else {
        setDurak(sonuc);
        setCevrimdisi(kayitZamani);
        setHata(null);
      }
    } catch (e) {
      setHata(e instanceof OtpHatasi ? e.message : 'Durak bilgisi yüklenemedi.');
    }
  }, [id]);

  useEffect(() => {
    yukle();
    const zamanlayici = setInterval(yukle, YENILEME_ARALIGI);
    return () => clearInterval(zamanlayici);
  }, [yukle]);

  // Saatsiz hatlar değişmiyor; durak bir kez geldiğinde bir kez sorulur.
  const durakKimligi = durak?.gtfsId;
  useEffect(() => {
    if (!durak || !durakKimligi) return;
    let gecerli = true;
    saatsizHatlariGetir(durak)
      .then((hatlar) => gecerli && setSaatsiz(hatlar))
      .catch(() => gecerli && setSaatsiz((durak.routes ?? []).filter(saatsizHatMi)));
    return () => {
      gecerli = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durakKimligi]);

  const ad = baslikYap(durak?.name);
  const favoriMi = favoriler.some((f) => f.gtfsId === id);

  const hatlar = useMemo(() => {
    // Minibüs ve dolmuş çipleri hep "Minibüs" yazıyordu; onlar aşağıda güzergâhlarıyla ayrı listeleniyor.
    const liste = [...(durak?.routes ?? [])].filter((r) => r.shortName && !saatsizHatMi(r));
    const tekil = [...new Map(liste.map((r) => [r.shortName, r])).values()];
    return tekil.sort((a, b) => (a.shortName ?? '').localeCompare(b.shortName ?? '', 'tr', { numeric: true }));
  }, [durak]);

  // Her hattın her yönü kendi satırında: kalabalık duraklarda tek bir karışık listede
  // bazı hatlar hiç görünmüyordu. Satırlar en yakın kalkışa göre sıralanır.
  const yonler = useMemo(() => {
    const simdi = Date.now();
    const ad = trKucuk(durak?.name ?? '').trim();
    const liste = (durak?.desenler ?? [])
      .map((d) => {
        // Bu yöne gelen en yakın otobüs: desenin durak sırasında bu durak kaçıncı,
        // otobüs nerede. İstasyondan (birden çok peron) gelindiyse ad tutan durak.
        const desenDuraklari = d.pattern?.stops ?? [];
        let sira = desenDuraklari.findIndex((x) => x.gtfsId === durak?.gtfsId);
        if (sira < 0 && ad) sira = desenDuraklari.findIndex((x) => trKucuk(x.name ?? '').trim() === ad);
        const ilkSefer = (d.stoptimes ?? []).find((k) => k)?.trip?.gtfsId;
        const yaklasan =
          sira >= 0 && d.pattern?.vehiclePositions?.length
            ? yaklasanOtobus(araclariYerlestir(desenDuraklari, d.pattern.vehiclePositions, simdi), sira, ilkSefer)
            : null;
        const kalkislar = (d.stoptimes ?? [])
          .map((k) => ({
            saniye: k.realtimeDeparture ?? k.scheduledDeparture ?? 0,
            an: (k.serviceDay ?? 0) + (k.realtimeDeparture ?? k.scheduledDeparture ?? 0),
            canli: kalkisCanli(k),
            dakika: kacDakikaSonra(k.serviceDay ?? 0, k.realtimeDeparture ?? k.scheduledDeparture ?? 0),
          }))
          .filter((k) => k.dakika >= 0)
          .sort((a, b) => a.dakika - b.dakika);
        return {
          anahtar: d.pattern?.code ?? '',
          hat: d.pattern?.route ?? null,
          yon: baslikYap(d.pattern?.headsign) || baslikYap(d.pattern?.route?.longName),
          // Minibüs ve dolmuşta rozet yalnızca araç tipini yazıyor; güzergâh buraya düşüyor.
          guzergah: hatEtiketi(d.pattern?.route?.shortName, d.pattern?.route?.mode, d.pattern?.route?.agency?.name)
            .ayrinti,
          kalkislar,
          yaklasan,
        };
      })
      .filter((x) => x.hat && x.kalkislar.length > 0);
    return liste.sort((a, b) => a.kalkislar[0].dakika - b.kalkislar[0].dakika);
  }, [durak]);

  // Ekranda canlı kalkış varsa, canlı olmayanlar "tarifeye göre" diye ayrılıyor.
  // Bütünüyle tarifeli bir durakta (metro, vapur) her satıra bunu yazmak gürültü olur.
  const canliVar = yonler.some((y) => y.kalkislar[0].canli);

  const yolTarifi = () => {
    if (durak?.lat == null || durak.lon == null) return;
    router.push({
      pathname: '/rota',
      params: {
        kLat: String(konum.nokta.latitude),
        kLon: String(konum.nokta.longitude),
        kAd: konum.tur === 'gercek' ? 'Konumum' : 'Kadıköy (örnek konum)',
        vLat: String(durak.lat),
        vLon: String(durak.lon),
        vAd: ad,
      },
    });
  };

  // Harita işareti, duraktan geçen ilk hattın rengini alır (metro durağı mavi, vapur iskelesi lacivert…).
  const isaretRengi = hatlar.length ? hatRengi(hatlar[0], tema) : tema.vurgu;

  return (
    <View style={s.kok}>
      {durak?.lat != null && durak.lon != null ? (
        <MapView
          style={s.harita}
          userInterfaceStyle={tema.haritaStili}
          initialRegion={{ latitude: durak.lat, longitude: durak.lon, latitudeDelta: 0.006, longitudeDelta: 0.006 }}
          showsPointsOfInterests={false}
          toolbarEnabled={false}
          scrollEnabled={false}
          zoomEnabled={false}
        >
          <Marker coordinate={{ latitude: durak.lat, longitude: durak.lon }} title={ad} pinColor={isaretRengi} />
        </MapView>
      ) : (
        <View style={[s.harita, { backgroundColor: tema.haritaZemin }]} />
      )}

      <View style={[s.ustDugmeler, { top: kenar.top + 8 }]}>
        <Pressable style={s.yuvarlak} onPress={() => router.back()} accessibilityLabel="Geri">
          <Ikon ad="chevron-back" boyut={22} />
        </Pressable>
      </View>

      <ScrollView
        style={s.govde}
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: kenar.bottom + 24 }}
        refreshControl={
          <RefreshControl
            refreshing={yenileniyor}
            tintColor={tema.vurgu}
            onRefresh={async () => {
              setYenileniyor(true);
              await yukle();
              setYenileniyor(false);
            }}
          />
        }
      >
        {cevrimdisi != null && <CevrimdisiSerit zaman={cevrimdisi} tekrarDene={yukle} />}
        {hata && <HataKutusu mesaj={hata} tekrarDene={yukle} />}
        {!durak && !hata && <Yukleniyor metin="Durak bilgisi yükleniyor…" />}
        {durak && (
          <>
            <View style={{ gap: 4 }}>
              <Text style={s.baslik}>{ad}</Text>
              <Text style={s.bilgi}>
                {[durak.code ? `Durak kodu ${durak.code}` : '', yonYaz(durak.desc)].filter(Boolean).join(' · ')}
              </Text>
            </View>

            <View style={s.eylemler}>
              <Pressable
                style={s.eylem}
                onPress={() => favoriDegistir({ gtfsId: durak.gtfsId, ad })}
                accessibilityState={{ selected: favoriMi }}
              >
                <Ikon ad={favoriMi ? 'heart' : 'heart-outline'} boyut={16} renkKodu={tema.vurgu} />
                <Text style={s.eylemYazi}>{favoriMi ? 'Favorilerde' : 'Favorilere ekle'}</Text>
              </Pressable>
              <Pressable style={[s.eylem, s.eylemDolu]} onPress={yolTarifi}>
                <Ikon ad="navigate" boyut={16} renkKodu={tema.vurguYazi} />
                <Text style={[s.eylemYazi, { color: tema.vurguYazi }]}>Yol tarifi</Text>
              </Pressable>
            </View>

            {hatlar.length > 0 && (
              <View style={{ gap: 8 }}>
                <Text style={s.altBaslik}>BU DURAKTAN GEÇEN HATLAR</Text>
                <View style={s.hatlar}>
                  {hatlar.map((h) => (
                    <Pressable
                      key={h.gtfsId}
                      onPress={() => router.push({ pathname: '/hat/[id]', params: { id: h.gtfsId } })}
                      accessibilityRole="button"
                      accessibilityLabel={`${h.shortName ?? ''} hattının detayı`}
                    >
                      <HatRozeti hat={h} />
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            {(() => {
              // Bu duraktan geçen hatların duyuruları; kalabalık duraklarda ilk üçü, gerisi dokununca.
              const liste = hatlarinDuyurulari(
                tumDuyurular,
                hatlar.map((h) => h.shortName),
              );
              if (!liste.length) return null;
              const gorunen = tumDuyurularAcik ? liste : liste.slice(0, 3);
              return (
                <View style={{ gap: 8 }}>
                  <Text style={s.altBaslik}>DUYURULAR</Text>
                  {gorunen.map((d, i) => (
                    <DuyuruKarti
                      key={i}
                      duyuru={d}
                      hat={hatlar.find((h) => (h.shortName ?? '').toLocaleUpperCase('tr-TR') === d.hat) ?? d.hat}
                    />
                  ))}
                  {liste.length > gorunen.length && (
                    <Pressable onPress={() => setTumDuyurularAcik(true)} accessibilityRole="button">
                      <Text style={[s.bilgi, { color: tema.vurgu, fontWeight: '700' }]}>
                        {`${liste.length - gorunen.length} duyuru daha`}
                      </Text>
                    </Pressable>
                  )}
                </View>
              );
            })()}

            {(yonler.length > 0 || saatsiz.length === 0) && (
            <View style={{ gap: 4 }}>
              <Text style={s.altBaslik}>YÖNE GÖRE SONRAKİ KALKIŞLAR</Text>
              {yonler.length === 0 && <Text style={s.bos}>Önümüzdeki 3 saatte bu duraktan sefer görünmüyor.</Text>}
              {yonler.map((y) => (
                <Pressable
                  key={y.anahtar}
                  style={s.sefer}
                  onPress={() =>
                    y.hat &&
                    router.push({
                      pathname: '/hat/[id]',
                      // Hat ekranı bu yönü açsın, bu durağı işaretlesin: yaklaşan otobüsler görünsün.
                      params: { id: y.hat.gtfsId, desen: y.anahtar, durak: durak?.gtfsId ?? '', durakAd: durak?.name ?? '' },
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={[
                    y.hat?.shortName ?? '',
                    y.yon,
                    kalkisGosterimi(y.kalkislar[0].an).seslendirme,
                    y.kalkislar[0].canli ? `canlı, ${y.kalkislar[0].canli.metin}` : canliVar ? 'tarifeye göre' : '',
                    y.yaklasan ? `otobüs ${kalanYaz(y.yaklasan.kalan)}` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                >
                  <View style={{ minWidth: ROZET_SUTUNU }}>
                    <HatRozeti hat={y.hat} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.seferYon} numberOfLines={1}>
                      {y.yon || 'Yön bilgisi yok'}
                    </Text>
                    {!!y.guzergah && (
                      <Text style={s.seferGuzergah} numberOfLines={1}>
                        {y.guzergah}
                      </Text>
                    )}
                    {y.kalkislar[0].canli ? (
                      <CanliAciklama canli={y.kalkislar[0].canli} an={y.kalkislar[0].an} />
                    ) : canliVar ? (
                      <TarifeEtiketi saat={istanbulSaatiYaz(y.kalkislar[0].an)} />
                    ) : null}
                    {y.yaklasan && (
                      <View style={s.yaklasma}>
                        <YaklasmaSeridi
                          kalan={y.yaklasan.kalan}
                          renk={y.hat ? hatRengi(y.hat, tema) : tema.vurgu}
                          soluk={y.yaklasan.otobus.sinif === 'eski'}
                        />
                        <Text style={s.yaklasmaYazi} numberOfLines={1}>
                          <Text style={s.yaklasmaKalin}>{`Otobüs ${kalanYaz(y.yaklasan.kalan)}`}</Text>
                          {` · ${yasYaz(y.yaklasan.otobus.yasSn)}`}
                        </Text>
                      </View>
                    )}
                    {y.kalkislar[0].canli || canliVar ? (
                      // İlk kalkışın saati üstteki satırda; burada yalnız sonrakiler.
                      y.kalkislar.length > 1 && (
                        <Text style={s.seferSaat}>
                          sonra {y.kalkislar.slice(1, 3).map((k) => saniyedenSaat(k.saniye)).join(' · ')}
                        </Text>
                      )
                    ) : (
                      <Text style={s.seferSaat}>
                        {y.kalkislar.slice(0, 3).map((k) => saniyedenSaat(k.saniye)).join('  ·  ')}
                      </Text>
                    )}
                  </View>
                  <Dakika an={y.kalkislar[0].an} canli={y.kalkislar[0].canli} />
                </Pressable>
              ))}
            </View>
            )}

            {saatsiz.length > 0 && (
              <View style={{ gap: 4 }}>
                <Text style={s.altBaslik}>MİNİBÜS VE DOLMUŞ</Text>
                {saatsiz.map((h) => {
                  const guzergah = hatEtiketi(h.shortName, h.mode, h.agency?.name).ayrinti;
                  return (
                    <Pressable
                      key={h.gtfsId}
                      style={s.sefer}
                      onPress={() => router.push({ pathname: '/hat/[id]', params: { id: h.gtfsId } })}
                      accessibilityRole="button"
                      accessibilityLabel={`${guzergah || h.shortName || ''}, saat bilgisi yok`}
                    >
                      <View style={{ minWidth: ROZET_SUTUNU }}>
                        <HatRozeti hat={h} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.seferYon} numberOfLines={2}>
                          {guzergah || baslikYap(h.shortName)}
                        </Text>
                        <Text style={s.seferSaat}>
                          {siklikYaz(hatSikligi(h.shortName)) ??
                            'Saat bilgisi yok · sık aralıklarla çalışır'}
                        </Text>
                      </View>
                      <Ikon ad="chevron-forward" boyut={16} renkKodu={tema.soluk} />
                    </Pressable>
                  );
                })}
              </View>
            )}

            {canliVar ? (
              <View style={s.tarife}>
                <NabizNoktasi renk={tema.vurgu} boyut={6} />
                <Text style={s.tarifeYazi}>
                  Canlı saatler İETT araç konumundan geliyor, 2 dakikada bir tazeleniyor. Metro, Marmaray, vapur ve
                  henüz öğrenilmemiş hatlar tarifeye göre.
                </Text>
              </View>
            ) : (
              <View style={s.tarife}>
                <View style={s.tarifeNokta} />
                <Text style={s.tarifeYazi}>
                  Süreler tarifeye göre. Metro, Marmaray ve vapur saatleri İBB'nin eski verisinden geldiği için
                  yaklaşık.
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const stiller = (t: Tema) =>
  StyleSheet.create({
  kok: { flex: 1, backgroundColor: t.yuzey },
  harita: { height: 230 },
  ustDugmeler: { position: 'absolute', left: 14 },
  yuvarlak: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: t.yuzey,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  govde: { flex: 1, marginTop: -22, backgroundColor: t.yuzey, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  baslik: { fontSize: 23, fontWeight: '800', color: t.yazi, letterSpacing: -0.3 },
  bilgi: { fontSize: 12.5, color: t.soluk },
  eylemler: { flexDirection: 'row', gap: 8 },
  eylem: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', height: 40, borderRadius: 11, backgroundColor: t.vurguAcik },
  eylemDolu: { backgroundColor: t.vurgu },
  eylemYazi: { fontWeight: '700', fontSize: 13, color: t.vurgu },
  altBaslik: { fontSize: 11.5, letterSpacing: 0.8, color: t.soluk, fontWeight: '700' },
  hatlar: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  bos: { color: t.soluk, paddingVertical: 10 },
  sefer: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.cizgi },
  seferYon: { fontSize: 13.5, fontWeight: '600', color: t.yazi },
  seferGuzergah: { fontSize: 12, color: t.soluk, marginTop: 1 },
  seferSaat: { fontSize: 12, color: t.soluk, fontVariant: ['tabular-nums'] },
  tarife: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tarifeNokta: { width: 8, height: 8, borderRadius: 4, backgroundColor: t.yurume },
  tarifeYazi: { flex: 1, fontSize: 11.5, color: t.soluk },
  yaklasma: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  yaklasmaYazi: { flex: 1, fontSize: 12, color: t.soluk },
  yaklasmaKalin: { color: t.yazi, fontWeight: '600' },
});
