/**
 * Eliminar cuentas desde «Cuentas»: se borra de la sala, de la base de datos (no vuelve al
 * reiniciar), con su sesión guardada del navegador del bot y sus credenciales. No se puede
 * eliminar una cuenta que está en una operación.
 */

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { createHarness } from '../gates/harness';
import { createHttpApp } from '../http/app';
import { CredentialStore } from '../runtime/credenciales';
import { BrowserTestService } from '../runtime/prueba-navegador';
import { MemoryDriver } from '../store/drivers';

const VAULT = path.resolve(fileURLToPath(new URL('../../../vault', import.meta.url)));
const JSON_HEADERS = { 'content-type': 'application/json' };

describe('eliminar cuentas', () => {
  it('borra la cuenta, su perfil del navegador y sus credenciales; no vuelve al reiniciar', async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'to-del-'));
    const driver = new MemoryDriver();
    const h = await createHarness(VAULT, { driver });
    try {
      const rt = h.app.runtime;
      const credentials = new CredentialStore(dataDir);
      const browserTest = new BrowserTestService({ app: h.app, dataDir, credentials, available: () => false, systemBrowser: () => null });
      const http = createHttpApp(h.app, { dashboardDist: null, operatorToken: null, browserTest, credentials });
      const keep = rt.ctx.accounts.create({ label: 'Se queda', providerId: 'real-madrid', holderRef: 'ana', verification: 'VERIFIED', eligibility: ['*'] }, 't');
      const gone = rt.ctx.accounts.create({ label: 'Se va', providerId: 'real-madrid', holderRef: 'luis', verification: 'VERIFIED', eligibility: ['*'] }, 't');
      credentials.set(gone.id, { email: 'luis@ejemplo.com', password: 'secreta' });
      const profile = path.join(dataDir, 'navegador', gone.id, 'Default');
      mkdirSync(profile, { recursive: true });
      writeFileSync(path.join(profile, 'Cookies'), 'x');

      // Otra web no puede borrar cuentas.
      const foreign = await http.request(`/api/accounts/${gone.id}/eliminar`, { method: 'POST', headers: { ...JSON_HEADERS, origin: 'https://otra-web.example' }, body: '{}' });
      assert.equal(foreign.status, 403);
      assert.ok(rt.store.accounts.has(gone.id));

      const res = await http.request(`/api/accounts/${gone.id}/eliminar`, { method: 'POST', headers: JSON_HEADERS, body: '{}' });
      assert.equal(res.status, 200, await res.clone().text());
      assert.deepEqual(await res.json(), { ok: true, id: gone.id, label: 'Se va' });
      assert.equal(rt.store.accounts.has(gone.id), false);
      assert.ok(rt.store.accounts.has(keep.id), 'las demás cuentas no se tocan');
      assert.equal(credentials.has(gone.id), false, 'sin email ni contraseña guardados');
      assert.equal(existsSync(path.join(dataDir, 'navegador', gone.id)), false, 'sin la sesión guardada del navegador');

      // Ya no existe: 404, y tampoco aparece en la lista.
      const again = await http.request(`/api/accounts/${gone.id}/eliminar`, { method: 'POST', headers: JSON_HEADERS, body: '{}' });
      assert.equal(again.status, 404);
      const list = (await (await http.request('/api/accounts')).json()) as Array<{ id: string }>;
      assert.deepEqual(list.map((a) => a.id), [keep.id]);
    } finally {
      await h.stop();
    }

    // Al reiniciar con los mismos datos, la cuenta eliminada no vuelve.
    const h2 = await createHarness(VAULT, { driver });
    try {
      const labels = [...h2.app.runtime.store.accounts.values()].map((a) => a.label);
      assert.deepEqual(labels, ['Se queda']);
    } finally {
      await h2.stop();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('no deja eliminar una cuenta que está en una operación', async () => {
    const h = await createHarness(VAULT);
    try {
      const rt = h.app.runtime;
      const http = createHttpApp(h.app, { dashboardDist: null, operatorToken: null });
      const a = rt.ctx.accounts.create({ label: 'En uso', providerId: 'real-madrid', holderRef: 'eva', verification: 'VERIFIED', eligibility: ['*'] }, 't');
      rt.store.putAccount({ ...a, leasedBy: 'op-1' });
      const res = await http.request(`/api/accounts/${a.id}/eliminar`, { method: 'POST', headers: JSON_HEADERS, body: '{}' });
      assert.equal(res.status, 409);
      assert.match(((await res.json()) as { error: { message: string } }).error.message, /operación/);
      assert.ok(rt.store.accounts.has(a.id));
    } finally {
      await h.stop();
    }
  });
});
