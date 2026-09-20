// Ayarlar sekmesi: verinin ne kadar güncel olduğu, rota sunucusunun durumu ve uygulama bilgisi.
//
// Buradaki bilgiler süs değil: tarifenin hangi tarihleri kapsadığını sunucunun kendisinden
// okuyoruz, böylece "neden bu sefer çıkmıyor" sorusunun cevabı ekranda görünüyor.

import Constants from 'expo-constants';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Ikon, useStiller } from '@/components/ulasim';
import { OTP_ADRESI, sunucuBilgisiGetir, type SunucuBilgisi } from '@/lib/otp';
import { poiBilgisi } from '@/lib/poi';
import { useTema, type Tema } from '@/lib/tema';

function tarihYaz(saniye?: number | null): string {
  if (!saniye) return '—';
  const d = new Date(saniye * 1000);
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function AyarlarEkrani() {
  const kenar = useSafeAreaInsets();
  const tema = useTema();
  const s = useStiller(stiller);

  const [sunucu, setSunucu] = useState<SunucuBilgisi | null>(null);
  const [sunucuHatasi, setSunucuHatasi] = useState<string | null>(null);
  const [poi, setPoi] = useState<{ nokta: number; kaynak: string } | null>(null);
  const [yenileniyor, setYenileniyor] = useState(false);

  const yukle = useCallback(async () => {
    setSunucuHatasi(null);
    try {
      setSunucu(await sunucuBilgisiGetir());
    } catch (e) {
      setSunucu(null);
      setSunucuHatasi((e as Error).message ?? 'Sunucuya ulaşılamadı.');
    }
    setPoi(await poiBilgisi());
  }, []);

  useEffect(() => {
    yukle();
  }, [yukle]);

  const besleme = sunucu?.feeds ?? [];
  const aralik = sunucu?.serviceTimeRange;

  return (
    <ScrollView
      style={s.kok}
      contentContainerStyle={{ paddingTop: kenar.top + 6, paddingBottom: kenar.bottom + 24 }}
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
      <Text style={s.baslik}>Ayarlar</Text>

      <Text style={s.bolumBaslik}>ROTA SUNUCUSU</Text>
      <View style={s.kutu}>
        <View style={s.satir}>
          <View style={[s.nokta, { backgroundColor: sunucu ? tema.vurgu : tema.hata }]} />
          <Text style={s.satirBaslik}>{sunucu ? 'Bağlı' : 'Ulaşılamıyor'}</Text>
        </View>
        <Text style={s.adres}>{OTP_ADRESI}</Text>
        {sunucuHatasi && <Text style={s.hataYazi}>{sunucuHatasi}</Text>}
        {!sunucuHatasi && (
          <Text style={s.aciklama}>
            Rota motoru şu an bilgisayarında çalışıyor; uygulama yalnızca aynı ağdayken rota bulabilir.
          </Text>
        )}
      </View>

      <Text style={s.bolumBaslik}>TARİFE VERİSİ</Text>
      <View style={s.kutu}>
        <View style={s.bilgiSatiri}>
          <Text style={s.etiket}>Geçerlilik</Text>
          <Text style={s.deger}>{`${tarihYaz(aralik?.start)} – ${tarihYaz(aralik?.end)}`}</Text>
        </View>
        {besleme.map((b) => (
          <View key={b.feedId} style={s.bilgiSatiri}>
            <Text style={s.etiket}>{b.feedId}</Text>
            <Text style={s.deger} numberOfLines={1}>
              {(b.agencies ?? []).map((a) => a.name).join(', ') || '—'}
            </Text>
          </View>
        ))}
        <Text style={s.aciklama}>
          Otobüs ve Metrobüs tarifesi İETT'nin güncel verisinden geliyor. Metro, Marmaray, tramvay, füniküler ve
          vapur saatleri İBB'nin artık güncellemediği veriden geldiği için güncel döneme kaydırıldı; saatler
          yaklaşıktır.
        </Text>
      </View>

      <Text style={s.bolumBaslik}>YER VERİSİ</Text>
      <View style={s.kutu}>
        <View style={s.bilgiSatiri}>
          <Text style={s.etiket}>Aranabilir yer</Text>
          <Text style={s.deger}>{poi ? poi.nokta.toLocaleString('tr-TR') : '—'}</Text>
        </View>
        <View style={s.bilgiSatiri}>
          <Text style={s.etiket}>Kaynak</Text>
          <Text style={s.deger} numberOfLines={1}>
            {poi?.kaynak ?? 'OpenStreetMap'}
          </Text>
        </View>
        <Text style={s.aciklama}>Yer araması telefonda yapılır; internet bağlantısı gerekmez.</Text>
      </View>

      <Text style={s.bolumBaslik}>GÖRÜNÜM</Text>
      <View style={s.kutu}>
        <View style={s.satir}>
          <Ikon ad={tema.koyu ? 'moon' : 'sunny'} boyut={17} renkKodu={tema.vurgu} />
          <Text style={s.satirBaslik}>{tema.koyu ? 'Koyu tema' : 'Açık tema'}</Text>
        </View>
        <Text style={s.aciklama}>
          Tema telefonun sistem ayarını izler. Değiştirmek için Ayarlar → Ekran ve Parlaklık'ı kullan.
        </Text>
      </View>

      <Text style={s.bolumBaslik}>UYGULAMA</Text>
      <View style={s.kutu}>
        <View style={s.bilgiSatiri}>
          <Text style={s.etiket}>Sürüm</Text>
          <Text style={s.deger}>{Constants.expoConfig?.version ?? '—'}</Text>
        </View>
        <Pressable onPress={yukle} style={s.dugme} accessibilityRole="button">
          <Ikon ad="refresh" boyut={16} renkKodu={tema.vurgu} />
          <Text style={s.dugmeYazi}>Bilgileri yenile</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const stiller = (t: Tema) =>
  StyleSheet.create({
    kok: { flex: 1, backgroundColor: t.zemin },
    baslik: { fontSize: 26, fontWeight: '800', color: t.yazi, letterSpacing: -0.4, paddingHorizontal: 16, paddingBottom: 6 },
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
    nokta: { width: 9, height: 9, borderRadius: 5 },
    satirBaslik: { fontSize: 15, fontWeight: '700', color: t.yazi },
    adres: { fontSize: 13, color: t.soluk, fontVariant: ['tabular-nums'] },
    bilgiSatiri: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
    etiket: { fontSize: 13.5, color: t.soluk },
    deger: { fontSize: 13.5, fontWeight: '600', color: t.yazi, flexShrink: 1, textAlign: 'right' },
    aciklama: { fontSize: 12, color: t.soluk, lineHeight: 18 },
    hataYazi: { fontSize: 12.5, color: t.hata, lineHeight: 18 },
    dugme: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', paddingTop: 4 },
    dugmeYazi: { fontSize: 13.5, fontWeight: '700', color: t.vurgu },
  });
