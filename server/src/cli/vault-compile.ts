/**
 * npm run vault:compile — compila el vault y deja el resultado en compiled/.
 * Sale con código 1 si hay errores (útil en CI).
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env, REPO_ROOT } from '../env';
import { compileVault } from '../vault/compiler';

async function main(): Promise<void> {
  const out = path.join(REPO_ROOT, 'compiled');
  const compiled = await compileVault({ vaultDir: env.vaultDir, timeZone: env.timeZone });
  const r = compiled.report;
  await rm(out, { recursive: true, force: true });
  await mkdir(path.join(out, 'venues'), { recursive: true });
  for (const a of compiled.artifacts) {
    const dir = path.join(out, 'venues', a.venueId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${a.eventId ?? 'base'}.${a.hash.slice(0, 12)}.json`), JSON.stringify(a, null, 2));
  }
  await writeFile(path.join(out, 'events.json'), JSON.stringify(compiled.events, null, 2));
  await writeFile(path.join(out, 'providers.json'), JSON.stringify(compiled.providers, null, 2));
  await writeFile(path.join(out, 'report.json'), JSON.stringify(r, null, 2));

  console.log(`\nVault: ${r.vaultDir}`);
  console.log(`Notas leídas: ${r.notes} · ${r.durationMs} ms\n`);
  for (const v of r.venues) console.log(`  ✔ ${v.name.padEnd(28)} ${String(v.zones).padStart(2)} zonas · ${String(v.sections).padStart(3)} secciones · ${v.hash.slice(0, 12)}`);
  for (const e of compiled.events) {
    const lim = e.limits;
    const ok = lim.verified && lim.semantics !== 'UNKNOWN';
    console.log(`  ${ok ? '✔' : '✖'} ${e.name.padEnd(40)} ${lim.perAccount}/cuenta · ${lim.semantics}${ok ? '' : '  ← límites sin verificar: no se podrá armar'}`);
  }
  for (const p of compiled.providers) console.log(`  ✔ Proveedor ${p.name} (${p.mode}) · autorizado: ${p.authorized.join(', ') || 'nada (manual)'}`);
  if (r.warnings.length) {
    console.log(`\nAvisos (${r.warnings.length}):`);
    for (const w of r.warnings) console.log(`  ! ${w.file}: ${w.message}`);
  }
  if (r.errors.length) {
    console.log(`\nErrores (${r.errors.length}):`);
    for (const e of r.errors) console.log(`  ✖ ${e.file}: ${e.message}`);
  }
  console.log(`\nResultado en ${out}\n`);
  process.exit(r.errors.length > 0 ? 1 : 0);
}

void main();
