/**
 * Karakter görseli yönetimi (yalnızca KENDİ / LİSANSLI görsellerin için).
 *
 *   npm run katalog:csv                       -> katalog.csv (id, karakter, form, beklenen dosya)
 *   npm run gorsel:ice -- <klasör> <seri>     -> klasördeki görselleri kataloğa eşleyip kopyalar
 *   npm run gorsel:manifest                   -> public/assets/tasos/manifest.json'u yeniden üretir
 *
 * Eşleştirme: dosya adı katalog id'si (naruto-001), yalnızca numara (001),
 * "karakter" ya da "karakter form" adı olabilir (büyük/küçük harf, boşluk, tire fark etmez).
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CATALOG, catalogOfSeries } from '../src/data/catalog';

const ROOT = path.resolve(process.cwd(), 'public/assets/tasos');
const EXT = ['.webp', '.png', '.jpg', '.jpeg'];

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

function buildManifest() {
  const manifest: Record<string, string> = {};
  for (const c of CATALOG) {
    const dir = path.join(ROOT, c.seriesId);
    for (const e of EXT) {
      if (existsSync(path.join(dir, `${c.id}${e}`))) {
        manifest[c.id] = `${c.seriesId}/${c.id}${e}`;
        break;
      }
    }
  }
  mkdirSync(ROOT, { recursive: true });
  writeFileSync(path.join(ROOT, 'manifest.json'), JSON.stringify(manifest, null, 1));
  const per: Record<string, number> = {};
  for (const id of Object.keys(manifest)) per[id.split('-')[0]] = (per[id.split('-')[0]] ?? 0) + 1;
  console.log(`manifest.json yazıldı: ${Object.keys(manifest).length} görsel`, per);
}

function importFolder(dir: string, seriesId: string) {
  const entries = catalogOfSeries(seriesId);
  if (!entries.length) throw new Error(`Bilinmeyen seri: ${seriesId}`);
  const byId = new Map(entries.map((c) => [c.id, c]));
  const byFull = new Map(entries.map((c) => [slug(`${c.name} ${c.form ?? ''}`), c]));
  const byName = new Map<string, typeof entries>();
  for (const c of entries) byName.set(slug(c.name), [...(byName.get(slug(c.name)) ?? []), c]);

  const target = path.join(ROOT, seriesId);
  mkdirSync(target, { recursive: true });
  let ok = 0;
  const problems: string[] = [];
  for (const f of readdirSync(dir)) {
    const ext = path.extname(f).toLowerCase();
    if (!EXT.includes(ext)) continue;
    const base = slug(path.basename(f, path.extname(f)));
    let hit = byId.get(base) ?? byId.get(`${seriesId}-${base.padStart(3, '0')}`) ?? byFull.get(base);
    if (!hit) {
      const list = byName.get(base);
      if (list?.length === 1) hit = list[0];
      else if (list && list.length > 1) {
        hit = list.find((c) => !c.form);
        if (!hit) problems.push(`${f}: birden çok form var, dosya adına formu ekle (${list.map((c) => c.form).join(', ')})`);
      }
    }
    if (!hit) {
      if (!problems.some((p) => p.startsWith(f))) problems.push(`${f}: eşleşme bulunamadı`);
      continue;
    }
    copyFileSync(path.join(dir, f), path.join(target, `${hit.id}${ext}`));
    ok++;
  }
  console.log(`${ok} görsel kopyalandı.`);
  problems.slice(0, 40).forEach((p) => console.log('  !', p));
  if (problems.length > 40) console.log(`  ... ve ${problems.length - 40} uyarı daha`);
  buildManifest();
}

function csv() {
  const rows = ['id,seri,numara,karakter,form,nadirlik,beklenen_dosya'];
  for (const c of CATALOG) {
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
    rows.push([c.id, c.seriesId, c.number, q(c.name), q(c.form ?? ''), c.rarity, `public/assets/tasos/${c.seriesId}/${c.id}.png`].join(','));
  }
  writeFileSync('katalog.csv', rows.join('\n'));
  console.log(`katalog.csv yazıldı (${CATALOG.length} satır)`);
}

const [mode, a, b] = process.argv.slice(2);
if (mode === 'manifest') buildManifest();
else if (mode === 'csv') csv();
else if (mode === 'import' && a && b) importFolder(path.resolve(a), b);
else console.log('Kullanım: gorsel:ice -- <klasör> <seri> | gorsel:manifest | katalog:csv');
