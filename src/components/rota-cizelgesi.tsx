// Rota detayının zaman çizelgesi (yolculuk başlamadan önceki görünüm).
//
// Duraklar çizelgenin düğümleri: saat solda, renkli ray ortada (araçta hattın rengi,
// yürüyüşte noktalı), içerik sağda. Bir araç tek kart (hat ve yön; altında canlı durum ya
// da sıklık, durak sayısı, süre); dokununca yaylı açılır, ara duraklar saatleriyle tek tek
// belirir, harita o bacağa odaklanır. Yürüyüş tek ince satır, aktarma payı yanında küçük
// bir hap. İniş durağı ayrıca yazılmıyor: sıradaki düğüm o.
//
// Animasyonlar Reanimated'in yerleşim animasyonları: satırlar sırayla süzülerek gelir,
// bir kart açılınca alttakiler yerine kayar. Sistemde "hareketi azalt" açıksa
// Reanimated bunları kendisi kapatıyor.

import * as Haptics from 'expo-haptics';
import { useEffect, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInLeft,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { Pressable } from '@/components/dokun';
import { KayanMetin } from '@/components/kayan-metin';
import { canliRenk, DONUS_SIMGELERI, HatRozeti, Ikon, NabizNoktasi, useStiller } from '@/components/ulasim';
import type { YerlesikArac } from '@/lib/arac-konum';
import { kalanYaz, yasYaz } from '@/lib/arac-konum';
import { durakSaatleri } from '@/lib/bekleme';
import { bacakCanli } from '@/lib/canli';
import type { Bacak } from '@/lib/otp';
import { sikliktanYazi, type SeferBilgisi } from '@/lib/sefer';
import { adinSonParcasi, metrobusYonu } from '@/lib/metrobus';
import { aracAdi, baslikYap, hatEtiketi, hatRengi, metrobusMu, useTema, type Tema } from '@/lib/tema';
import type { YuruyusAdimi } from '@/lib/yuruyus';
import { istanbulSaatiYaz, mesafeYaz, saatYaz, saniyedenSaat, sureYaz } from '@/lib/zaman';

const iso = (b: Bacak, uc: 'start' | 'end') => b[uc].estimated?.time ?? b[uc].scheduledTime;
const an = (b: Bacak, uc: 'start' | 'end') => Date.parse(iso(b, uc) ?? '');
/** Satırların sırayla gelişi: ilki biraz bekler, sonrakiler bu arayla. */
const GIRIS_GECIKMESI = 70;
const GIRIS_ARALIGI = 45;
const YERLESIM = LinearTransition.springify().damping(22).stiffness(220);

// ---------------------------------------------------------------- özet başlık

/** Yaprağın başlığı: süre, saat aralığı, çipler ve bacakların oransal şeridi (soldan dolar). */
export function RotaOzeti({
  sure,
  bas,
  bitis,
  varisAdi,
  aktarma,
  yurume,
  ucret,
  bacaklar,
}: {
  sure: number | null;
  bas: string | null;
  bitis: string | null;
  varisAdi?: string | null;
  aktarma: number;
  yurume: number | null;
  ucret?: string | null;
  bacaklar: Bacak[];
}) {
  const s = useStiller(stiller);
  const dk = Math.max(0, Math.round((sure ?? 0) / 60));
  return (
    <View style={s.ozet}>
      <View style={s.ozetUst}>
        <View style={s.tabanSatir} accessible accessibilityLabel={`${dk} dakika`}>
          {dk >= 60 && (
            <>
              <KayanMetin metin={String(Math.floor(dk / 60))} style={s.ozetSure} />
              <Text style={s.ozetBirim}>{' sa '}</Text>
            </>
          )}
          {(dk % 60 > 0 || dk < 60) && (
            <>
              <KayanMetin metin={String(dk % 60)} style={s.ozetSure} />
              <Text style={s.ozetBirim}> dk</Text>
            </>
          )}
        </View>
        <View style={{ alignItems: 'flex-end', flexShrink: 1 }}>
          <View style={s.tabanSatir}>
            <KayanMetin metin={saatYaz(bas)} style={s.ozetAralik} />
            <Text style={s.ozetAralik}>{' → '}</Text>
            <KayanMetin metin={saatYaz(bitis)} style={s.ozetAralik} />
          </View>
          {!!varisAdi && (
            <Text style={s.ozetVaris} numberOfLines={1}>
              {`varış ${varisAdi}`}
            </Text>
          )}
        </View>
      </View>
      <View style={s.ciplar}>
        <Text style={s.cip}>{aktarma === 0 ? 'Aktarmasız' : `${aktarma} aktarma`}</Text>
        <Text style={s.cip}>{`${sureYaz(yurume)} yürüme`}</Text>
        {!!ucret && <Text style={[s.cip, s.cipUcret]}>{ucret}</Text>}
      </View>
      <AkanSerit bacaklar={bacaklar} />
    </View>
  );
}

/** Bacakların süreyle orantılı şeridi; parçalar sırayla soldan dolar. */
function AkanSerit({ bacaklar }: { bacaklar: Bacak[] }) {
  const tema = useTema();
  const s = useStiller(stiller);
  return (
    <View style={s.serit}>
      {bacaklar.map((b, i) => (
        <SeritParcasi
          key={i}
          sira={i}
          flex={Math.max(b.duration ?? 1, 1)}
          renk={b.transitLeg ? hatRengi(b.route, tema) : tema.cizgi}
          yuru={!b.transitLeg}
        />
      ))}
    </View>
  );
}

function SeritParcasi({ sira, flex, renk, yuru }: { sira: number; flex: number; renk: string; yuru: boolean }) {
  const s = useStiller(stiller);
  const olcek = useSharedValue(0);
  useEffect(() => {
    olcek.value = withDelay(sira * 70, withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) }));
  }, [olcek, sira]);
  const stil = useAnimatedStyle(() => ({ transform: [{ scaleX: olcek.value }], opacity: olcek.value }));
  return <Animated.View style={[s.seritParca, { flex, backgroundColor: renk, transformOrigin: 'left' }, yuru && s.seritYuru, stil]} />;
}

// ---------------------------------------------------------------- çizelge

type Satir = {
  tur: 'baslangic' | 'durak' | 'varis';
  saat: string | null;
  /** Kalkışın canlı sapması (yalnız biniş düğümünde). */
  canli: ReturnType<typeof bacakCanli>;
  ad: string;
  /** Düğümün rengi ve alttaki rayın türü. */
  renk: string;
  ray: { renk: string; yuru: boolean } | null;
  /** Bu düğümden kalkan araç bacağı ve sonra yapılan yürüyüş (bacak sırası). */
  arac?: number;
  yuru?: number;
  /** Aynı durakta aktarma (arada yürüyüş yok): bekleme dakikası. */
  bekleme?: number | null;
};

/** Bacak listesinden düğümler: biniş durağı, iniş durağı (sonraki biniş de olabilir), varış. */
function satirlariKur(bacaklar: Bacak[], tema: Tema, varisAdi?: string | null): Satir[] {
  const satirlar: Satir[] = [];
  let son: Satir | null = null;
  for (let i = 0; i < bacaklar.length; i++) {
    const b = bacaklar[i];
    if (!b.transitLeg) {
      if (!son) {
        son = { tur: 'baslangic', saat: iso(b, 'start'), canli: null, ad: '', renk: tema.yurume, ray: null };
        satirlar.push(son);
      }
      son.yuru = i;
      son.ray = { renk: tema.yurume, yuru: true };
      continue;
    }
    const renk = hatRengi(b.route, tema);
    const canli = bacakCanli(b.start.scheduledTime, b.start.estimated?.time);
    let binis: Satir;
    if (son && son.tur === 'durak' && son.yuru == null && son.arac == null) {
      // Aynı durakta aktarma: iniş düğümü biniş düğümü olur.
      binis = son;
      const dk = Math.floor((an(b, 'start') - an(bacaklar[i - 1], 'end')) / 60_000);
      binis.bekleme = Number.isNaN(dk) ? null : dk;
      binis.saat = iso(b, 'start');
      binis.canli = canli;
    } else {
      binis = { tur: 'durak', saat: iso(b, 'start'), canli, ad: baslikYap(b.from.name), renk, ray: null };
      satirlar.push(binis);
    }
    binis.arac = i;
    binis.ray = { renk, yuru: false };
    son = { tur: 'durak', saat: iso(b, 'end'), canli: null, ad: baslikYap(b.to.name), renk, ray: null };
    satirlar.push(son);
  }
  // Son düğüm varış: son yürüyüşün sonu ya da son aracın inişi.
  const sonBacak = bacaklar[bacaklar.length - 1];
  if (sonBacak && !sonBacak.transitLeg) {
    satirlar.push({
      tur: 'varis',
      saat: iso(sonBacak, 'end'),
      canli: null,
      ad: varisAdi ? baslikYap(varisAdi) : 'Varış',
      renk: tema.yazi,
      ray: null,
    });
  } else if (son) {
    son.tur = 'varis';
  }
  return satirlar;
}

/** Yürüyüşten sonra binilecek araca kadar bekleme (dk); yetişilemiyorsa eksi. */
function yuruyusBeklemesi(bacaklar: Bacak[], i: number): number | null {
  const b = bacaklar[i];
  const sonraki = bacaklar[i + 1];
  if (!b || b.transitLeg || !sonraki?.transitLeg) return null;
  const dk = Math.floor((an(sonraki, 'start') - an(b, 'end')) / 60_000);
  return Number.isNaN(dk) ? null : dk;
}

export type CizelgeUcreti = {
  baslik: string;
  toplam: string;
  satirlar: { hat: Bacak['route']; aciklama: string; tutar: string }[];
  not: string;
};

export function RotaCizelgesi({
  bacaklar,
  duraklar,
  seferler,
  esdegerHatlar,
  binisOtobusleri,
  yaklasmaUyarisi,
  uyariDegistir,
  yolTarifleri,
  oranlar,
  acikBacaklar,
  bacagiAcKapa,
  varisAdi,
  ucret,
  ucretAcik,
  ucretAcKapa,
}: {
  bacaklar: Bacak[];
  duraklar: { gtfsId: string; ad: string }[][];
  seferler: Record<number, SeferBilgisi>;
  esdegerHatlar: Record<number, string[]>;
  binisOtobusleri: Record<number, { otobus: YerlesikArac; kalan: number }>;
  yaklasmaUyarisi: Record<number, boolean>;
  uyariDegistir: (i: number) => void;
  yolTarifleri: YuruyusAdimi[][];
  oranlar: Record<number, number[]>;
  acikBacaklar: Record<number, boolean>;
  bacagiAcKapa: (i: number) => void;
  varisAdi?: string | null;
  ucret: CizelgeUcreti | null;
  ucretAcik: boolean;
  ucretAcKapa: () => void;
}) {
  const tema = useTema();
  const s = useStiller(stiller);
  const satirlar = satirlariKur(bacaklar, tema, varisAdi);
  const ac = (i: number) => {
    Haptics.selectionAsync().catch(() => {});
    bacagiAcKapa(i);
  };

  return (
    <View style={s.cizelge}>
      {satirlar.map((x, k) => {
        const sonSatir = k === satirlar.length - 1;
        return (
          <Animated.View
            key={`${k}-${x.ad}`}
            entering={FadeInDown.delay(GIRIS_GECIKMESI + k * GIRIS_ARALIGI).duration(380)}
            layout={YERLESIM}
            style={s.satir}
          >
            <View style={s.saatSutun}>
              <Text style={[s.saat, x.tur === 'varis' && s.saatKalin]}>{saatYaz(x.saat)}</Text>
              {x.canli && (
                <Text style={[s.sapma, { color: canliRenk(x.canli.sinif, tema) }]} numberOfLines={1}>
                  {x.canli.dakika === 0 ? 'canlı' : x.canli.dakika > 0 ? `+${x.canli.dakika} dk` : `${x.canli.dakika} dk`}
                </Text>
              )}
            </View>
            <View style={s.ray}>
              {x.tur === 'baslangic' ? (
                <View style={[s.dugumKucuk, { backgroundColor: tema.yurume }]} />
              ) : x.tur === 'varis' ? (
                <View style={[s.dugumVaris, { backgroundColor: tema.yazi }]} />
              ) : (
                <View style={[s.dugum, { borderColor: x.renk }]} />
              )}
              {x.ray && !sonSatir && (
                <View style={[s.rayCizgi, x.ray.yuru ? s.rayYuru : { backgroundColor: x.ray.renk }]} />
              )}
            </View>
            <View style={[s.icerik, sonSatir && { paddingBottom: 4 }]}>
              {!!x.ad && (
                <View style={s.durakSatiri}>
                  <Text style={[s.durakAdi, x.tur === 'varis' && s.varisAdi]} numberOfLines={1}>
                    {x.ad}
                  </Text>
                  {x.bekleme != null && <BeklemeHapi dakika={x.bekleme} aktarma />}
                </View>
              )}
              {x.tur === 'varis' && !x.ad && <Text style={s.durakAdi}>Varış</Text>}
              {x.arac != null && (
                <AracKarti
                  b={bacaklar[x.arac]}
                  liste={duraklar[x.arac] ?? []}
                  sefer={seferler[x.arac]}
                  esdeger={esdegerHatlar[x.arac]}
                  otobus={binisOtobusleri[x.arac]}
                  uyari={!!yaklasmaUyarisi[x.arac]}
                  uyariDegistir={() => uyariDegistir(x.arac!)}
                  oran={oranlar[x.arac]}
                  acik={!!acikBacaklar[x.arac]}
                  ac={() => ac(x.arac!)}
                />
              )}
              {x.yuru != null && (
                <YuruyusSatiri
                  b={bacaklar[x.yuru]}
                  tarif={yolTarifleri[x.yuru] ?? []}
                  bekleme={yuruyusBeklemesi(bacaklar, x.yuru)}
                  acik={!!acikBacaklar[x.yuru]}
                  ac={() => ac(x.yuru!)}
                />
              )}
            </View>
          </Animated.View>
        );
      })}

      {ucret && (
        <Animated.View
          entering={FadeIn.delay(GIRIS_GECIKMESI + satirlar.length * GIRIS_ARALIGI).duration(360)}
          layout={YERLESIM}
        >
          <Pressable
            style={s.ucret}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              ucretAcKapa();
            }}
            accessibilityRole="button"
            accessibilityState={{ expanded: ucretAcik }}
            accessibilityLabel={`${ucret.baslik} ${ucret.toplam}. ${ucretAcik ? 'Dökümü gizle' : 'Dökümü göster'}`}
          >
            <View style={s.ucretUst}>
              <Text style={s.ucretBaslik}>{ucret.baslik}</Text>
              <Text style={s.ucretToplam}>{ucret.toplam}</Text>
              <DonenOk acik={ucretAcik} renk={tema.soluk} />
            </View>
            {ucretAcik && (
              <Animated.View entering={FadeIn.duration(220)} style={{ gap: 6, marginTop: 8 }}>
                {ucret.satirlar.map((u, i) => (
                  <View key={i} style={s.ucretSatiri}>
                    <HatRozeti hat={u.hat} kucuk />
                    <Text style={s.ucretAciklama} numberOfLines={1}>
                      {u.aciklama}
                    </Text>
                    <Text style={s.ucretTutar}>{u.tutar}</Text>
                  </View>
                ))}
                <Text style={s.ucretNot}>{ucret.not}</Text>
              </Animated.View>
            )}
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
}

/** Açık/kapalı oku: 180° döner. */
function DonenOk({ acik, renk }: { acik: boolean; renk: string }) {
  const aci = useSharedValue(acik ? 180 : 0);
  useEffect(() => {
    aci.value = withTiming(acik ? 180 : 0, { duration: 280, easing: Easing.out(Easing.cubic) });
  }, [acik, aci]);
  const stil = useAnimatedStyle(() => ({ transform: [{ rotate: `${aci.value}deg` }] }));
  return (
    <Animated.View style={stil}>
      <Ikon ad="chevron-down" boyut={16} renkKodu={renk} />
    </Animated.View>
  );
}

/** "4 dk bekleme" (yeşil); 2 dakikadan azsa turuncu, hiç pay yoksa "yetişmek zor". */
function BeklemeHapi({ dakika, aktarma = false }: { dakika: number; aktarma?: boolean }) {
  const tema = useTema();
  const s = useStiller(stiller);
  const sikisik = dakika <= 2;
  return (
    <Animated.Text
      entering={FadeIn.delay(260).duration(300)}
      style={[s.hap, sikisik && { color: tema.uyari, backgroundColor: tema.uyariAcik }]}
    >
      {dakika < 0 ? 'yetişmek zor' : dakika === 0 ? 'hemen aktarma' : `${dakika} dk ${aktarma ? 'aktarma' : 'bekleme'}`}
    </Animated.Text>
  );
}

function AracKarti({
  b,
  liste,
  sefer,
  esdeger,
  otobus,
  uyari,
  uyariDegistir,
  oran,
  acik,
  ac,
}: {
  b: Bacak;
  liste: { gtfsId: string; ad: string }[];
  sefer?: SeferBilgisi;
  esdeger?: string[];
  otobus?: { otobus: YerlesikArac; kalan: number };
  uyari: boolean;
  uyariDegistir: () => void;
  oran?: number[];
  acik: boolean;
  ac: () => void;
}) {
  const tema = useTema();
  const s = useStiller(stiller);
  const renk = hatRengi(b.route, tema);
  const durakSayisi = Math.max(liste.length - 1, 1);
  // Metrobüs rozeti yalnız logo: yön araç tabelasındaki gibi, kod (ve aynı yolu giden öbürleri) yanında.
  const metrobus = metrobusMu(b.route?.shortName);
  const yon = metrobus
    ? `${metrobusYonu(b.headsign, adinSonParcasi(b.route?.longName))} yönü · ${[b.route?.shortName ?? '', ...(esdeger ?? [])].filter(Boolean).join(' / ')}`
    : b.headsign
      ? `${baslikYap(b.headsign)} yönü`
      : aracAdi(b.route?.mode ?? b.mode);
  const saatler = oran && oran.length === liste.length ? durakSaatleri(oran, an(b, 'start'), an(b, 'end')) : null;
  const binisDk = Math.round((an(b, 'start') - Date.now()) / 60_000);
  const guzergahAdi = hatEtiketi(b.route?.shortName, b.route?.mode ?? b.mode, b.route?.agency?.name, b.route?.longName).ayrinti;
  return (
    <Animated.View layout={YERLESIM} style={[s.kart, acik && s.kartAcik]}>
      <Pressable
        onPress={ac}
        accessibilityRole="button"
        accessibilityState={{ expanded: acik }}
        accessibilityLabel={`${b.route?.shortName ?? ''}, ${yon}, ${durakSayisi} durak. ${acik ? 'Durakları gizle' : 'Durakları göster'}`}
      >
        <View style={s.kartUst}>
          <HatRozeti hat={b.route} kucuk ekHatlar={esdeger} />
          <Text style={s.kartYon} numberOfLines={1}>
            {yon}
          </Text>
          <DonenOk acik={acik} renk={acik ? renk : tema.soluk} />
        </View>
        <View style={s.kartAlt}>
          {otobus ? (
            <>
              <NabizNoktasi renk={otobus.otobus.sinif === 'eski' ? tema.soluk : tema.vurgu} boyut={6} />
              <KayanMetin
                metin={`${kalanYaz(otobus.kalan)}${binisDk > 0 ? ` · ~${binisDk} dk` : ''}`}
                style={[s.kartCanli, otobus.otobus.sinif === 'eski' && { color: tema.soluk }]}
                kapStili={{ flexShrink: 1, overflow: 'hidden' }}
              />
            </>
          ) : sefer?.aralikDk != null ? (
            <Text style={s.kartBilgi} numberOfLines={1}>
              {sikliktanYazi(sefer).replace(/^Yaklaşık her /, 'her ').replace(/^Her /, 'her ')}
            </Text>
          ) : null}
          <Text style={s.kartBilgi} numberOfLines={1}>
            {`${otobus || sefer?.aralikDk != null ? '· ' : ''}${durakSayisi} durak · ${sureYaz(b.duration)}`}
          </Text>
          {otobus && (
            <Pressable
              onPress={uyariDegistir}
              hitSlop={10}
              style={[s.zilKucuk, uyari && { backgroundColor: renk, borderColor: renk }]}
              accessibilityRole="switch"
              accessibilityState={{ checked: uyari }}
              accessibilityLabel="Otobüs 3 durak kalınca haber ver. Uygulama açıkken çalışır."
            >
              <Ikon ad={uyari ? 'notifications' : 'notifications-outline'} boyut={13} renkKodu={uyari ? '#fff' : tema.soluk} />
            </Pressable>
          )}
        </View>
      </Pressable>

      {acik && (
        <Animated.View entering={FadeIn.duration(200)} style={s.panel}>
          {(sefer?.aralikDk != null || sefer?.sonrakiSaniye != null || sefer?.sonSefer) && (
            <Text style={[s.panelBilgi, { color: sefer?.sonSefer ? tema.uyari : renk }]}>
              {[
                sefer?.aralikDk != null ? sikliktanYazi(sefer) : '',
                sefer?.sonSefer
                  ? 'Bu, tarifedeki son sefer'
                  : sefer?.sonrakiSaniye != null
                    ? `sonraki ${saniyedenSaat(sefer.sonrakiSaniye)}`
                    : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          )}
          {!!guzergahAdi && <Text style={s.panelNot}>{guzergahAdi}</Text>}
          {!!esdeger?.length && (
            <Text style={s.panelNot}>{`${esdeger.join(', ')} ile de gidebilirsin; hangisi önce gelirse.`}</Text>
          )}
          {otobus && (
            <Text style={s.panelNot}>{`Otobüsün konumu ${yasYaz(otobus.otobus.yasSn)}`}</Text>
          )}
          <View style={{ marginTop: 4 }}>
            {liste.map((d, j) => {
              const ilk = j === 0;
              const son = j === liste.length - 1;
              const saat = saatler?.[j] != null && !Number.isNaN(saatler[j]) ? istanbulSaatiYaz(Math.round(saatler[j] / 1000)) : '';
              return (
                <Animated.View
                  key={`${d.gtfsId}-${j}`}
                  entering={FadeInLeft.delay(Math.min(j, 20) * 28).duration(240)}
                  style={s.durak}
                >
                  <View style={s.durakRay}>
                    <View style={[s.durakRayUst, { backgroundColor: ilk ? 'transparent' : renk }]} />
                    <View style={[s.durakRayAlt, { backgroundColor: son ? 'transparent' : renk }]} />
                    <View
                      style={[
                        ilk || son ? s.durakNoktaUc : s.durakNokta,
                        { borderColor: renk, backgroundColor: son ? renk : tema.yuzey },
                      ]}
                    />
                  </View>
                  <Text style={[s.durakYazi, (ilk || son) && s.durakYaziKalin]} numberOfLines={1}>
                    {baslikYap(d.ad)}
                  </Text>
                  <Text style={s.durakSaati}>{saat}</Text>
                </Animated.View>
              );
            })}
          </View>
        </Animated.View>
      )}
    </Animated.View>
  );
}

function YuruyusSatiri({
  b,
  tarif,
  bekleme,
  acik,
  ac,
}: {
  b: Bacak;
  tarif: YuruyusAdimi[];
  bekleme: number | null;
  acik: boolean;
  ac: () => void;
}) {
  const tema = useTema();
  const s = useStiller(stiller);
  const icerik: ReactNode = (
    <View style={s.yuru}>
      <Ikon ad="walk" boyut={14} renkKodu={tema.soluk} />
      <Text style={s.yuruYazi}>
        <Text style={s.yuruKalin}>{sureYaz(b.duration)}</Text>
        {` · ${mesafeYaz(b.distance)}`}
      </Text>
      {bekleme != null && <BeklemeHapi dakika={bekleme} />}
      {tarif.length > 0 && <DonenOk acik={acik} renk={tema.soluk} />}
    </View>
  );
  return (
    <Animated.View layout={YERLESIM}>
      {tarif.length > 0 ? (
        <Pressable
          onPress={ac}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityState={{ expanded: acik }}
          accessibilityLabel={`${sureYaz(b.duration)} yürüyüş, ${mesafeYaz(b.distance)}. ${acik ? 'Yol tarifini gizle' : 'Yol tarifini göster'}`}
        >
          {icerik}
        </Pressable>
      ) : (
        icerik
      )}
      {acik && (
        <View style={s.tarif}>
          {tarif.map((adim, j) => (
            <Animated.View key={j} entering={FadeInLeft.delay(j * 30).duration(220)} style={s.tarifSatiri}>
              <Ikon ad={DONUS_SIMGELERI[adim.donus]} boyut={14} renkKodu={tema.soluk} />
              <Text style={s.tarifMetin}>{adim.metin}</Text>
              {!!adim.mesafe && <Text style={s.tarifMesafe}>{adim.mesafe}</Text>}
            </Animated.View>
          ))}
        </View>
      )}
    </Animated.View>
  );
}

const DUGUM = 14;

const stiller = (t: Tema) =>
  StyleSheet.create({
    // özet
    ozet: { gap: 8 },
    ozetUst: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 },
    ozetSure: { fontSize: 30, fontWeight: '800', color: t.yazi, letterSpacing: -0.5, lineHeight: 34 },
    ozetBirim: { fontSize: 16, fontWeight: '700', color: t.soluk },
    tabanSatir: { flexDirection: 'row', alignItems: 'baseline' },
    ozetAralik: { fontSize: 15, fontWeight: '700', color: t.yazi, fontVariant: ['tabular-nums'] },
    ozetVaris: { fontSize: 12, color: t.soluk, marginTop: 1 },
    ciplar: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    cip: {
      fontSize: 12,
      fontWeight: '600',
      color: t.yazi,
      backgroundColor: t.yuzeyIkincil,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.cizgi,
      borderRadius: 999,
      paddingHorizontal: 9,
      paddingVertical: 3,
      overflow: 'hidden',
    },
    cipUcret: { color: t.vurgu, backgroundColor: t.vurguAcik, borderColor: t.vurguAcik },
    serit: { flexDirection: 'row', height: 8, gap: 3, marginTop: 2 },
    seritParca: { borderRadius: 4 },
    seritYuru: { opacity: 0.8 },

    // çizelge
    cizelge: { paddingTop: 12, paddingBottom: 10 },
    satir: { flexDirection: 'row', gap: 8 },
    saatSutun: { width: 44, alignItems: 'flex-end', paddingTop: 1 },
    saat: { fontSize: 13, fontWeight: '700', color: t.yazi, fontVariant: ['tabular-nums'] },
    saatKalin: { fontWeight: '800' },
    sapma: { fontSize: 10.5, fontWeight: '700', marginTop: 1 },
    ray: { width: 18, alignItems: 'center' },
    rayCizgi: { flex: 1, width: 4, borderRadius: 2, marginTop: -2, marginBottom: -4 },
    rayYuru: { width: 0, borderLeftWidth: 3, borderStyle: 'dotted', borderColor: t.yurume },
    dugum: { width: DUGUM, height: DUGUM, borderRadius: DUGUM / 2, borderWidth: 3.5, backgroundColor: t.yuzey, marginTop: 2, zIndex: 1 },
    dugumKucuk: { width: 9, height: 9, borderRadius: 5, marginTop: 5, marginBottom: 4 },
    dugumVaris: { width: 13, height: 13, borderRadius: 3, marginTop: 3 },
    icerik: { flex: 1, minWidth: 0, paddingBottom: 14 },
    durakSatiri: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    durakAdi: { flexShrink: 1, fontSize: 15, fontWeight: '700', color: t.yazi },
    varisAdi: { fontWeight: '800' },
    hap: {
      fontSize: 11,
      fontWeight: '700',
      color: t.vurgu,
      backgroundColor: t.vurguAcik,
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 2,
      overflow: 'hidden',
    },

    // araç kartı
    kart: {
      marginTop: 7,
      borderRadius: 14,
      backgroundColor: t.yuzey,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.cizgi,
      shadowColor: '#000',
      shadowOpacity: 0.05,
      shadowRadius: 3,
      shadowOffset: { width: 0, height: 1 },
      elevation: 1,
      overflow: 'hidden',
    },
    kartAcik: { shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 4 },
    kartUst: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingTop: 9, paddingBottom: 6 },
    kartYon: { flex: 1, fontSize: 13, color: t.yazi },
    kartAlt: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingBottom: 9, minHeight: 22 },
    kartCanli: { fontSize: 12, fontWeight: '700', color: t.vurgu, flexShrink: 1 },
    kartBilgi: { fontSize: 12, color: t.soluk, flexShrink: 1 },
    zilKucuk: {
      marginLeft: 'auto',
      width: 26,
      height: 26,
      borderRadius: 13,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.cizgi,
      alignItems: 'center',
      justifyContent: 'center',
    },
    panel: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.cizgi,
      backgroundColor: t.yuzeyIkincil,
      paddingHorizontal: 10,
      paddingTop: 8,
      paddingBottom: 8,
      gap: 3,
    },
    panelBilgi: { fontSize: 12, fontWeight: '700' },
    panelNot: { fontSize: 12, color: t.soluk },
    durak: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 26 },
    durakRay: { width: 12, height: 26, alignItems: 'center', justifyContent: 'center' },
    durakRayUst: { position: 'absolute', top: 0, height: 13, width: 3 },
    durakRayAlt: { position: 'absolute', bottom: 0, height: 13, width: 3 },
    durakNokta: { width: 9, height: 9, borderRadius: 5, borderWidth: 2 },
    durakNoktaUc: { width: 12, height: 12, borderRadius: 6, borderWidth: 3 },
    durakYazi: { flex: 1, fontSize: 13, color: t.yazi },
    durakYaziKalin: { fontWeight: '700' },
    durakSaati: { fontSize: 12, color: t.soluk, fontVariant: ['tabular-nums'] },

    // yürüyüş
    yuru: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 4 },
    yuruYazi: { fontSize: 12.5, color: t.soluk },
    yuruKalin: { color: t.yazi, fontWeight: '600' },
    tarif: { marginTop: 6, gap: 6 },
    tarifSatiri: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    tarifMetin: { flex: 1, fontSize: 12.5, color: t.yazi },
    tarifMesafe: { fontSize: 12, color: t.soluk },

    // ücret
    ucret: { marginTop: 4, borderRadius: 14, backgroundColor: t.yuzeyIkincil, padding: 12 },
    ucretUst: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    ucretBaslik: { flex: 1, fontSize: 13, fontWeight: '600', color: t.yazi },
    ucretToplam: { fontSize: 15, fontWeight: '800', color: t.vurgu },
    ucretSatiri: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    ucretAciklama: { flex: 1, fontSize: 12.5, color: t.soluk },
    ucretTutar: { fontSize: 12.5, fontWeight: '700', color: t.yazi },
    ucretNot: { fontSize: 11.5, color: t.soluk, marginTop: 2 },
  });
