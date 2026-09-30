/**
 * npm run seed:demo — pide al servidor en marcha que cree la demo
 * (cuentas ficticias + operación contra el simulador que arranca en ~90 s).
 */

import { env } from '../env';

async function main(): Promise<void> {
  const url = `http://127.0.0.1:${env.port}/api/demo/seed`;
  const startInSeconds = Number(process.argv[2] ?? 90);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-actor': 'seed-demo',
        ...(env.operatorToken ? { authorization: `Bearer ${env.operatorToken}` } : {}),
      },
      body: JSON.stringify({ startInSeconds: Number.isFinite(startInSeconds) ? startInSeconds : 90 }),
    });
    const json = (await res.json()) as { message?: string; error?: { message: string } };
    if (!res.ok) {
      console.error(`✖ ${json.error?.message ?? res.statusText}`);
      process.exit(1);
    }
    console.log(`✔ ${json.message}`);
    console.log(`  Abre el dashboard: http://localhost:${env.port}`);
  } catch {
    console.error(`✖ No hay servidor en ${url}. Arráncalo primero con:  npm start`);
    process.exit(1);
  }
}

void main();
