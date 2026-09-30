/**
 * npm run gates [-- --full] — ejecuta los production gates G0–G6 y guarda el
 * informe en reports/. Sale con código 1 si alguno falla.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { formatLatency } from '@to/shared';
import { env } from '../env';
import { runGates } from '../gates/gates';

async function main(): Promise<void> {
  const full = process.argv.includes('--full');
  console.log(`\nProduction gates (${full ? 'completo' : 'rápido'})…\n`);
  const report = await runGates({ quick: !full });
  for (const g of report.gates) {
    const icon = g.status === 'PASS' ? '✔' : g.status === 'FAIL' ? '✖' : '•';
    console.log(`  ${icon} ${g.id} ${g.name.padEnd(30)} ${g.status.padEnd(4)} ${String(g.durationMs).padStart(6)} ms  ${g.detail}`);
  }
  const s = report.slo;
  console.log('\nSLO');
  console.log(`  decisión p99     ${s.decision ? formatLatency(s.decision.p99) : '—'}`);
  console.log(`  asignación p99   ${s.allocation ? formatLatency(s.allocation.p99) : '—'}`);
  console.log(`  corrección       ${s.correctness === null ? '—' : `${(s.correctness * 100).toFixed(2)} %`}`);
  console.log(`  sobreasignación  ${s.overAllocation}`);
  console.log(`  precio > máximo  ${s.priceViolations}`);
  console.log(`  pagos automáticos ${s.autoPayments}`);
  console.log('\nDefinition of done');
  for (const d of report.definitionOfDone) console.log(`  ${d.met ? '✔' : '✖'} ${d.item}`);
  await mkdir(env.reportsDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  await writeFile(path.join(env.reportsDir, `gates-${stamp}.json`), JSON.stringify(report, null, 2));
  await writeFile(path.join(env.reportsDir, 'gates-latest.json'), JSON.stringify(report, null, 2));
  console.log(`\nInforme: ${path.join(env.reportsDir, 'gates-latest.json')}\n`);
  process.exit(report.gates.every((g) => g.status === 'PASS') ? 0 : 1);
}

void main();
