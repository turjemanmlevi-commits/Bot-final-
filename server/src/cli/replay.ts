/**
 * npm run replay -- <operationId>  — reproduce las decisiones y la asignación
 * de una operación a partir del journal y comprueba que salen idénticas.
 * Usa la API si el servidor está en marcha; si no, abre el journal directamente.
 */

import path from 'node:path';
import type { OperationSummary, ReplayReport } from '@to/shared';
import { env } from '../env';
import { replayOperation } from '../runtime/replay';
import { PgliteDriver } from '../store/drivers';

function print(r: ReplayReport): void {
  console.log(`\nReplay de ${r.operationId}  (snapshot ${r.armedSnapshotHash?.slice(0, 12) ?? '—'})`);
  console.log(`  decisiones  ${r.decisionsMatched}/${r.decisionsChecked}`);
  console.log(`  asignación  ${r.allocationStepsMatched}/${r.allocationStepsChecked} pasos`);
  console.log(`  snapshots que faltan ${r.missingSnapshots}`);
  console.log(`  resultado   ${r.ok ? '✔ idéntico' : '✖ DIFERENCIAS'}`);
  for (const m of r.mismatches.slice(0, 5)) console.log(`   - ${m.kind} ${m.ref}: esperado ${JSON.stringify(m.expected)} · obtenido ${JSON.stringify(m.actual)}`);
  console.log('');
}

async function main(): Promise<void> {
  const id = process.argv[2];
  const base = `http://127.0.0.1:${env.port}`;
  const headers = env.operatorToken ? { authorization: `Bearer ${env.operatorToken}` } : undefined;
  try {
    if (!id) {
      const ops = (await (await fetch(`${base}/api/operations`, { headers })).json()) as OperationSummary[];
      console.log('\nUso: npm run replay -- <operationId>\n');
      for (const o of ops) console.log(`  ${o.id}  ${o.state.padEnd(12)} ${o.name}`);
      console.log('');
      return;
    }
    const res = await fetch(`${base}/api/operations/${id}/replay`, { method: 'POST', headers });
    if (res.ok) {
      const r = (await res.json()) as ReplayReport;
      print(r);
      process.exit(r.ok ? 0 : 1);
    }
    console.error(`✖ ${res.status} ${await res.text()}`);
    process.exit(1);
  } catch {
    if (!id) {
      console.error('Uso: npm run replay -- <operationId>');
      process.exit(1);
    }
    const driver = new PgliteDriver(path.join(env.dataDir, 'pglite'));
    await driver.init();
    const r = await replayOperation({ query: (q) => driver.queryAudit(q) }, id, Date.now());
    await driver.close();
    print(r);
    process.exit(r.ok ? 0 : 1);
  }
}

void main();
