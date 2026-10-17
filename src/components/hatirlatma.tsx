// Yolculuk hatırlatma sayfası: rota detayında zil düğmesine basınca açılan alt sayfa.
//
// Yolculuğun zaman çizgisi: hangi bildirim kaçta, ne diyerek çıkacak, her biri tek tek
// açılıp kapanıyor (hatirlatma-plan.ts). Türler: yola çıkış, otobüs yaklaşıyor,
// aktarmalar, iniş. Kurulunca aynı sayfa kurulu bildirimleri gösteriyor: saati canlı
// veriyle kaydıysa ne kadar kaydığı yazıyor, tek tek kaldırılabiliyor.
//
// Bildirimler telefona önceden zamanlanıyor; uygulama kapalıyken de çıkıyorlar. Uygulama
// açıldıkça saatler canlı veriyle yeniden hesaplanıyor (hatirlatma-tazele.ts).

import { useMemo, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Pressable } from '@/components/dokun';
import { ModalSayfa } from '@/components/modal-sayfa';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HatRozeti, Ikon, useStiller } from '@/components/ulasim';
import {
  grubuIptal,
  hatirlaticiIptal,
  hatirlaticiSaati,
  izinIste,
  kaymaDk,
  planiKur,
  useHatirlaticilar,
  type Hatirlatici,
} from '@/lib/bildirim';
import { hatEtiketi } from '@/lib/hat-adi';
import { hatirlatmaPlani, ONCE_SECENEKLERI, varsayilanSecim, type PlanOgesi } from '@/lib/hatirlatma-plan';
import type { Bacak, Guzergah } from '@/lib/otp';
import { secimTiki } from '@/lib/dokunsal';
import { useTema, type Tema } from '@/lib/tema';
import { saatEkli } from '@/lib/zaman';

type Props = {
  acik: boolean;
  kapat: () => void;
  /** Yolculuğun güncel güzergâhı (saatler canlı veriyle yeniden kurulmuş olabilir). */
  guzergah: Guzergah;
  /** Bacak sırasıyla aynı yolu giden öbür hatlar ("97GE"); ilk biniş metninde. */
  esdegerHatlar: Record<number, string[]>;
  /** Rota listesinin eşdeğer parametresi ve varış adı: bildirimden açılınca aynı ekran. */
  esdeger?: string;
  hedef?: string;
  /** "Konumum → Üniversite" */
  baslik: string;
  /** Bu yolculuğun hatırlatıcılarını birlikte tutan etiket. */
  grup: string;
};

const an = (z: Bacak['start']) => Date.parse(z.estimated?.time ?? z.scheduledTime);
/** Bu kadar yakın bir an için bildirim kurulmaz (bildirim.ts ile aynı). */
const EN_AZ_MS = 45_000;

export function HatirlatmaSayfasi({ acik, kapat, guzergah, esdegerHatlar, esdeger, hedef, baslik, grup }: Props) {
  const kenar = useSafeAreaInsets();
  const s = useStiller(stiller);
  const { hatirlaticilar, yolculuklar, ayar } = useHatirlaticilar();
  const kurulu = useMemo(() => hatirlaticilar.filter((h) => h.grup === grup), [hatirlaticilar, grup]);

  return (
    <ModalSayfa acik={acik} kapat={kapat}>
      <View style={[s.sayfa, { paddingBottom: kenar.bottom + 16 }]}>
        <View style={s.tutamac} />
        {kurulu.length > 0 ? (
          <KuruluGorunum
            kurulu={kurulu}
            guzergah={guzergah}
            baslik={baslik}
            guncellendi={yolculuklar[grup]?.guncellendi}
            kaldir={async () => {
              await grubuIptal(grup);
              kapat();
            }}
          />
        ) : (
          <KurmaGorunumu
            // Sayfa her açılışta varsayılan seçimle başlasın.
            key={acik ? 'acik' : 'kapali'}
            guzergah={guzergah}
            esdegerHatlar={esdegerHatlar}
            varsayilan={ayar}
            kur={async (plan, once) => {
              if (!(await izinIste())) {
                Alert.alert('Bildirim izni kapalı', 'Hatırlatma yapabilmemiz için bildirim iznini açman gerekiyor.', [
                  { text: 'Vazgeç', style: 'cancel' },
                  { text: 'Ayarları aç', onPress: () => Linking.openSettings() },
                ]);
                return;
              }
              const bacaklar = guzergah.legs;
              const kurulan = await planiKur(
                {
                  grup,
                  baslik,
                  hatlar: hatlarYazisi(guzergah, esdegerHatlar),
                  kalkis: bacaklar[0] ? an(bacaklar[0].start) : Date.now(),
                  varis: bacaklar.length ? an(bacaklar[bacaklar.length - 1].end) : Date.now(),
                  guzergah,
                  esdeger,
                  hedef,
                  ayar: { ...ayar, once },
                  kuruldu: Date.now(),
                },
                plan,
              );
              kapat();
              if (kurulan.length === 0) Alert.alert('Bildirim kurulmadı', 'Seçtiğin anların hepsi geçmiş görünüyor.');
            }}
          />
        )}
      </View>
    </ModalSayfa>
  );
}

/** Rozetlerdeki adlarla hatlar: ["97M / 97GE", "A29", "34G"]. */
export function hatlarYazisi(g: Guzergah, esdegerHatlar: Record<number, string[]>): string[] {
  return g.legs.flatMap((b, i) => {
    if (!b.transitLeg) return [];
    const ana = hatEtiketi(b.route?.shortName, b.route?.mode ?? b.mode, b.route?.agency?.name, b.route?.longName).rozet;
    return [[ana, ...(esdegerHatlar[i] ?? [])].join(' / ')];
  });
}

function YolculukSatiri({ guzergah, ek }: { guzergah: Guzergah; ek?: string }) {
  const s = useStiller(stiller);
  const bacaklar = guzergah.legs;
  const bas = bacaklar[0] ? an(bacaklar[0].start) : NaN;
  const bit = bacaklar.length ? an(bacaklar[bacaklar.length - 1].end) : NaN;
  return (
    <View style={s.yolculuk}>
      <View style={s.rozetler}>
        {bacaklar
          .filter((b) => b.transitLeg)
          .map((b, i) => (
            <HatRozeti key={i} hat={b.route} kucuk />
          ))}
      </View>
      <Text style={s.yolculukSaat}>
        {ek ?? (Number.isFinite(bas) && Number.isFinite(bit) ? `${hatirlaticiSaati(bas)} → ${hatirlaticiSaati(bit)}` : '')}
      </Text>
    </View>
  );
}

/** Yola çıkma hatırlatıcısının süresi: Tarife'deki gün seçicisi gibi tek satır. */
export function CikisSecici({ once, degistir }: { once: number; degistir: (dk: number) => void }) {
  const s = useStiller(stiller);
  return (
    <View style={s.secici} accessibilityRole="tablist">
      {ONCE_SECENEKLERI.map((dk) => {
        const secili = once === dk;
        return (
          <Pressable
            key={dk}
            geriBildirim={false}
            style={[s.secenek, secili && s.secenekSecili]}
            onPress={() => {
              if (!secili) {
                secimTiki();
                degistir(dk);
              }
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: secili }}
            accessibilityLabel={dk === 0 ? 'Tam vaktinde' : `${dk} dakika önce`}
          >
            <Text style={[s.secenekYazi, secili && s.secenekYaziSecili]} numberOfLines={1}>
              {dk === 0 ? 'Tam vaktinde' : `${dk} dk`}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Seçimin ne demek olduğu, saatle: yolculukta gerçek çıkış saatiyle ("Bildirim 00:13'te
 * gelir · yola 00:23'te çıkman gerekiyor"), Ayarlar'da örnek saatle (08:30).
 */
export function CikisOrnegi({ once, cikis }: { once: number; cikis?: number }) {
  const tema = useTema();
  const s = useStiller(stiller);
  const ornek = cikis == null;
  // Örnek saat İstanbul'da 08:30.
  const cikisAni = cikis ?? Date.UTC(2026, 0, 5, 5, 30);
  const bildirim = cikisAni - once * 60_000;
  const yaz = (ms: number) => saatEkli(Math.round(ms / 1000));
  const gecti = !ornek && bildirim - Date.now() < EN_AZ_MS;
  const metin = ornek
    ? once === 0
      ? `Örnek: ${yaz(cikisAni)} çıkman gerekiyorsa bildirim tam o dakika gelir.`
      : `Örnek: ${yaz(cikisAni)} çıkman gerekiyorsa bildirim ${yaz(bildirim)} gelir.`
    : gecti
      ? 'Bu süre geçti; daha kısa bir süre seç ya da öbür bildirimlerle yetin.'
      : once === 0
        ? `Bildirim ${yaz(bildirim)} gelir: yola çıkman gereken dakika.`
        : `Bildirim ${yaz(bildirim)} gelir · yola ${yaz(cikisAni)} çıkman gerekiyor.`;
  return (
    <View style={s.ornek}>
      <Ikon ad="notifications-outline" boyut={14} renkKodu={gecti ? tema.uyari : tema.soluk} />
      <Text style={[s.ornekYazi, gecti && { color: tema.uyari }]}>{metin}</Text>
    </View>
  );
}

function KurmaGorunumu({
  guzergah,
  esdegerHatlar,
  varsayilan,
  kur,
}: {
  guzergah: Guzergah;
  esdegerHatlar: Record<number, string[]>;
  varsayilan: { once: number; yaklasma: boolean; aktarma: boolean; inis: boolean };
  kur: (plan: PlanOgesi[], once: number) => Promise<void>;
}) {
  const tema = useTema();
  const s = useStiller(stiller);
  const [once, setOnce] = useState(varsayilan.once);
  const [calisiyor, setCalisiyor] = useState(false);
  const bacaklar = guzergah.legs;
  const cikis = bacaklar[0] ? an(bacaklar[0].start) : NaN;
  const plan = useMemo(
    () => hatirlatmaPlani(bacaklar, cikis, { ...varsayilan, once }, esdegerHatlar),
    [bacaklar, cikis, varsayilan, once, esdegerHatlar],
  );
  const [secili, setSecili] = useState(() => varsayilanSecim(plan, varsayilan));
  const simdi = Date.now();
  const uygun = (o: PlanOgesi) => o.zaman - simdi >= EN_AZ_MS;
  const kurulacak = plan.filter((o) => secili.has(o.anahtar) && uygun(o));

  const degistir = (anahtar: string) =>
    setSecili((x) => {
      const y = new Set(x);
      if (y.has(anahtar)) y.delete(anahtar);
      else y.add(anahtar);
      return y;
    });

  return (
    <>
      <Text style={s.baslik}>Hatırlat</Text>
      <YolculukSatiri guzergah={guzergah} />

      <Text style={s.altBaslik}>YOLA ÇIKMA HATIRLATICISI</Text>
      <CikisSecici once={once} degistir={setOnce} />
      <CikisOrnegi once={once} cikis={Number.isFinite(cikis) ? cikis : undefined} />

      <Text style={s.altBaslik}>BİLDİRİMLER</Text>
      <ScrollView style={s.liste} contentContainerStyle={s.cizgi}>
        {plan.map((o) => {
          const gecti = !uygun(o);
          const acik = secili.has(o.anahtar) && !gecti;
          return (
            <View key={o.anahtar} style={[s.olay, (!acik || gecti) && s.olayPasif]}>
              <View style={[s.nokta, { backgroundColor: acik ? tema.vurgu : tema.cizgi }]} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={s.olayUst}>
                  <Text style={[s.olaySaat, !acik && { color: tema.soluk }]}>{hatirlaticiSaati(o.zaman)}</Text>
                  <Text style={s.olayBaslik} numberOfLines={1}>
                    {o.baslik}
                  </Text>
                  <Switch
                    value={acik}
                    onValueChange={() => degistir(o.anahtar)}
                    disabled={gecti}
                    trackColor={{ true: tema.vurgu }}
                    style={s.anahtar}
                    accessibilityLabel={`${o.baslik} bildirimi`}
                  />
                </View>
                <Text style={s.olayMetin} numberOfLines={3}>
                  {gecti ? 'Bu an geçti.' : o.metin}{' '}
                  {!gecti && (
                    <Text style={[s.etiket, o.canli ? s.etiketCanli : s.etiketTarife]}>{o.canli ? ' CANLI ' : ' TARİFE '}</Text>
                  )}
                </Text>
              </View>
            </View>
          );
        })}
      </ScrollView>

      <Text style={s.aciklama}>
        Saatler kurulduğu anki tahmine göre. Uygulamayı açtığında, canlı izlenen araçların saatleri yeniden hesaplanır ve
        bildirimler kaydırılır.
      </Text>

      <Pressable
        style={[s.dugme, kurulacak.length === 0 && { opacity: 0.5 }]}
        onPress={async () => {
          setCalisiyor(true);
          try {
            await kur(kurulacak, once);
          } finally {
            setCalisiyor(false);
          }
        }}
        disabled={calisiyor || kurulacak.length === 0}
        accessibilityRole="button"
      >
        <Ikon ad="notifications" boyut={17} renkKodu={tema.vurguYazi} />
        <Text style={[s.dugmeYazi, { color: tema.vurguYazi }]}>
          {kurulacak.length ? `${kurulacak.length} bildirimi kur` : 'Kurulacak bildirim yok'}
        </Text>
      </Pressable>
    </>
  );
}

function KuruluGorunum({
  kurulu,
  guzergah,
  baslik,
  guncellendi,
  kaldir,
}: {
  kurulu: Hatirlatici[];
  guzergah: Guzergah;
  baslik: string;
  guncellendi?: number;
  kaldir: () => Promise<void>;
}) {
  const tema = useTema();
  const s = useStiller(stiller);
  const [calisiyor, setCalisiyor] = useState(false);
  const bacaklar = guzergah.legs;
  const bas = bacaklar[0] ? an(bacaklar[0].start) : NaN;
  const bit = bacaklar.length ? an(bacaklar[bacaklar.length - 1].end) : NaN;
  return (
    <>
      <Text style={s.baslik}>{`${kurulu.length} bildirim kurulu`}</Text>
      <YolculukSatiri
        guzergah={guzergah}
        ek={`${baslik}${Number.isFinite(bas) && Number.isFinite(bit) ? ` · ${hatirlaticiSaati(bas)} → ${hatirlaticiSaati(bit)}` : ''}`}
      />
      <ScrollView style={s.liste} contentContainerStyle={s.cizgi}>
        {kurulu.map((h) => {
          const kayma = kaymaDk(h);
          return (
            <View key={h.id} style={s.olay}>
              <View style={[s.nokta, { backgroundColor: tema.vurgu }]} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={s.olayUst}>
                  <Text style={s.olaySaat}>{hatirlaticiSaati(h.zaman)}</Text>
                  <Text style={s.olayBaslik} numberOfLines={1}>
                    {h.baslik}
                  </Text>
                  <Pressable
                    hitSlop={10}
                    onPress={() => hatirlaticiIptal(h.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`${h.baslik} bildirimini kaldır`}
                  >
                    <Ikon ad="close" boyut={18} renkKodu={tema.soluk} />
                  </Pressable>
                </View>
                <Text style={s.olayMetin} numberOfLines={3}>
                  {kayma !== 0 && (
                    <Text style={[s.etiket, s.etiketKayma]}>{` ${Math.abs(kayma)} DK ${kayma > 0 ? 'GEÇE' : 'ÖNE'} KAYDI `}</Text>
                  )}
                  {kayma !== 0 ? ' ' : ''}
                  {h.metin}
                </Text>
              </View>
            </View>
          );
        })}
      </ScrollView>
      <Text style={s.aciklama}>
        {guncellendi
          ? `Son güncelleme ${hatirlaticiSaati(guncellendi)} · uygulama açıldıkça güncellenir.`
          : 'Uygulama açıldıkça saatler canlı veriyle güncellenir.'}
      </Text>
      <Pressable
        style={[s.dugme, s.iptalDugme]}
        onPress={async () => {
          setCalisiyor(true);
          try {
            await kaldir();
          } finally {
            setCalisiyor(false);
          }
        }}
        disabled={calisiyor}
        accessibilityRole="button"
      >
        <Ikon ad="notifications-off" boyut={17} renkKodu={tema.hata} />
        <Text style={[s.dugmeYazi, { color: tema.hata }]}>Hepsini kaldır</Text>
      </Pressable>
    </>
  );
}

const stiller = (t: Tema) =>
  StyleSheet.create({
    sayfa: {
      backgroundColor: t.yuzey,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      paddingHorizontal: 16,
      paddingTop: 10,
      gap: 10,
      flexShrink: 1,
    },
    tutamac: { width: 38, height: 4, borderRadius: 2, backgroundColor: t.cizgi, alignSelf: 'center', marginBottom: 6 },
    baslik: { fontSize: 19, fontWeight: '800', color: t.yazi, letterSpacing: -0.3 },
    yolculuk: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    rozetler: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, flexShrink: 1 },
    yolculukSaat: { marginLeft: 'auto', fontSize: 12.5, color: t.soluk, fontVariant: ['tabular-nums'], flexShrink: 1, textAlign: 'right' },
    altBaslik: { fontSize: 11.5, letterSpacing: 0.8, fontWeight: '700', color: t.soluk, paddingTop: 6 },
    satir: { flexDirection: 'row', gap: 7, flexWrap: 'wrap' },
    secici: { flexDirection: 'row', padding: 2, borderRadius: 9, backgroundColor: t.cizgi },
    secenek: { flex: 1, height: 34, borderRadius: 7, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
    secenekSecili: {
      backgroundColor: t.zemin,
      shadowColor: '#000',
      shadowOpacity: 0.15,
      shadowRadius: 3,
      shadowOffset: { width: 0, height: 1 },
      elevation: 1,
    },
    secenekYazi: { fontSize: 13.5, fontWeight: '500', color: t.yazi },
    secenekYaziSecili: { fontWeight: '700', color: t.vurgu },
    ornek: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
    ornekYazi: { flex: 1, fontSize: 12.5, color: t.soluk, lineHeight: 17 },
    hap: {
      paddingHorizontal: 13,
      height: 36,
      borderRadius: 18,
      justifyContent: 'center',
      backgroundColor: t.zemin,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.cizgi,
    },
    hapSecili: { backgroundColor: t.vurguAcik, borderColor: t.vurgu },
    hapYazi: { fontSize: 13.5, fontWeight: '700', color: t.yazi },
    liste: { flexShrink: 1 },
    cizgi: { gap: 2, paddingLeft: 2 },
    olay: { flexDirection: 'row', gap: 10, paddingVertical: 6 },
    olayPasif: { opacity: 0.55 },
    nokta: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
    olayUst: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    olaySaat: { fontSize: 14.5, fontWeight: '800', color: t.vurgu, fontVariant: ['tabular-nums'], minWidth: 44 },
    olayBaslik: { flex: 1, fontSize: 14, fontWeight: '700', color: t.yazi },
    anahtar: { transform: [{ scale: 0.8 }] },
    olayMetin: { fontSize: 12.5, color: t.soluk, lineHeight: 17, marginLeft: 52, marginTop: 1 },
    etiket: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
    etiketCanli: { color: t.vurgu, backgroundColor: t.vurguAcik },
    etiketTarife: { color: t.soluk, backgroundColor: t.cizgi },
    etiketKayma: { color: t.uyari, backgroundColor: t.cizgi },
    aciklama: { fontSize: 12, color: t.soluk, lineHeight: 18, paddingTop: 2 },
    dugme: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      height: 50,
      borderRadius: 14,
      backgroundColor: t.vurgu,
      marginTop: 6,
    },
    iptalDugme: { backgroundColor: t.zemin, borderWidth: StyleSheet.hairlineWidth, borderColor: t.cizgi },
    dugmeYazi: { fontSize: 15.5, fontWeight: '700' },
  });
