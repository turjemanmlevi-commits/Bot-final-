/**
 * Vault de pruebas independiente del vault del usuario: los gates y los tests
 * no dependen de lo que escribas en Obsidian.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function note(root: string, rel: string, frontmatter: string, body = ''): Promise<void> {
  const file = path.join(root, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `---\n${frontmatter.trim()}\n---\n\n${body}\n`, 'utf8');
}

export const FIXTURE_SIM_EVENT = 'evt-test-sim';
export const FIXTURE_MANUAL_EVENT = 'evt-test-manual';
export const FIXTURE_UNVERIFIED_EVENT = 'evt-test-unverified';

export async function writeFixtureVault(root: string): Promise<void> {
  const V = '10 Recintos/Recinto Test';
  await note(root, `${V}/Recinto Test.md`, `
type: venue
id: recinto-test
name: Recinto Test
city: Pruebas
source: "fixture"
verifiedAt: 2026-01-01
confidence: 0.95
`);
  await note(root, `${V}/Zonas/Pista Test.md`, `
type: zone
aliases: ["Pista", "General"]
`);
  await note(root, `${V}/Zonas/Tribuna.md`, `
type: zone
aliases: ["Grada", "Nivel 1"]
`);
  for (const s of ['Pista Frontal', 'Pista Fondo']) {
    await note(root, `${V}/Secciones/${s}.md`, `
type: section
zone: "[[Pista Test]]"
kind: STANDING
aliases: ["${s.toUpperCase()}"]
capacity: 1000
view: ${s === 'Pista Frontal' ? 5 : 4}
distance: ${s === 'Pista Frontal' ? 8 : 30}
`);
  }
  for (let n = 1; n <= 6; n++) {
    const name = `T${n}`;
    await note(root, `${V}/Secciones/${name}.md`, `
type: section
zone: "[[Tribuna]]"
kind: SEATED
aliases: ["SEC ${name}", "Tribuna ${name}", "Sector ${n}"]
rows: 12
seatsPerRow: 20
view: ${[3, 4, 5, 5, 4, 3][n - 1]}
distance: ${[40, 32, 26, 26, 32, 40][n - 1]}
obstructed: ${n === 6}
`);
  }
  await note(root, `${V}/Secciones/Accesible.md`, `
type: section
zone: "[[Tribuna]]"
kind: SEATED
aliases: ["PMR"]
rows: 1
seatsPerRow: 20
view: 4
distance: 30
accessible: true
`);
  await note(root, '30 Proveedores/Simulador.md', `
type: provider
id: sim
name: Simulador
mode: SIMULATED
authorizedCapabilities: [session.open, session.status, queue.status, inventory.read, cart.add, cart.read, clock.server_time]
`);
  await note(root, '30 Proveedores/Manual.md', `
type: provider
id: manual
name: Manual
mode: MANUAL_ASSIST
authorizedCapabilities: []
`);
  const limits = (semantics: string, verified: boolean, per: number) => `
limitPerAccount: ${per}
limitPerGroup: ${per}
limitPerOperation: 12
limitSemantics: ${semantics}
limitsVerified: ${verified}
limitsSource: "fixture"
`;
  await note(root, '20 Eventos/Evento Sim.md', `
type: event
id: ${FIXTURE_SIM_EVENT}
name: Evento Sim
venue: "[[Recinto Test]]"
provider: "[[Simulador]]"
providerEventRef: TEST-SIM
startsAt: 2027-01-01T21:00:00Z
currency: EUR
${limits('PER_HOLDER', true, 4)}
`);
  await note(root, '20 Eventos/Evento Manual.md', `
type: event
id: ${FIXTURE_MANUAL_EVENT}
name: Evento Manual
venue: "[[Recinto Test]]"
provider: "[[Manual]]"
providerEventRef: TEST-MANUAL
startsAt: 2027-01-01T21:00:00Z
currency: EUR
${limits('PER_ACCOUNT', true, 6)}
`);
  await note(root, '20 Eventos/Evento Sin Verificar.md', `
type: event
id: ${FIXTURE_UNVERIFIED_EVENT}
name: Evento Sin Verificar
venue: "[[Recinto Test]]"
provider: "[[Simulador]]"
providerEventRef: TEST-UNVERIFIED
startsAt: 2027-01-01T21:00:00Z
currency: EUR
${limits('UNKNOWN', false, 4)}
`);
}

/** Crea el vault de pruebas en un directorio temporal. */
export async function withFixtureVault<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'to-vault-'));
  try {
    await writeFixtureVault(dir);
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
