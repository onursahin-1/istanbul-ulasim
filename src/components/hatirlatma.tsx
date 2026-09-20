// Yolculuk hatırlatma sayfası: rota detayında zil düğmesine basınca açılan alt sayfa.
//
// İki tür hatırlatıcı kurar:
//   • Çıkış — yola çıkmadan seçilen dakika kadar önce.
//   • İniş — her aracın iniş durağına varmadan birkaç dakika önce.
// İkisi de telefona önceden zamanlanır; uygulama kapalıyken de çıkarlar.

import { useState } from 'react';
import { Alert, Linking, Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Ikon, useStiller } from '@/components/ulasim';
import { grubuIptal, hatirlaticilariKur, izinIste, type Taslak } from '@/lib/bildirim';
import { useTema, type Tema } from '@/lib/tema';

/** Bir aracın iniş uyarısı için gereken bilgiler. */
export type InisBilgisi = { zaman: number; durak: string; hat: string };

type Props = {
  acik: boolean;
  kapat: () => void;
  /** Yola çıkış anı, Unix milisaniye. Geçmişse çıkış hatırlatıcısı önerilmez. */
  kalkis: number | null;
  inisler: InisBilgisi[];
  /** Bu yolculuğa ait hatırlatıcıları birlikte iptal etmek için etiket. */
  grup: string;
  /** Bu yolculuk için hâlihazırda kurulu hatırlatıcı sayısı. */
  kurulu: number;
  /** Kurma ya da iptalden sonra çağrılır. */
  degisti: () => void;
};

const ONCE_SECENEKLERI = [5, 10, 15, 30];
/** İniş uyarısı, varıştan bu kadar önce çıkar. */
const INIS_ONCE_DK = 2;

export function HatirlatmaSayfasi({ acik, kapat, kalkis, inisler, grup, kurulu, degisti }: Props) {
  const kenar = useSafeAreaInsets();
  const tema = useTema();
  const s = useStiller(stiller);

  const [once, setOnce] = useState(10);
  const [inisAcik, setInisAcik] = useState(true);
  const [calisiyor, setCalisiyor] = useState(false);

  const cikisUygun = kalkis != null && kalkis - once * 60_000 > Date.now();
  const inisSayisi = inisler.filter((i) => i.zaman - INIS_ONCE_DK * 60_000 > Date.now()).length;

  const taslaklariUret = (): Taslak[] => {
    const liste: Taslak[] = [];
    if (kalkis != null) {
      liste.push({
        tur: 'kalkis',
        baslik: 'Yola çıkma vakti',
        metin: `${once} dakika sonra yola çıkman gerekiyor.`,
        zaman: kalkis - once * 60_000,
        grup,
      });
    }
    if (inisAcik) {
      for (const i of inisler) {
        liste.push({
          tur: 'inis',
          baslik: `${i.durak} yaklaşıyor`,
          metin: `${i.hat} ile ${INIS_ONCE_DK} dakika sonra ${i.durak} durağında ineceksin.`,
          zaman: i.zaman - INIS_ONCE_DK * 60_000,
          grup,
        });
      }
    }
    return liste;
  };

  const kur = async () => {
    setCalisiyor(true);
    try {
      if (!(await izinIste())) {
        Alert.alert(
          'Bildirim izni kapalı',
          'Hatırlatma yapabilmemiz için bildirim iznini açman gerekiyor.',
          [
            { text: 'Vazgeç', style: 'cancel' },
            { text: 'Ayarları aç', onPress: () => Linking.openSettings() },
          ],
        );
        return;
      }
      const kurulanlar = await hatirlaticilariKur(taslaklariUret());
      degisti();
      kapat();
      if (kurulanlar.length === 0) {
        Alert.alert('Hatırlatıcı kurulmadı', 'Seçtiğin anların hepsi geçmiş görünüyor.');
      }
    } finally {
      setCalisiyor(false);
    }
  };

  const iptal = async () => {
    setCalisiyor(true);
    try {
      await grubuIptal(grup);
      degisti();
      kapat();
    } finally {
      setCalisiyor(false);
    }
  };

  return (
    <Modal visible={acik} transparent animationType="slide" onRequestClose={kapat}>
      <Pressable style={s.perde} onPress={kapat} accessibilityLabel="Kapat" />
      <View style={[s.sayfa, { paddingBottom: kenar.bottom + 16 }]}>
        <View style={s.tutamac} />

        {kurulu > 0 ? (
          <>
            <Text style={s.baslik}>Hatırlatıcılar kurulu</Text>
            <View style={s.bilgi}>
              <Ikon ad="notifications" boyut={18} renkKodu={tema.vurgu} />
              <Text style={s.bilgiYazi}>
                {`Bu yolculuk için ${kurulu} hatırlatıcı kurulu. Uygulama kapalıyken de çıkarlar.`}
              </Text>
            </View>
            <Pressable style={[s.dugme, s.iptalDugme]} onPress={iptal} disabled={calisiyor} accessibilityRole="button">
              <Ikon ad="notifications-off" boyut={17} renkKodu={tema.hata} />
              <Text style={[s.dugmeYazi, { color: tema.hata }]}>Hatırlatıcıları kaldır</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={s.baslik}>Hatırlat</Text>

            <Text style={s.altBaslik}>ÇIKIŞTAN ÖNCE</Text>
            <View style={s.satir}>
              {ONCE_SECENEKLERI.map((dk) => (
                <Pressable
                  key={dk}
                  style={[s.hap, once === dk && s.hapSecili]}
                  onPress={() => setOnce(dk)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: once === dk }}
                >
                  <Text style={[s.hapYazi, once === dk && { color: tema.vurgu }]}>{`${dk} dk`}</Text>
                </Pressable>
              ))}
            </View>
            {kalkis != null && !cikisUygun && (
              <Text style={s.uyari}>Bu süre çoktan geçmiş; yalnızca iniş uyarıları kurulacak.</Text>
            )}

            {inisler.length > 0 && (
              <>
                <Text style={s.altBaslik}>YOLDA</Text>
                <View style={s.anahtarSatiri}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.anahtarBaslik}>İneceğin durak yaklaşınca uyar</Text>
                    <Text style={s.anahtarAlt}>
                      {inisSayisi > 0
                        ? `${inisSayisi} uyarı · varıştan ${INIS_ONCE_DK} dakika önce`
                        : 'Bu yolculuk için uygun an kalmadı'}
                    </Text>
                  </View>
                  <Switch
                    value={inisAcik && inisSayisi > 0}
                    onValueChange={setInisAcik}
                    disabled={inisSayisi === 0}
                    trackColor={{ true: tema.vurgu }}
                  />
                </View>
              </>
            )}

            <Text style={s.aciklama}>
              Hatırlatıcının metni kurulduğu anda sabitlenir. Sefer gecikirse uyarı yine de planlanan saatte çıkar.
            </Text>

            <Pressable style={s.dugme} onPress={kur} disabled={calisiyor} accessibilityRole="button">
              <Ikon ad="notifications" boyut={17} renkKodu={tema.vurguYazi} />
              <Text style={[s.dugmeYazi, { color: tema.vurguYazi }]}>Hatırlatıcıları kur</Text>
            </Pressable>
          </>
        )}
      </View>
    </Modal>
  );
}

const stiller = (t: Tema) =>
  StyleSheet.create({
    perde: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
    sayfa: {
      backgroundColor: t.yuzey,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      paddingHorizontal: 16,
      paddingTop: 10,
      gap: 10,
    },
    tutamac: { width: 38, height: 4, borderRadius: 2, backgroundColor: t.cizgi, alignSelf: 'center', marginBottom: 6 },
    baslik: { fontSize: 19, fontWeight: '800', color: t.yazi, letterSpacing: -0.3 },
    altBaslik: { fontSize: 11.5, letterSpacing: 0.8, fontWeight: '700', color: t.soluk, paddingTop: 6 },
    satir: { flexDirection: 'row', gap: 8 },
    hap: {
      paddingHorizontal: 14,
      height: 38,
      borderRadius: 19,
      justifyContent: 'center',
      backgroundColor: t.zemin,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.cizgi,
    },
    hapSecili: { backgroundColor: t.vurguAcik, borderColor: t.vurgu },
    hapYazi: { fontSize: 14, fontWeight: '700', color: t.yazi },
    anahtarSatiri: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    anahtarBaslik: { fontSize: 14.5, fontWeight: '600', color: t.yazi },
    anahtarAlt: { fontSize: 12, color: t.soluk, marginTop: 2 },
    bilgi: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingVertical: 4 },
    bilgiYazi: { flex: 1, fontSize: 13.5, color: t.yazi, lineHeight: 19 },
    uyari: { fontSize: 12.5, color: t.uyari, lineHeight: 18 },
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
