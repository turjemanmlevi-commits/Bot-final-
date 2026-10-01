/**
 * Partidos del femenino con entradas a la venta (realmadrid.com) y elección del partido de la
 * prueba real con el navegador. El extracto es de la página oficial del 1-oct-2026: el Paris FC y
 * el Inter (Champions) se venden en el canal realmadridfemenino_champions; la Liga F aún no.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { matchesOnSale, parseOfficialMatches, type RunOptions, type BotSession } from '@to/prueba';
import { createHarness } from '../gates/harness';
import { createHttpApp } from '../http/app';
import { CredentialStore } from '../runtime/credenciales';
import { BrowserTestService } from '../runtime/prueba-navegador';
import { until } from './fake-telegram';

const VAULT = path.resolve(fileURLToPath(new URL('../../../vault', import.meta.url)));
const PAGE = readFileSync(fileURLToPath(new URL('./fixtures/realmadrid-femenino-inicio.html', import.meta.url)), 'utf8');
const NOW = Date.parse('2026-10-01T12:00:00Z');
const PARIS = 'https://tickets.realmadrid.com/realmadridfemenino_champions/select/3003555?hl=es-ES';
const INTER = 'https://tickets.realmadrid.com/realmadridfemenino_champions/select/3003557?hl=es-ES';

describe('partidos del femenino a la venta', () => {
  it('lee la página oficial: todos los partidos y solo dos con entradas (Paris FC e Inter)', () => {
    const all = parseOfficialMatches(PAGE);
    assert.equal(all.length, 14);
    const onSale = matchesOnSale(all, NOW);
    assert.deepEqual(
      onSale.map((m) => [m.title, m.ticketsUrl, m.venue]),
      [
        ['Real Madrid vs Paris FC', PARIS, 'Estadio Alfredo Di Stéfano'],
        ['Real Madrid vs Internazionale', INTER, 'Estadio Alfredo Di Stéfano'],
      ],
    );
    assert.equal(onSale[0]?.competition, "Women's Champions League");
    // Los de Liga F en casa todavía no tienen enlace: no cuentan.
    assert.ok(all.some((m) => m.title === 'Real Madrid vs Espanyol' && m.ticketsUrl === ''));
    // Pasado el partido del Paris FC, el primero es el del Inter.
    assert.deepEqual(matchesOnSale(all, Date.parse('2026-11-11T00:00:00Z')).map((m) => m.title), ['Real Madrid vs Internazionale']);
  });

  it('sin partido elegido, la prueba va al primero a la venta (Paris FC) y lo dice', async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'to-partidos-'));
    const h = await createHarness(VAULT);
    try {
      const rt = h.app.runtime;
      rt.ctx.accounts.create({ label: 'Morris Levi Turjeman', providerId: 'real-madrid', holderRef: 'Levi Turjeman', verification: 'VERIFIED', eligibility: ['*'] }, 't');
      const seen: RunOptions[] = [];
      const service = new BrowserTestService({
        app: h.app,
        dataDir,
        credentials: new CredentialStore(dataDir),
        available: () => true,
        systemBrowser: () => null,
        discoverMatches: async () => matchesOnSale(parseOfficialMatches(PAGE), NOW),
        runBot: async (opts: RunOptions): Promise<BotSession> => {
          seen.push({ ...opts });
          throw new Error('fin de la prueba (sin navegador)');
        },
      });
      const http = createHttpApp(h.app, { dashboardDist: null, operatorToken: null, browserTest: service });

      const list = (await (await http.request('/api/prueba-navegador/partidos')).json()) as { matches: Array<{ title: string; label: string; ticketsUrl: string }>; error: string | null };
      assert.equal(list.error, null);
      assert.deepEqual(list.matches.map((m) => m.ticketsUrl), [PARIS, INTER]);
      assert.match(list.matches[0]?.label ?? '', /^Real Madrid vs Paris FC · .*10 nov.*Women's Champions League$/);

      const res = await http.request('/api/prueba-navegador', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quantity: 3, contiguous: true, fallbackFewer: true, zones: [], maxUnitPriceEur: null, eventUrl: '' }) });
      assert.equal(res.status, 202);
      await until(() => service.state().status === 'FAILED', 'fin de la prueba');
      assert.equal(seen.length, 1);
      assert.equal(seen[0]?.eventUrl, PARIS, 'el bot entra directo al partido del Paris FC');
      assert.equal(seen[0]?.quantity, 3);
      assert.equal(seen[0]?.contiguous, true);
      const st = service.state();
      assert.match(st.options?.matchTitle ?? '', /Real Madrid vs Paris FC/);
      assert.ok(st.log.some((l) => /Partido elegido: Real Madrid vs Paris FC/.test(l.message)));

      // Elegido en el dashboard: el del Inter.
      const res2 = await http.request('/api/prueba-navegador', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eventUrl: INTER }) });
      assert.equal(res2.status, 202);
      await until(() => seen.length === 2 && service.state().status === 'FAILED', 'segunda prueba');
      assert.equal(seen[1]?.eventUrl, INTER);
      assert.match(service.state().options?.matchTitle ?? '', /Internazionale/);

      // Un enlace de otra web no se acepta.
      const bad = await http.request('/api/prueba-navegador', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eventUrl: 'https://otra-web.example/select/1' }) });
      assert.equal(bad.status, 400);
    } finally {
      await h.stop();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('si realmadrid.com no responde, sigue buscando en los catálogos', async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'to-partidos-'));
    const h = await createHarness(VAULT);
    try {
      h.app.runtime.ctx.accounts.create({ label: 'Cuenta', providerId: 'real-madrid', holderRef: 'x', verification: 'VERIFIED', eligibility: ['*'] }, 't');
      const seen: RunOptions[] = [];
      const service = new BrowserTestService({
        app: h.app,
        dataDir,
        credentials: new CredentialStore(dataDir),
        available: () => true,
        systemBrowser: () => null,
        discoverMatches: async () => {
          throw new Error('sin conexión');
        },
        runBot: async (opts: RunOptions): Promise<BotSession> => {
          seen.push({ ...opts });
          throw new Error('fin');
        },
      });
      service.start({}, 't');
      await until(() => service.state().status === 'FAILED', 'fin');
      assert.equal(seen[0]?.eventUrl, '', 'sin enlace: el bot recorre los catálogos del femenino');
      assert.ok(service.state().log.some((l) => /No he podido leer los partidos de realmadrid\.com \(sin conexión\)/.test(l.message)));
    } finally {
      await h.stop();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
