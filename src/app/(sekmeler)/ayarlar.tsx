// Ayarlar sekmesi: İstanbulkart, vasıta türleri, hatırlatıcılar, yolculuk ve görünüm.
//
// Rota sunucusu, tarife ve yer verisi, sürüm gibi teknik bilgiler Hakkında ekranında
// (src/app/hakkinda.tsx). Burada yalnız sunucunun ulaşılabilir olup olmadığına bakılıyor:
// ulaşılamıyorsa Hakkında satırında kırmızıyla yazıyor, rota neden gelmiyor belli oluyor.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Pressable } from '@/components/dokun';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Ikon, type IkonAdi, useStiller, VasitaSimgesi } from '@/components/ulasim';
import { hatirlaticiIptal, hatirlaticiSaati, hepsiniIptal, izinIste, useHatirlaticilar } from '@/lib/bildirim';
import {
  ekranAcikKaydet,
  rotaSecenekleriKaydet,
  sesCinsiyetiKaydet,
  sesliTarifKaydet,
  temaTercihiKaydet,
  ucretTuruKaydet,
  useKayitlar,
  type TemaTercihi,
} from '@/lib/kayitlar';
import { konus, secilenSes, sesleriGetir, sesleriTazele } from '@/lib/konusma';
import { cinsiyetSecenekleri, sesAdi, sesKalitesi, type SesBilgisi, type SesCinsiyeti } from '@/lib/ses-secimi';
import { TARIFE_TARIHI, UCRET_ACIKLAMALARI, UCRET_ADLARI, type UcretTuru } from '@/lib/ucret';
import { sunucuBilgisiGetir } from '@/lib/otp';
import { useTema, type Tema } from '@/lib/tema';
import { turuDegistir, VASITA_ADLARI, VASITA_TURLERI, type VasitaTuru } from '@/lib/vasita';
import { secimTiki } from '@/lib/dokunsal';
import { ekranAc } from '@/lib/gezinti';
import { useScrollToTop } from 'expo-router';

export default function AyarlarEkrani() {
  // Seçili sekmeye yeniden dokununca liste başa kayar (iPhone'daki gibi).
  const liste = useRef<ScrollView>(null);
  useScrollToTop(liste);
  const kenar = useSafeAreaInsets();
  const tema = useTema();
  const s = useStiller(stiller);

  /** Rota sunucusu: null bakılıyor, true/false cevap. */
  const [sunucuBagli, setSunucuBagli] = useState<boolean | null>(null);
  /** Aşağı çekerek yenileme (RefreshControl'ün kendi göstergesi). */
  const [cekiliyor, setCekiliyor] = useState(false);
  const { hatirlaticilar, izin, yenile: hatirlaticilariYenile } = useHatirlaticilar();
  const { ucretTuru, ekranAcik, sesliTarif, sesCinsiyeti, temaTercihi, rotaSecenekleri } = useKayitlar();
  const kapaliTurler = rotaSecenekleri.kapali;
  const turuAyarla = (tur: VasitaTuru, acik: boolean) => {
    const yeni = turuDegistir(kapaliTurler, tur, acik);
    // Son açık tür kapatılamıyor: liste değişmezse anahtar geri döner, titreşim olmaz.
    if (yeni.length !== kapaliTurler.length) secimTiki();
    rotaSecenekleriKaydet({ ...rotaSecenekleri, kapali: yeni });
  };
  const [kullanilanSes, setKullanilanSes] = useState<{ ses: SesBilgisi; uydu: boolean } | null | undefined>(undefined);
  // Telefonda Türkçe ses hangi cinsiyetlerde var; ikisi de yoksa seçim gösterilmez (iPhone'da yalnız Yelda).
  const [cinsiyetler, setCinsiyetler] = useState<SesCinsiyeti[]>([]);

  // Hangi sesin kullanılacağı. Kullanıcı iOS ayarlarından yeni ses indirip dönünce tazelenir.
  useEffect(() => {
    let iptal = false;
    const bak = () => {
      sesleriGetir().then((v) => {
        if (!iptal) setCinsiyetler(cinsiyetSecenekleri(v));
      });
      return secilenSes(sesCinsiyeti).then((s) => {
        if (!iptal) setKullanilanSes(s);
      });
    };
    bak();
    const abone = AppState.addEventListener('change', (d) => {
      if (d === 'active') {
        sesleriTazele();
        bak();
      }
    });
    return () => {
      iptal = true;
      abone.remove();
    };
  }, [sesCinsiyeti]);

  const sunucuyaBak = useCallback(async () => {
    try {
      await sunucuBilgisiGetir();
      setSunucuBagli(true);
    } catch {
      setSunucuBagli(false);
    }
  }, []);

  useEffect(() => {
    sunucuyaBak();
  }, [sunucuyaBak]);

  const yenile = useCallback(async () => {
    await Promise.all([sunucuyaBak(), hatirlaticilariYenile()]);
  }, [sunucuyaBak, hatirlaticilariYenile]);

  return (
    <ScrollView
      ref={liste}
      style={s.kok}
      contentContainerStyle={{ paddingTop: kenar.top + 6, paddingBottom: kenar.bottom + 24 }}
      refreshControl={
        <RefreshControl
          refreshing={cekiliyor}
          tintColor={tema.vurgu}
          onRefresh={async () => {
            setCekiliyor(true);
            await yenile();
            setCekiliyor(false);
          }}
        />
      }
    >
      <Text style={s.baslik}>Ayarlar</Text>

      <Text style={s.bolumBaslik}>İSTANBULKART</Text>
      <View style={s.kutu}>
        <View style={s.haplar}>
          {(Object.keys(UCRET_ADLARI) as UcretTuru[]).map((t) => (
            <Pressable
              key={t}
              style={[s.hap, ucretTuru === t && s.hapSecili]}
              hitSlop={{ top: 5, bottom: 5 }}
              onPress={() => {
                secimTiki();
                ucretTuruKaydet(t);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: ucretTuru === t }}
            >
              <Text style={[s.hapYazi, ucretTuru === t && { color: tema.vurgu }]}>{UCRET_ADLARI[t]}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={s.aciklama}>{UCRET_ACIKLAMALARI[ucretTuru]}</Text>
        <Text style={s.aciklama}>
          {`Rota ücretleri ${TARIFE_TARIHI} tarihli İBB tarifesine göre hesaplanır. İlk biniş tam bilet, sonraki binişler aktarma bedelidir; aktarma hakkı 120 dakika sürer. Metrobüs, Marmaray ve M11 durak sayısına göre ücretlendirilir.`}
        </Text>
      </View>

      <Text style={s.bolumBaslik}>VASITA TÜRÜ TERCİHLERİ</Text>
      <View style={[s.kutu, s.liste]}>
        {VASITA_TURLERI.map((tur, i) => (
          <View key={tur} style={[s.vasitaSatiri, i > 0 && s.vasitaAyrac]}>
            <VasitaSimgesi tur={tur} />
            <View style={{ flex: 1 }}>
              <Text style={s.satirBaslik}>{VASITA_ADLARI[tur]}</Text>
              {!!VASITA_ALT[tur] && <Text style={s.vasitaAlt}>{VASITA_ALT[tur]}</Text>}
            </View>
            <Switch
              value={!kapaliTurler.includes(tur)}
              onValueChange={(acik) => turuAyarla(tur, acik)}
              trackColor={{ true: tema.vurgu }}
              accessibilityLabel={VASITA_ADLARI[tur]}
            />
          </View>
        ))}
      </View>
      <Text style={s.disAciklama}>
        Kapattığın türler rotalarda hiç kullanılmaz. Onlar olmadan gidilemeyen bir yer ararsan uyarılırsın. En az bir
        tür açık kalır.
      </Text>

      <Text style={s.bolumBaslik}>HATIRLATICILAR</Text>
      <View style={s.kutu}>
        <View style={s.satir}>
          <View style={[s.nokta, { backgroundColor: izin ? tema.vurgu : tema.uyari }]} />
          <Text style={s.satirBaslik}>{izin ? 'Bildirim izni açık' : 'Bildirim izni kapalı'}</Text>
        </View>
        {!izin && (
          <Pressable
            style={s.dugme}
            accessibilityRole="button"
            onPress={async () => {
              if (await izinIste()) {
                hatirlaticilariYenile();
                return;
              }
              Alert.alert('İzin verilmedi', 'Bildirimleri telefonun ayarlarından açabilirsin.', [
                { text: 'Vazgeç', style: 'cancel' },
                { text: 'Ayarları aç', onPress: () => Linking.openSettings() },
              ]);
            }}
          >
            <Ikon ad="notifications" boyut={16} renkKodu={tema.vurgu} />
            <Text style={s.dugmeYazi}>İzin iste</Text>
          </Pressable>
        )}

        {hatirlaticilar.length === 0 ? (
          <Text style={s.aciklama}>
            Kurulu hatırlatıcı yok. Bir rota bulup detayında zil düğmesine basarsan çıkış ve iniş uyarıları
            kurulur; uygulama kapalıyken de çıkarlar.
          </Text>
        ) : (
          <>
            {hatirlaticilar.map((h) => (
              <View key={h.id} style={s.hatirlatici}>
                <Text style={s.hatirlaticiSaat}>{hatirlaticiSaati(h.zaman)}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.satirBaslik} numberOfLines={1}>
                    {h.baslik}
                  </Text>
                  <Text style={s.aciklama} numberOfLines={2}>
                    {h.metin}
                  </Text>
                </View>
                <Pressable
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={`${h.baslik} hatırlatıcısını kaldır`}
                  onPress={() => hatirlaticiIptal(h.id)}
                >
                  <Ikon ad="close" boyut={18} renkKodu={tema.soluk} />
                </Pressable>
              </View>
            ))}
            <Pressable style={s.dugme} onPress={hepsiniIptal} accessibilityRole="button">
              <Ikon ad="notifications-off" boyut={16} renkKodu={tema.hata} />
              <Text style={[s.dugmeYazi, { color: tema.hata }]}>Hepsini kaldır</Text>
            </Pressable>
          </>
        )}
      </View>

      <Text style={s.bolumBaslik}>YOLCULUK</Text>
      <View style={s.kutu}>
        <View style={s.satir}>
          <Ikon ad="phone-portrait-outline" boyut={17} renkKodu={tema.vurgu} />
          <Text style={[s.satirBaslik, { flex: 1 }]}>Yolculukta ekran açık kalsın</Text>
          <Switch
            value={ekranAcik}
            onValueChange={ekranAcikKaydet}
            trackColor={{ true: tema.vurgu }}
            accessibilityLabel="Yolculukta ekran açık kalsın"
          />
        </View>
        <Text style={s.aciklama}>
          "Yolculuğu başlat"tan sonra telefon ekranı kararmaz; bakınca sıradaki adım hazır olur. Kapatırsan pil daha
          az harcanır.
        </Text>
        <View style={[s.satir, { marginTop: 6 }]}>
          <Ikon ad="volume-high-outline" boyut={17} renkKodu={tema.vurgu} />
          <Text style={[s.satirBaslik, { flex: 1 }]}>Sesli yol tarifi</Text>
          <Switch
            value={sesliTarif}
            onValueChange={sesliTarifKaydet}
            trackColor={{ true: tema.vurgu }}
            accessibilityLabel="Sesli yol tarifi"
          />
        </View>
        <Text style={s.aciklama}>
          Yürürken dönüşleri ("80 metre sonra sağa dön"), araçta ineceğin durağı iki ve bir durak kala söyler.
          Yolculuk ekranındaki hoparlör düğmesiyle de açıp kapatabilirsin. Telefon sessizdeyken duyulmayabilir.
        </Text>
        <View style={[s.satir, { marginTop: 6 }]}>
          <View style={[s.haplar, { flex: 1 }]}>
            {cinsiyetler.length > 1 && (
              [
                ['kadin', 'Kadın sesi'],
                ['erkek', 'Erkek sesi'],
              ] as [SesCinsiyeti, string][]
            ).map(([c, ad]) => (
              <Pressable
                key={c}
                style={[s.hap, sesCinsiyeti === c && s.hapSecili]}
              hitSlop={{ top: 5, bottom: 5 }}
                onPress={() => {
                  secimTiki();
                  sesCinsiyetiKaydet(c);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: sesCinsiyeti === c }}
              >
                <Text style={[s.hapYazi, sesCinsiyeti === c && { color: tema.vurgu }]}>{ad}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable hitSlop={5}
            style={s.dinle}
            onPress={() => konus('200 metre sonra sağa dön, Bağdat Caddesi. Sonra 89T otobüsüne bin.', sesCinsiyeti, true)}
            accessibilityRole="button"
            accessibilityLabel="Sesi dinle"
          >
            <Ikon ad="play" boyut={14} renkKodu={tema.vurgu} />
            <Text style={s.dugmeYazi}>Dinle</Text>
          </Pressable>
        </View>
        {kullanilanSes !== undefined && (
          <Text style={s.aciklama}>
            {kullanilanSes
              ? `Kullanılan ses: ${sesAdi(kullanilanSes.ses)}.` +
                (cinsiyetler.length > 1
                  ? ''
                  : ' iPhone\'da Türkçe için tek ses var (kadın); erkek ses seçeneği bu yüzden yok.') +
                (sesKalitesi(kullanilanSes.ses) < 2
                  ? ' Daha net bir ses için iPhone Ayarlar › Erişilebilirlik › Seslendirilen İçerik › Sesler › Türkçe bölümünden sesin "Gelişmiş" sürümünü indir.'
                  : '')
              : 'Telefonunda Türkçe ses bulunamadı; sistemin varsayılan sesi kullanılır. iPhone Ayarlar › Erişilebilirlik › Seslendirilen İçerik › Sesler › Türkçe bölümünden ses indirebilirsin.'}
          </Text>
        )}
      </View>

      <Text style={s.bolumBaslik}>GÖRÜNÜM</Text>
      <View style={s.kutu}>
        <View style={s.haplar}>
          {TEMA_SECENEKLERI.map(([t, ad, ikon]) => (
            <Pressable
              key={t}
              style={[s.hap, s.hapIkonlu, temaTercihi === t && s.hapSecili]}
              hitSlop={{ top: 5, bottom: 5 }}
              onPress={() => {
                secimTiki();
                temaTercihiKaydet(t);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: temaTercihi === t }}
            >
              <Ikon ad={ikon} boyut={15} renkKodu={temaTercihi === t ? tema.vurgu : tema.yazi} />
              <Text style={[s.hapYazi, temaTercihi === t && { color: tema.vurgu }]}>{ad}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={s.aciklama}>
          {temaTercihi === 'sistem'
            ? `Telefonun açık/koyu ayarını izler; şu an ${tema.koyu ? 'koyu' : 'açık'}.`
            : `Telefonun ayarından bağımsız olarak her zaman ${temaTercihi === 'koyu' ? 'koyu' : 'açık'}.`}
        </Text>
      </View>

      <View style={[s.kutu, s.liste, { marginTop: 26 }]}>
        <Pressable
          style={({ pressed }) => [s.gecisSatiri, pressed && { opacity: 0.6 }]}
          onPress={() => ekranAc('/hakkinda')}
          accessibilityRole="button"
          accessibilityLabel={`Hakkında, rota sunucusu ${sunucuBagli ? 'bağlı' : 'ulaşılamıyor'}`}
        >
          <View style={s.gecisIkon}>
            <Ikon ad="information" boyut={19} renkKodu="#ffffff" />
          </View>
          <Text style={[s.satirBaslik, { flex: 1, fontWeight: '400', fontSize: 16 }]}>Hakkında</Text>
          {sunucuBagli === false && <Text style={[s.gecisDeger, { color: tema.hata }]}>Sunucuya ulaşılamıyor</Text>}
          <Ikon ad="chevron-forward" boyut={17} renkKodu={tema.soluk} />
        </Pressable>
      </View>
    </ScrollView>
  );
}

/** Vasıta türü satırının alt yazısı: adı yetmeyenler için. */
const VASITA_ALT: Partial<Record<VasitaTuru, string>> = {
  otobus: 'İETT ve özel halk otobüsleri',
  vapur: 'Şehir Hatları, Turyol, Dentur, İDO',
};

const TEMA_SECENEKLERI: [TemaTercihi, string, IkonAdi][] = [
  ['sistem', 'Sistem', 'phone-portrait-outline'],
  ['acik', 'Açık', 'sunny-outline'],
  ['koyu', 'Koyu', 'moon-outline'],
];

const stiller = (t: Tema) =>
  StyleSheet.create({
    kok: { flex: 1, backgroundColor: t.zemin },
    baslik: { fontSize: 34, fontWeight: '700', color: t.yazi, letterSpacing: 0.37, paddingHorizontal: 16, paddingBottom: 6 },
    bolumBaslik: {
      fontSize: 11.5,
      letterSpacing: 0.8,
      fontWeight: '700',
      color: t.soluk,
      paddingHorizontal: 16,
      paddingTop: 20,
      paddingBottom: 7,
    },
    kutu: {
      marginHorizontal: 16,
      backgroundColor: t.yuzey,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.cizgi,
      padding: 14,
      gap: 8,
    },
    satir: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    gecisSatiri: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingVertical: 8 },
    gecisIkon: { width: 30, height: 30, borderRadius: 7, backgroundColor: '#8e8e93', alignItems: 'center', justifyContent: 'center' },
    gecisDeger: { fontSize: 14, color: t.soluk },
    liste: { paddingVertical: 0, gap: 0 },
    vasitaSatiri: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
    vasitaAyrac: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.cizgi },
    vasitaAlt: { fontSize: 12, color: t.soluk, marginTop: 1 },
    disAciklama: { fontSize: 12, color: t.soluk, lineHeight: 18, paddingHorizontal: 20, paddingTop: 8 },
    nokta: { width: 9, height: 9, borderRadius: 5 },
    satirBaslik: { fontSize: 15, fontWeight: '700', color: t.yazi },
    aciklama: { fontSize: 12, color: t.soluk, lineHeight: 18 },
    dugme: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', paddingTop: 4 },
    dinle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      height: 34,
      paddingHorizontal: 12,
      borderRadius: 17,
      borderWidth: 1,
      borderColor: t.vurgu,
    },
    dugmeYazi: { fontSize: 13.5, fontWeight: '700', color: t.vurgu },
    hatirlatici: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.cizgiSilik,
    },
    hatirlaticiSaat: { fontSize: 15, fontWeight: '700', color: t.vurgu, fontVariant: ['tabular-nums'] },
    haplar: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    hap: {
      paddingHorizontal: 12,
      height: 34,
      borderRadius: 17,
      justifyContent: 'center',
      backgroundColor: t.zemin,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.cizgi,
    },
    hapSecili: { backgroundColor: t.vurguAcik, borderColor: t.vurgu },
    hapIkonlu: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    hapYazi: { fontSize: 13.5, fontWeight: '700', color: t.yazi },
  });
