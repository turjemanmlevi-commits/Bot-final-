import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import type { BrowserContext } from 'playwright-core';
import { withFixtureVault, FIXTURE_MANUAL_EVENT } from '../gates/fixtures';
import { createHarness } from '../gates/harness';
import { ManualAssistProvider } from '../providers/manual';
import { ManagedBrowserService, managedProfilePath, sessionEvidence, resumableUrl, SESSION_EVIDENCE_SCRIPT, CHROME_PROFILE_OPTIONS } from '../browser/managed';
import { runInNewContext } from 'node:vm';
import { createHttpApp } from '../http/app';
import type { BrowserSnapshot } from '@to/shared';

async function setup(run: (s: {
  service: ManagedBrowserService; accountId: string; eventId: string;
  h: Awaited<ReturnType<typeof createHarness>>;
  fake: { launched: string[]; notices: string[]; evidence: { challengeVisible: boolean; loginForm: boolean; logoutControl: boolean } };
}) => Promise<void>) {
  await withFixtureVault(async (dir) => {
    const h = await createHarness(dir);
    h.app.registry.register(new ManualAssistProvider('real-madrid', 'Real Madrid'));
    const account = h.app.runtime.ctx.accounts.create({ label: 'Technical double', providerId: 'real-madrid', holderRef: 'holder' }, 'test');
    const event = h.app.runtime.store.events.get(FIXTURE_MANUAL_EVENT)!;
    h.app.runtime.store.events.set(event.id, { ...event, providerId: 'real-madrid', name: 'Femenino test double', startsAt: '2099-01-01T12:00:00Z', url: 'https://www.realmadrid.com/test-double' });
    const fake = { launched: [] as string[], notices: [] as string[], evidence: { challengeVisible: false, loginForm: false, logoutControl: false } };
    h.app.runtime.ctx.notifier = { enabled: true, connected: true, detail: '', notifyAlert() {}, notifyTask() {}, notifyBrowserIntervention: (_id, kind) => { fake.notices.push(kind); } };
    const service = new ManagedBrowserService(h.app, path.join(dir, 'profiles'), async (profile) => {
      fake.launched.push(profile);
      let closed = false;
      let url = 'about:blank';
      let onClose = () => {};
      const page = { isClosed: () => closed, bringToFront: async () => {}, goto: async (next: string) => { url = next; }, url: () => url, evaluate: async () => fake.evidence };
      return { pages: () => closed ? [] : [page], on: (_: string, callback: () => void) => { onClose = callback; }, close: async () => { closed = true; onClose(); } } as unknown as BrowserContext;
    });
    try { await run({ service, accountId: account.id, eventId: event.id, h, fake }); }
    finally { await service.close(); await h.stop(); }
  });
}

describe('perfiles propios y aprobación (sin navegar ni reservar de verdad)', () => {
  function connect(h: Awaited<ReturnType<typeof createHarness>>, accountId: string, eventId: string) {
    const eventRef = h.app.runtime.store.events.get(eventId)!.providerEventRef;
    const url = 'https://tickets.realmadrid.com/select/test-double';
    const pair = h.app.browser.pair({ accountId, eventId, eventRef, eventUrl: url, recipe: { id: 'observe-only-v1', allowedOrigins: ['https://tickets.realmadrid.com'] } });
    const binding = h.app.browser.connect({ pairingCode: pair.pairingCode, sessionId: 'technical-session', tabId: 12, url });
    const report = (patch: Partial<BrowserSnapshot> = {}) => h.app.browser.report({ ...binding, snapshot: { observedAt: new Date(h.clock.now()).toISOString(), url, supported: false, session: 'READY', queue: 'PASSED', offers: [], cart: null, ...patch } });
    report();
    return { binding, report };
  }
  it('la aprobación del dashboard sin vínculo no abre un perfil separado', async () => setup(async ({ service, accountId, eventId, fake }) => {
    const plan = service.prepare(eventId, accountId);
    assert.throws(() => service.approveConnected(plan.id), /Conecta la pestaña/);
    assert.deepEqual(fake.launched, []);
    assert.deepEqual(fake.notices, []);
  }));
  it('abrir una cuenta vinculada solo enfoca esa pestaña, nunca lanza Chrome aparte', async () => setup(async ({ service, accountId, eventId, fake, h }) => {
    const { binding } = connect(h, accountId, eventId);
    const status = await service.open(accountId);
    assert.equal(status.connectedTab, true);
    assert.notEqual(status.state, 'AUTHENTICATED');
    assert.deepEqual(fake.launched, []);
    assert.equal(h.app.browser.poll(binding).commands[0]?.type, 'FOCUS');
  }));
  it('CAPTCHA de la pestaña vinculada avisa una vez y al terminar no inventa carrito', async () => setup(async ({ service, accountId, eventId, fake, h }) => {
    const { report } = connect(h, accountId, eventId);
    report({ session: 'CHALLENGE_REQUIRED', challenge: 'CAPTCHA' });
    const plan = service.prepare(eventId, accountId);
    assert.equal(service.approveConnected(plan.id).state, 'WAITING_CAPTCHA');
    service.inspectConnectedTest(plan.id);
    assert.deepEqual(fake.notices, ['CAPTCHA']);
    report();
    assert.equal(service.inspectConnectedTest(plan.id).state, 'BLOCKED');
    assert.deepEqual(fake.launched, []);
    assert.equal(h.app.runtime.store.carts.size, 0);
  }));
  it('un cambio de vínculo exige nueva aprobación y no cambia a otra cuenta', async () => setup(async ({ service, accountId, eventId, fake, h }) => {
    const { report } = connect(h, accountId, eventId);
    report({ session: 'LOGGED_OUT' });
    const plan = service.prepare(eventId, accountId);
    service.approveConnected(plan.id);
    assert.deepEqual(fake.notices, ['LOGIN']);
    h.app.browser.revoke(accountId);
    connect(h, accountId, eventId);
    assert.equal(service.inspectConnectedTest(plan.id).state, 'BLOCKED');
    assert.deepEqual(fake.launched, []);
  }));
  it('el endpoint de aprobación utiliza el vínculo y no el lanzador de perfiles', async () => setup(async ({ service, accountId, eventId, fake, h }) => {
    connect(h, accountId, eventId);
    const plan = service.prepare(eventId, accountId);
    const http = createHttpApp(h.app, { dashboardDist: null, operatorToken: null, managedBrowser: service });
    const response = await http.request(`http://localhost/api/managed/tests/${plan.id}/approve`, { method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).state, 'BLOCKED');
    assert.deepEqual(fake.launched, []);
    assert.deepEqual(fake.notices, []);
  }));
  it('abre exclusivamente Chrome visible, conservando el sandbox', () => {
    assert.equal(CHROME_PROFILE_OPTIONS.channel, 'chrome');
    assert.equal(CHROME_PROFILE_OPTIONS.headless, false);
    assert.equal(CHROME_PROFILE_OPTIONS.chromiumSandbox, true);
  });
  it('el lector funciona sin helpers del compilador en el navegador', () => {
    const result = runInNewContext(SESSION_EVIDENCE_SCRIPT, { document: { querySelectorAll: () => [], body: { innerText: '' } } });
    assert.equal(result.logoutControl, false);
    assert.equal(result.loginForm, false);
  });
  it('guarda páginas oficiales sin códigos OAuth ni acciones de salida', () => {
    assert.equal(resumableUrl('https://www.realmadrid.com/es-ES/?code=secret#token', 'real-madrid'), 'https://www.realmadrid.com/es-ES/');
    for (const url of ['https://signin.realmadrid.com/callback?code=secret', 'https://realmadrid.com/logout', 'https://evil.example/', 'https://realmadrid.com.evil.example/', 'http://realmadrid.com/']) assert.equal(resumableUrl(url, 'real-madrid'), null);
  });
  it('al cerrar conserva URL y evidencia previa, sin declarar sesión activa', async () => setup(async ({ service, accountId, fake, h }) => {
    fake.evidence.logoutControl = true;
    await service.open(accountId);
    await service.close();
    const status = service.status().find((s) => s.accountId === accountId)!;
    assert.equal(status.state, 'CLOSED');
    assert.equal(status.savedUrl, 'https://www.realmadrid.com/es-ES/');
    assert.ok(status.lastAuthenticatedAt);
    assert.match(status.detail, /comprobará al abrirlo/);
    await h.app.runtime.ctx.journal.flush();
    assert.ok((await h.driver.loadEntities()).some((r) => r.kind === 'managedProfile' && r.id === accountId));
  }));
  it('no acepta rutas o perfiles personales', () => {
    for (const id of ['../Chrome', 'acc_../../x', 'C:\\Users\\test', '']) assert.throws(() => managedProfilePath('profiles', id));
    assert.notEqual(managedProfilePath('profiles', 'acc_a'), managedProfilePath('profiles', 'acc_b'));
  });
  it('no confunde página pública ni marcas manuales con una sesión observada', () => {
    const evidence = { official: true, challengeVisible: false, loginForm: false, logoutControl: false };
    assert.equal(sessionEvidence(evidence), 'UNKNOWN');
    assert.equal(sessionEvidence({ ...evidence, logoutControl: true }), 'AUTHENTICATED');
    assert.equal(sessionEvidence({ ...evidence, logoutControl: true, official: false }), 'UNKNOWN');
    assert.equal(sessionEvidence({ ...evidence, logoutControl: true, challengeVisible: true }), 'CAPTCHA');
  });
  it('preparar es persistente, idempotente y no abre navegadores ni manda mensajes', async () => setup(async ({ service, accountId, eventId, fake, h }) => {
    const p = service.prepare(eventId, accountId);
    assert.equal(service.prepare(eventId, accountId).id, p.id);
    assert.equal(p.state, 'AWAITING_APPROVAL');
    assert.deepEqual(fake.launched, []);
    assert.deepEqual(fake.notices, []);
    await h.app.runtime.ctx.journal.flush();
    assert.ok((await h.driver.loadEntities()).some((r) => r.kind === 'managedTest' && r.id === p.id));
    assert.equal(h.app.runtime.store.carts.size, 0);
  }));
  it('doble aprobación abre una sola vez y pide acceso una sola vez', async () => setup(async ({ service, accountId, eventId, fake }) => {
    const p = service.prepare(eventId, accountId);
    await Promise.all([service.approve(p.id), service.approve(p.id)]);
    await service.inspect(accountId);
    assert.equal(fake.launched.length, 1);
    assert.deepEqual(fake.notices, ['LOGIN']);
    assert.equal(service.plans()[0]!.state, 'WAITING_LOGIN');
  }));
  it('CAPTCHA solo si se observa; autenticación nunca crea un falso carrito', async () => setup(async ({ service, accountId, eventId, fake, h }) => {
    const p = service.prepare(eventId, accountId);
    fake.evidence.challengeVisible = true;
    await service.approve(p.id);
    await service.inspect(accountId);
    assert.deepEqual(fake.notices, ['CAPTCHA']);
    fake.evidence.challengeVisible = false;
    fake.evidence.logoutControl = true;
    await service.inspect(accountId);
    assert.equal(service.plans()[0]!.state, 'BLOCKED');
    assert.equal(h.app.runtime.store.carts.size, 0);
    assert.equal(h.app.runtime.store.operations.size, 0);
    assert.deepEqual(fake.notices, ['CAPTCHA']);
  }));
  it('detener durante la apertura no reanuda la prueba al terminar', async () => setup(async ({ service, accountId, eventId, fake }) => {
    const p = service.prepare(eventId, accountId);
    const pending = service.approve(p.id);
    service.stopTest(p.id);
    await pending;
    assert.equal(service.plans()[0]!.state, 'STOPPED');
    assert.deepEqual(fake.notices, []);
  }));
  it('el API exige autenticación, origen local y JSON, y GET no abre nada', async () => setup(async ({ service, accountId, fake, h }) => {
    const http = createHttpApp(h.app, { dashboardDist: null, operatorToken: 'technical-token', managedBrowser: service });
    const url = `http://localhost/api/managed/accounts/${accountId}/open`;
    assert.equal((await http.request(url, { method: 'POST' })).status, 401);
    assert.equal((await http.request(url, { method: 'POST', headers: { authorization: 'Bearer technical-token', origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal((await http.request('http://localhost/api/managed/status', { headers: { authorization: 'Bearer technical-token' } })).status, 200);
    assert.deepEqual(fake.launched, []);
  }));
  it('cuenta desactivada no abre ningún navegador', async () => setup(async ({ service, accountId, h, fake }) => {
    h.app.runtime.ctx.accounts.update(accountId, { enabled: false }, 'test');
    await assert.rejects(service.open(accountId));
    assert.deepEqual(fake.launched, []);
  }));
});
