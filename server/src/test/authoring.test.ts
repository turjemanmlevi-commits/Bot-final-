/**
 * Alta y edición de notas del vault (el dashboard y el bot usan el mismo código):
 * cambios a la vez, ids que chocan, vault con errores, fechas imposibles,
 * nombres raros y la fecha del reloj de la sala. Con el vault de pruebas.
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { EventNoteInputSchema, type EventNoteInput } from '@to/shared';
import { createApp, type App } from '../app';
import { writeFixtureVault } from '../gates/fixtures';
import { createHttpApp } from '../http/app';
import { MemoryDriver } from '../store/drivers';
import type { Clock } from '../util/clock';
import { SeqIdGen } from '../util/ids';
import { setLogSilent } from '../util/log';
import { VaultAuthoring } from '../vault/authoring';
import { createEventNote, VaultWriteError } from '../vault/writer';

/** Reloj de la sala lejos de hoy: las fechas que se escriben en las notas salen de aquí, no del ordenador. */
const NOW = Date.parse('2030-03-10T09:00:00Z');
const TZ = 'Europe/Madrid';
const VENUE = 'estadio-prueba';

class ManualClock implements Clock {
  readonly virtual = true;
  constructor(public t: number) {}
  now(): number {
    return this.t;
  }
  setTimeout(): number {
    return 0;
  }
  clearTimeout(): void {}
  setInterval(): number {
    return 0;
  }
  clearInterval(): void {}
  sleep(): Promise<void> {
    return Promise.resolve();
  }
}

async function note(root: string, rel: string, fm: string): Promise<void> {
  const file = path.join(root, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `---\n${fm.trim()}\n---\n\n`, 'utf8');
}

/** Vault de pruebas + un estadio con secciones «Zona · Nivel» (como las del vault real) y una zona con id propio. */
async function writeVault(dir: string): Promise<void> {
  await writeFixtureVault(dir);
  const V = '10 Recintos/Estadio Prueba';
  await note(dir, `${V}/Estadio Prueba.md`, `type: venue\nid: ${VENUE}\nname: Estadio Prueba\ncity: Madrid\nsource: prueba`);
  await note(dir, `${V}/Zonas/Lateral Este.md`, 'type: zone');
  await note(dir, `${V}/Zonas/Tribuna Principal.md`, `type: zone\nid: ${VENUE}.zona-1-tribuna`);
  for (const s of ['Lateral Este · Nivel inferior', 'Lateral Este · Primer anfiteatro']) await note(dir, `${V}/Secciones/${s}.md`, 'type: section\nzone: "[[Lateral Este]]"\nkind: SEATED');
  await note(dir, `${V}/Secciones/Tribuna Principal.md`, 'type: section\nzone: "[[Tribuna Principal]]"\nkind: SEATED');
}

const input = (p: Partial<EventNoteInput>): EventNoteInput => ({
  name: 'Partido de prueba',
  venueId: VENUE,
  providerId: 'manual',
  startsAt: '2030-04-06T21:00',
  currency: 'EUR',
  limitPerAccount: 4,
  limitPerGroup: 4,
  limitPerOperation: 8,
  limitSemantics: 'PER_HOLDER',
  limitsVerified: false,
  limitsSource: '',
  ...p,
});

describe('notas del vault desde el dashboard y Telegram', () => {
  let dir = '';
  let app: App;
  let authoring: VaultAuthoring;

  beforeEach(async () => {
    setLogSilent(true);
    dir = await mkdtemp(path.join(tmpdir(), 'to-authoring-'));
    await writeVault(dir);
    app = await createApp({ driver: new MemoryDriver(), vaultDir: dir, timeZone: TZ, publicBaseUrl: 'http://x', clock: new ManualClock(NOW), ids: new SeqIdGen() });
    authoring = new VaultAuthoring(app);
    assert.deepEqual(app.runtime.store.vaultReport?.errors, [], 'el vault de partida compila sin errores');
  });

  afterEach(async () => {
    await app.stop();
    await rm(dir, { recursive: true, force: true });
    setLogSilent(false);
  });

  const artifact = () => [...app.runtime.store.artifacts.values()].find((a) => a.venueId === VENUE && a.eventId === null);

  it('la estructura de la venta no crea zonas ni secciones con el id de otra (el vault sigue aplicándose)', async () => {
    // La web llama «Lateral Este Primer Anfiteatro» a la sección «Lateral Este · Primer anfiteatro» (mismo id)
    // y «1 Tribuna» a una zona cuyo id es el de «Tribuna Principal». Claude no las asocia a ninguna zona.
    const r = await authoring.addSaleZones(
      VENUE,
      [
        { zone: 'Lateral Este Primer Anfiteatro', sections: [], standing: false, price: '95 €', venueZone: null },
        { zone: '1 Tribuna', sections: ['Fila 1'], standing: false, price: null, venueZone: null },
      ],
      'prueba',
    );
    assert.deepEqual(
      r.report.errors.map((e) => e.message),
      [],
    );
    assert.equal(r.zones, 1, 'la zona cuyo id ya existe no se crea');
    const sections = artifact()?.sections.map((s) => s.name) ?? [];
    assert.ok(sections.includes('Lateral Este · Primer anfiteatro'));
    assert.ok(sections.includes('Lateral Este Primer Anfiteatro · Lateral Este Primer Anfiteatro'), JSON.stringify(sections));
    // Y lo siguiente que se crea llega a la sala.
    const ev = await authoring.createEvent(input({ name: 'Real Madrid - Getafe' }), 'prueba');
    assert.ok(ev.event && app.runtime.store.events.has(ev.event.id));
  });

  it('con el vault en error, un evento nuevo no se da por cargado (no está en la sala)', async () => {
    await note(dir, '20 Eventos/Nota rota.md', 'type: event\nname: Nota rota');
    const broken = await app.compileAndApply();
    assert.equal(broken.applied, false);
    const r = await authoring.createEvent(input({ name: 'Real Madrid - Osasuna' }), 'prueba');
    assert.equal(app.runtime.store.events.has('evt-real-madrid-osasuna'), false);
    assert.equal(r.event, null, 'la API no puede decir «creado» si la sala no lo tiene');
    assert.ok(r.report.errors.length > 0);
  });

  it('dos cambios a la vez en la misma nota (plano y dónde sentarse) no pierden ninguno', async () => {
    const created = await authoring.createEvent(input({ name: 'Real Madrid - Villarreal' }), 'prueba');
    const id = created.event?.id ?? '';
    assert.ok(id);
    await Promise.all([
      authoring.setPlan(id, 'https://www.example.org/plano.png', [{ zone: 'Lateral Este', x: 80, y: 50 }], 'claude'),
      authoring.setPreferredTargets(id, ['Lateral Este', 'Tribuna Principal'], 'telegram:ana'),
    ]);
    const ev = app.runtime.store.events.get(id);
    assert.equal(ev?.seatMap?.image, 'https://www.example.org/plano.png', 'el plano se ha perdido');
    assert.deepEqual(ev?.preferredTargets, ['Lateral Este', 'Tribuna Principal']);
  });

  it('dos «Añadir al recinto» a la vez: uno añade la zona y el otro no hace nada (nunca un error 500)', async () => {
    const http = createHttpApp(app, { dashboardDist: null, operatorToken: null, authoring });
    const body = JSON.stringify({ zones: [{ zone: 'Palco VIP Castellana', sections: ['Palco 1', 'Palco 2'], standing: false, price: null, venueZone: null }] });
    const post = () => http.request(`/api/vault/venues/${VENUE}/sale-zones`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    const res = await Promise.all([post(), post()]);
    const json = (await Promise.all(res.map((r) => r.json()))) as Array<{ zones: number; error?: { message: string } }>;
    assert.deepEqual(
      res.map((r) => r.status),
      [200, 200],
      JSON.stringify(json),
    );
    assert.deepEqual(json.map((j) => j.zones).sort(), [0, 1]);
    assert.ok(artifact()?.zones.some((z) => z.name === 'Palco VIP Castellana'));
  });

  it('si otra escritura crea la misma nota a la vez, conflicto claro (409) y sin la ruta del disco', async () => {
    const ctx = { vaultDir: dir, timeZone: TZ, actor: 'prueba', venueNote: 'Estadio Prueba', providerNote: 'Manual' };
    const both = await Promise.allSettled([createEventNote(input({ name: 'Real Madrid - Elche' }), 'evt-a', ctx), createEventNote(input({ name: 'Real Madrid - Elche' }), 'evt-b', ctx)]);
    const failed = both.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    assert.equal(failed.length, 1);
    const err = failed[0]?.reason as Error;
    assert.ok(err instanceof VaultWriteError && err.code === 'CONFLICT', String(err));
    assert.ok(!err.message.includes(dir), err.message);
  });

  it('dos eventos creados a la vez con el mismo slug reciben ids distintos y los dos se cargan', async () => {
    const [a, b] = await Promise.all([
      authoring.createEvent(input({ name: 'Real Madrid - Betis' }), 'dashboard'),
      authoring.createEvent(input({ name: 'Real Madrid · Betis' }), 'telegram'),
    ]);
    assert.deepEqual(a.report.errors, []);
    assert.deepEqual([a.event?.id, b.event?.id], ['evt-real-madrid-betis', 'evt-real-madrid-betis-2']);
    assert.ok(app.runtime.store.events.has('evt-real-madrid-betis') && app.runtime.store.events.has('evt-real-madrid-betis-2'));
  });

  it('un salto de línea con «---» en un campo no corta las propiedades de la nota', async () => {
    const r = await authoring.createEvent(EventNoteInputSchema.parse(input({ name: 'Concierto\n---\nGira 2030', limitsNotes: 'Primera línea\n---\nsegunda' })), 'prueba');
    assert.deepEqual(r.report.errors, []);
    assert.equal(r.event?.name, 'Concierto\n---\nGira 2030');
    assert.equal(r.event?.limits.notes, 'Primera línea\n---\nsegunda');
  });

  it('un nombre largo con un emoji en el corte da el mismo archivo en disco que en la respuesta', async () => {
    const name = `${'Gran Final de la Copa del Rey '.repeat(4).slice(0, 109)}🏆 Sevilla`;
    const r = await authoring.createEvent(EventNoteInputSchema.parse(input({ name })), 'prueba');
    const files = await readdir(path.join(dir, '20 Eventos'));
    assert.ok(files.includes(path.posix.basename(r.file)), `${r.file} no está en disco: ${files.join(' | ')}`);
    assert.equal(Buffer.from(r.file, 'utf8').toString('utf8'), r.file, 'sin medio emoji');
    assert.ok(r.file.endsWith('🏆.md'));
    assert.equal(r.event?.name, name, 'se reconoce como cargado');
  });

  it('las fechas que se escriben en las notas salen del reloj de la sala', async () => {
    const r = await authoring.createEvent(input({ name: 'Real Madrid - Alavés', limitsVerified: true, limitsSource: 'https://www.example.org/condiciones' }), 'prueba');
    assert.match(await readFile(path.join(dir, r.file), 'utf8'), /limitsVerifiedAt: "?2030-03-10"?/);
    const v = await authoring.createVenue({ name: 'Sala de Prueba', city: 'Madrid', source: 'plano de prueba', layout: 'Pista (de pie)' }, 'prueba');
    assert.match(await readFile(path.join(dir, v.folder, 'Sala de Prueba.md'), 'utf8'), /verifiedAt: "?2030-03-10"?/);
    await authoring.addSaleZones(VENUE, [{ zone: 'Fondo Norte', sections: [], standing: false, price: null, venueZone: null }], 'prueba');
    assert.match(await readFile(path.join(dir, '10 Recintos/Estadio Prueba/Zonas/Fondo Norte.md'), 'utf8'), /verifiedAt: "?2030-03-10"?/);
  });
});

describe('fechas de las notas', () => {
  it('el 30 de febrero o las 25:00 no existen: se rechazan en vez de pasar a otro día', () => {
    const bad = [input({ startsAt: '2027-02-30T21:00' }), input({ onSaleAt: '2026-10-20T25:00' }), input({ startsAt: '2027-04-31T20:00' }), input({ startsAt: '2027-05-01T20:60' })];
    for (const x of bad) {
      const r = EventNoteInputSchema.safeParse(x);
      assert.equal(r.success, false, JSON.stringify(x));
      assert.match(r.error?.issues[0]?.message ?? '', /no existe/);
    }
    assert.equal(EventNoteInputSchema.safeParse(input({ startsAt: '2028-02-29T21:00', onSaleAt: '2027-12-31T23:59' })).success, true, 'un 29 de febrero bisiesto sí');
  });

  it('un enlace oficial largo (hasta 1000 caracteres, como los que da Claude) cabe en la nota', () => {
    const url = `https://www.realmadrid.com/es-ES/entradas/rm-barcelona?${'utm_x=1&'.repeat(70)}`;
    assert.ok(url.length > 600);
    assert.equal(EventNoteInputSchema.safeParse(input({ url })).success, true);
  });
});
