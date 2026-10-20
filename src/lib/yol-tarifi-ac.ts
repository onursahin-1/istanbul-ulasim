// Bir yere yol tarifi: konum varsa "Konumum"dan. Konum yoksa (izin verilmedi, alınamadı,
// İstanbul dışı) eskiden sormadan Kadıköy'den aranıyordu; şimdi nereden başlanacağı soruluyor.

import { Alert, Linking } from 'react-native';

import { ekranAc } from '@/lib/gezinti';
import type { KonumDurumu } from '@/lib/konum';

type Hedef = { ad: string; lat: number; lon: number };

export function yolTarifiAc(konum: KonumDurumu, hedef: Hedef): void {
  const varis = { vLat: String(hedef.lat), vLon: String(hedef.lon), vAd: hedef.ad };
  const buradan = (ad: string) =>
    ekranAc({
      pathname: '/rota',
      params: { kLat: String(konum.nokta.latitude), kLon: String(konum.nokta.longitude), kAd: ad, ...varis },
    });
  if (konum.tur === 'gercek') {
    buradan('Konumum');
    return;
  }
  const izinYok = konum.tur === 'varsayilan' && konum.neden.includes('izni');
  Alert.alert(konum.tur === 'bekleniyor' ? 'Konumun henüz alınmadı' : 'Konumun alınamadı', 'Yol tarifi nereden başlasın?', [
    // Arama ekranı "Nereden yola çıkıyorsun?" olarak açılır; seçince varışı bu yer olan rota açılır.
    { text: 'Başlangıcı seç', onPress: () => ekranAc({ pathname: '/ara', params: { alan: 'baslangic', ...varis } }) },
    { text: "Kadıköy'den başla", onPress: () => buradan('Kadıköy (örnek konum)') },
    ...(izinYok ? [{ text: 'Ayarları aç', onPress: () => Linking.openSettings() }] : []),
    { text: 'Vazgeç', style: 'cancel' as const },
  ]);
}
