// Uygulamadaki bütün GraphQL sorgularını OpenTripPlanner'ın kendi şemasına karşı doğrular.
//
// Neden: sorgudaki bir yazım hatası ya da olmayan bir alan ancak telefonda, çalışma
// anında ortaya çıkıyor. Şema OTP'nin jar dosyasının içinde duruyor; onu çıkarıp
// sorguları burada denetlersek hata daha derlemeden görünüyor.
//
// Kullanım:
//   npx tsx scripts/sorgu-dogrula.ts [otp-jar-yolu]
// Varsayılan jar yolu: C:\otp\otp-shaded-2.10.0.jar

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildSchema, parse, validate } from 'graphql';

import { SORGULAR, tercihleriYap, type RotaTercihi } from '../src/lib/sorgular.ts';

const SEMA_YOLU = 'org/opentripplanner/apis/gtfs/schema.graphqls';

/** Jar'ın aranacağı yerler, sırayla. OTP_JAR ortam değişkeniyle de verilebilir. */
const ADAY_YOLLAR = [
  process.env.OTP_JAR,
  'C:\\otp',
  join(homedir(), 'mnt', 'otp'),
  '/otp',
  process.cwd(),
].filter((y): y is string => !!y);

/** Klasör verilirse içindeki ilk otp-shaded-*.jar'ı bulur. */
function jarBul(yol: string): string | null {
  if (!existsSync(yol)) return null;
  if (!statSync(yol).isDirectory()) return yol;
  const jar = readdirSync(yol).find((a) => /^otp-shaded-.*\.jar$/.test(a));
  return jar ? join(yol, jar) : null;
}

function semayiOku(jar: string): string {
  const klasor = mkdtempSync(join(tmpdir(), 'otp-sema-'));
  try {
    // Jar bir zip; şemayı oradan çıkarıyoruz. unzip yoksa jar aracı da iş görür.
    try {
      execFileSync('unzip', ['-o', '-q', jar, SEMA_YOLU, '-d', klasor], { stdio: 'pipe' });
    } catch {
      execFileSync('jar', ['--extract', `--file=${jar}`, SEMA_YOLU], { cwd: klasor, stdio: 'pipe' });
    }
    return readFileSync(join(klasor, SEMA_YOLU), 'utf8');
  } finally {
    rmSync(klasor, { recursive: true, force: true });
  }
}

/**
 * Değişken olarak gönderilen tercih nesnesini denetler.
 * Statik doğrulama değişkenlerin içeriğine bakmadığı için tercihleri sorgunun içine
 * gömüp öyle doğruluyoruz: yanlış yazılmış bir alan adı burada yakalanır.
 */
function tercihleriDogrula(sema: ReturnType<typeof buildSchema>): number {
  const yazdir = (d: unknown): string => {
    if (d === null || d === undefined) return 'null';
    if (Array.isArray(d)) return `[${d.map(yazdir).join(', ')}]`;
    if (typeof d === 'object') {
      return `{ ${Object.entries(d as Record<string, unknown>)
        .map(([k, v]) => `${k}: ${yazdir(v)}`)
        .join(', ')} }`;
    }
    return JSON.stringify(d);
  };

  const tercihler: RotaTercihi[] = ['dengeli', 'azYurume', 'azAktarma'];
  let hatali = 0;
  for (const tercih of tercihler) {
    for (const erisilebilir of [false, true]) {
      const nesne = tercihleriYap({ tercih, erisilebilir });
      const ad = `tercih:${tercih}${erisilebilir ? ' + erişilebilir' : ''}`;
      if (!nesne) {
        console.log(`✓ ${ad} (tercih gönderilmiyor)`);
        continue;
      }
      const sorgu = `query Tercih {
  planConnection(
    origin: { location: { coordinate: { latitude: 41.0, longitude: 29.0 } } }
    destination: { location: { coordinate: { latitude: 41.1, longitude: 29.1 } } }
    preferences: ${yazdir(nesne)}
  ) { edges { node { duration } } }
}`;
      const hatalar = validate(sema, parse(sorgu));
      if (hatalar.length === 0) {
        console.log(`✓ ${ad}`);
        continue;
      }
      hatali += 1;
      console.log(`✗ ${ad}`);
      for (const h of hatalar) console.log(`    ${h.message}`);
    }
  }
  return hatali;
}

function main() {
  const verilen = process.argv[2];
  const jar = (verilen ? [verilen] : ADAY_YOLLAR).map(jarBul).find((y): y is string => !!y);
  if (!jar) {
    const nerede = verilen ?? ADAY_YOLLAR.join(', ');
    console.error(`OTP jar dosyası bulunamadı (bakılan yer: ${nerede}).`);
    console.error('Yolu argüman olarak ya da OTP_JAR ortam değişkeniyle verebilirsin.');
    process.exitCode = 1;
    return;
  }
  console.log(`Şema kaynağı: ${jar}\n`);
  // assumeValid: OTP'nin şeması graphql-js'in bir kuralını çiğniyor (Cluster.id kullanımdan
  // kalkmış ama Node.id kalkmamış). Bizi ilgilendiren sorguların geçerliliği, şemanın kendi
  // iç tutarlılığı değil; o yüzden şema doğrulamasını atlıyoruz.
  const sema = buildSchema(semayiOku(jar), { assumeValid: true, assumeValidSDL: true });

  let hataliSorgu = 0;
  for (const [ad, metin] of Object.entries(SORGULAR)) {
    let hatalar;
    try {
      hatalar = validate(sema, parse(metin));
    } catch (e) {
      console.log(`✗ ${ad}: ayrıştırılamadı — ${(e as Error).message}`);
      hataliSorgu += 1;
      continue;
    }
    if (hatalar.length === 0) {
      console.log(`✓ ${ad}`);
      continue;
    }
    hataliSorgu += 1;
    console.log(`✗ ${ad}`);
    for (const h of hatalar) {
      const satir = h.locations?.[0] ? ` (satır ${h.locations[0].line})` : '';
      console.log(`    ${h.message}${satir}`);
    }
  }

  console.log('\nRota tercihleri:');
  const hataliTercih = tercihleriDogrula(sema);

  const toplam = Object.keys(SORGULAR).length;
  console.log(`\n${toplam - hataliSorgu}/${toplam} sorgu şemaya uyuyor.`);
  if (hataliSorgu || hataliTercih) process.exitCode = 1;
}

main();
