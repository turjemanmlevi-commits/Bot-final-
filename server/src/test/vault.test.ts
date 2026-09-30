import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { resolveLabel, resolvePreference } from '../domain/venue';
import { withFixtureVault } from '../gates/fixtures';
import { artifactForEvent, compileVault } from '../vault/compiler';
import { parseFrontmatter, parseLink, splitFrontmatter } from '../vault/markdown';
import { parseVaultDate } from '../util/time';

describe('markdown', () => {
  it('separa frontmatter con CRLF y BOM', () => {
    const r = splitFrontmatter('﻿---\r\ntype: venue\r\nname: X\r\n---\r\ncuerpo');
    assert.equal(r.yaml, 'type: venue\nname: X');
    assert.equal(r.body, 'cuerpo');
  });
  it('un «---» sangrado dentro de un valor de varias líneas no cierra las propiedades', () => {
    const r = splitFrontmatter('---\nname: |-\n  Concierto\n  ---\n  Gira\ntype: event\n---  \ncuerpo');
    assert.equal(r.yaml, 'name: |-\n  Concierto\n  ---\n  Gira\ntype: event');
    assert.deepEqual(parseFrontmatter(r.yaml ?? ''), { name: 'Concierto\n---\nGira', type: 'event' });
    assert.equal(r.body, 'cuerpo');
  });
  it('entiende enlaces de Obsidian', () => {
    assert.deepEqual(parseLink('[[Arena Demo Madrid]]'), { target: 'Arena Demo Madrid', name: 'Arena Demo Madrid' });
    assert.deepEqual(parseLink('[[10 Recintos/Arena|alias]]'), { target: '10 Recintos/Arena', name: 'Arena' });
    assert.deepEqual(parseLink('[[Nota#Encabezado]]'), { target: 'Nota', name: 'Nota' });
    assert.equal(parseLink('[[]]'), null);
  });
  it('interpreta fechas de Obsidian en la zona del vault', () => {
    assert.equal(new Date(parseVaultDate('2026-10-09T10:00', 'Europe/Madrid') as number).toISOString(), '2026-10-09T08:00:00.000Z');
    assert.equal(new Date(parseVaultDate('2026-11-21T21:00', 'Europe/Madrid') as number).toISOString(), '2026-11-21T20:00:00.000Z');
    assert.equal(new Date(parseVaultDate('2026-10-09T10:00:00Z', 'Europe/Madrid') as number).toISOString(), '2026-10-09T10:00:00.000Z');
  });
  it('una fecha que no existe no se mueve a otro día: no es válida', () => {
    for (const bad of ['2027-02-30T21:00', '2026-10-20T25:00', '2026-13-05', '2026-04-31', '2026-10-09T10:61']) assert.equal(parseVaultDate(bad, 'Europe/Madrid'), null, bad);
    assert.equal(new Date(parseVaultDate('2028-02-29T21:00', 'Europe/Madrid') as number).toISOString(), '2028-02-29T20:00:00.000Z');
  });
});

describe('compilador del vault', () => {
  it('compila el vault de pruebas sin errores y con hash estable', async () => {
    await withFixtureVault(async (dir) => {
      const a = await compileVault({ vaultDir: dir, timeZone: 'Europe/Madrid' });
      const b = await compileVault({ vaultDir: dir, timeZone: 'Europe/Madrid' });
      assert.deepEqual(a.report.errors, []);
      assert.equal(a.report.venues.length, 1);
      assert.equal(a.events.length, 3);
      assert.equal(a.report.venues[0]?.hash, b.report.venues[0]?.hash, 'mismo contenido → mismo hash');
      const ev = a.events.find((e) => e.id === 'evt-test-sim');
      assert.ok(ev);
      assert.equal(ev?.limits.semantics, 'PER_HOLDER');
      assert.ok(artifactForEvent(a.artifacts, ev as { id: string; venueId: string }));
    });
  });

  it('resuelve etiquetas del proveedor', async () => {
    await withFixtureVault(async (dir) => {
      const { artifacts } = await compileVault({ vaultDir: dir, timeZone: 'Europe/Madrid' });
      const art = artifacts[0];
      assert.ok(art);
      if (!art) return;
      assert.equal(resolveLabel('T3', art).method, 'EXACT');
      assert.equal(resolveLabel('SEC T3', art).sectionId, 'recinto-test.t3');
      assert.equal(resolveLabel('sec-t3', art).sectionId, 'recinto-test.t3');
      assert.equal(resolveLabel('Tribuna T4', art).sectionId, 'recinto-test.t4');
      assert.equal(resolveLabel('SECTOR 5', art).sectionId, 'recinto-test.t5');
      const zone = resolveLabel('PISTA', art);
      assert.equal(zone.sectionId, null, 'la zona tiene dos secciones: ambiguo');
      assert.equal(zone.method, 'ZONE_ONLY');
      assert.equal(resolveLabel('BLOQUE X-99', art).ambiguity, 1);
      assert.deepEqual(resolvePreference('Tribuna', art)?.resolvedTo, 'ZONE');
      assert.deepEqual(resolvePreference('T1', art), { resolvedTo: 'SECTION', ids: ['recinto-test.t1'] });
    });
  });

  it('rechaza capabilities prohibidas y avisa de alias ambiguos', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'to-vault-bad-'));
    try {
      await mkdir(path.join(dir, 'R'), { recursive: true });
      await writeFile(path.join(dir, 'P.md'), '---\ntype: provider\nid: malo\nmode: AUTHORIZED_API\nauthorizedCapabilities: [cart.add, checkout.pay]\n---\n');
      await writeFile(path.join(dir, 'R', 'R.md'), '---\ntype: venue\nid: r\n---\n');
      await writeFile(path.join(dir, 'R', 'Z.md'), '---\ntype: zone\n---\n');
      await writeFile(path.join(dir, 'R', 'A.md'), '---\ntype: section\nzone: "[[Z]]"\naliases: ["Dup"]\n---\n');
      await writeFile(path.join(dir, 'R', 'B.md'), '---\ntype: section\nzone: "[[Z]]"\naliases: ["Dup"]\n---\n');
      await writeFile(path.join(dir, 'R', 'Rota.md'), '---\ntype: section\nzone: [[[\n---\n');
      const c = await compileVault({ vaultDir: dir, timeZone: 'UTC' });
      assert.equal(c.providers.length, 0);
      assert.ok(c.report.errors.some((e) => e.message.includes('checkout.pay')));
      assert.ok(c.report.errors.some((e) => e.file.endsWith('Rota.md')));
      assert.ok(c.report.warnings.some((w) => w.message.includes('Alias ambiguo')));
      assert.equal(resolveLabel('Dup', c.artifacts[0] as NonNullable<(typeof c.artifacts)[0]>).sectionId, null);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
