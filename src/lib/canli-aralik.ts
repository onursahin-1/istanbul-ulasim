// Ekrandaki canlı bilgiyi belirli aralıklarla tazeleyen zamanlayıcı; yalnız ekran
// görünürken çalışır.
//
// Eskiden her ekran kendi setInterval'ını kuruyordu ve ekran başka bir ekranın altında
// kaldığında da (durak ekranı açıkken ana ekran, yolculuk ekranı açıkken hat ekranı)
// sunucuya sormaya devam ediyordu: yığında dört ekran varsa dört ayrı yenileme, üstteki
// ekranın kaydırması ve geçişleri bu yüzden takılıyordu. Şimdi:
//   - Ekran odakta değilse ya da uygulama arka plandaysa zamanlayıcı durur.
//   - Odağa dönünce (geri gelince, uygulama öne gelince) hemen bir kez tazeler; eski
//     bilgi aralık dolana kadar ekranda kalmaz.

import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

/**
 * @param is      tazeleme işi
 * @param aralik  milisaniye
 * @param etkin   false iken hiç çalışmaz (örneğin konum henüz belli değil)
 */
export function useCanliAralik(is: () => void, aralik: number, etkin = true): void {
  const son = useRef(is);
  useEffect(() => {
    son.current = is;
  }, [is]);
  const odakli = useIsFocused();
  const [onde, setOnde] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const abone = AppState.addEventListener('change', (d) => setOnde(d === 'active'));
    return () => abone.remove();
  }, []);

  // İlk çalışma ekranın kendi ilk yüklemesiyle çakışmasın: yalnız durup yeniden
  // başladığında hemen tazele.
  const durmustu = useRef(false);
  const calisir = etkin && odakli && onde;
  useEffect(() => {
    if (!etkin) return;
    if (!calisir) {
      durmustu.current = true;
      return;
    }
    if (durmustu.current) {
      durmustu.current = false;
      son.current();
    }
    const t = setInterval(() => son.current(), aralik);
    return () => clearInterval(t);
  }, [etkin, calisir, aralik]);
}
