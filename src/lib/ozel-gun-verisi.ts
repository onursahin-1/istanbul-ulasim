// Özel günler verisi (assets/veri/ozel-gunler.json). Ayrı dosyada: ozel-gunler.ts
// testlerden JSON yüklemeden çağrılabilsin.

import ham from '@/assets/veri/ozel-gunler.json';

import type { OzelGun } from './ozel-gunler';

export const OZEL_GUNLER = (ham as unknown as { gunler: OzelGun[] }).gunler;
