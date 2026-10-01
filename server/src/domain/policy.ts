/**
 * Compilación de preferencias humanas a política canónica (§5, §15).
 *
 * Todo lo que el operador escribe ("Pista", "103", "Grada Baja") se resuelve a
 * IDs de sección ANTES de T0. Durante la ejecución no hay interpretación libre:
 * el motor solo compara IDs con esta tabla.
 */

import type { CompiledPolicy, Id, OperationConfig, ValidationIssue, VenueArtifact } from '@to/shared';
import { resolvePreference, venueIndex } from './venue';

export const POLICY_VERSION = 'selection-policy-1.0.0';
export const DEFAULT_MAX_SNAPSHOT_AGE_MS = 2000;

export interface PolicyCompilation {
  policy: CompiledPolicy;
  issues: ValidationIssue[];
}

export function compilePolicy(
  config: OperationConfig,
  artifact: VenueArtifact,
  opts: { maxSnapshotAgeMs?: number } = {},
): PolicyCompilation {
  const prefs = config.preferences;
  const idx = venueIndex(artifact);
  const issues: ValidationIssue[] = [];
  const rank = new Map<Id, number>();
  const resolution: CompiledPolicy['resolution'] = [];
  const explicitSections = new Set<Id>();

  if (prefs.targets.length === 0) {
    for (const s of artifact.sections) rank.set(s.id, 0);
    resolution.push({ input: '(todo el recinto)', resolvedTo: 'ZONE', ids: artifact.sections.map((s) => s.id), rank: 0 });
  }

  prefs.targets.forEach((input, i) => {
    const r = resolvePreference(input, artifact);
    if (!r) {
      issues.push({
        code: 'TARGET_UNRESOLVED',
        severity: 'ERROR',
        field: `preferences.targets[${i}]`,
        message: `"${input}" no es una zona ni una sección de ${artifact.name}. Revisa los aliases en el vault.`,
      });
      return;
    }
    if (r.resolvedTo === 'SECTION') for (const id of r.ids) explicitSections.add(id);
    for (const id of r.ids) if (!rank.has(id)) rank.set(id, i);
    resolution.push({ input, resolvedTo: r.resolvedTo, ids: r.ids, rank: i });
  });

  const excluded = new Set<Id>();
  prefs.excludeSections.forEach((input, i) => {
    const r = resolvePreference(input, artifact);
    if (!r) {
      issues.push({
        code: 'EXCLUDE_UNRESOLVED',
        severity: 'WARNING',
        field: `preferences.excludeSections[${i}]`,
        message: `No se encuentra "${input}" para excluirla; se ignora.`,
      });
      return;
    }
    for (const id of r.ids) excluded.add(id);
  });

  const drop = (id: Id, code: string, why: string) => {
    rank.delete(id);
    if (explicitSections.has(id)) {
      const name = idx.sectionsById.get(id)?.name ?? id;
      issues.push({ code, severity: 'WARNING', field: 'preferences.targets', message: `${name}: ${why}; no se comprará ahí.` });
    }
  };

  for (const id of [...rank.keys()]) {
    const s = idx.sectionsById.get(id);
    if (!s) {
      rank.delete(id);
      continue;
    }
    if (excluded.has(id)) rank.delete(id);
    else if (s.closed) drop(id, 'TARGET_CLOSED', 'cerrada para este evento');
    else if (s.kind === 'STANDING' && !prefs.allowStanding) drop(id, 'TARGET_STANDING', 'es de pie y la operación no admite pie');
    else if (s.attributes.accessible && !prefs.allowAccessible) drop(id, 'TARGET_ACCESSIBLE', 'son plazas accesibles reservadas');
    else if (s.attributes.obstructed && !prefs.allowObstructed) drop(id, 'TARGET_OBSTRUCTED', 'tiene visión reducida');
  }

  if (rank.size === 0) {
    issues.push({
      code: 'NO_ALLOWED_SECTIONS',
      severity: 'ERROR',
      field: 'preferences',
      message: 'Con estas preferencias no queda ninguna sección permitida.',
    });
  }

  const sectionRank: Record<Id, number> = {};
  for (const id of [...rank.keys()].sort()) sectionRank[id] = rank.get(id) as number;

  return {
    issues,
    policy: {
      policyVersion: POLICY_VERSION,
      requestedQty: config.requestedQty,
      currency: config.currency,
      maxUnitPrice: config.maxUnitPrice,
      budget: config.budget,
      sectionRank,
      excludedSectionIds: [...excluded].sort(),
      requireContiguous: prefs.requireContiguous,
      minGroupSize: prefs.minGroupSize,
      allowStanding: prefs.allowStanding,
      allowObstructed: prefs.allowObstructed,
      allowAccessible: prefs.allowAccessible,
      maxAmbiguity: prefs.maxAmbiguity,
      maxSnapshotAgeMs: opts.maxSnapshotAgeMs ?? DEFAULT_MAX_SNAPSHOT_AGE_MS,
      resolution,
    },
  };
}
