/**
 * Consultas sobre un VenueArtifact compilado: índices por id y resolución de
 * etiquetas crudas del proveedor a secciones canónicas.
 */

import type { Id, VenueArtifact, VenueSection, VenueZone } from '@to/shared';
import { compactLabel, normalizeLabel, stripLabelPrefixes } from '../util/normalize';

export interface VenueIndex {
  sectionsById: Map<Id, VenueSection>;
  zonesById: Map<Id, VenueZone>;
  sectionsByZone: Map<Id, VenueSection[]>;
  /** nombre normalizado de sección → ids (para resolver "101" suelto). */
  sectionsByName: Map<string, Id[]>;
}

const indexCache = new WeakMap<VenueArtifact, VenueIndex>();

export function venueIndex(artifact: VenueArtifact): VenueIndex {
  let idx = indexCache.get(artifact);
  if (idx) return idx;
  const sectionsById = new Map<Id, VenueSection>();
  const zonesById = new Map<Id, VenueZone>();
  const sectionsByZone = new Map<Id, VenueSection[]>();
  const sectionsByName = new Map<string, Id[]>();
  for (const z of artifact.zones) {
    zonesById.set(z.id, z);
    sectionsByZone.set(z.id, []);
  }
  for (const s of artifact.sections) {
    sectionsById.set(s.id, s);
    sectionsByZone.get(s.zoneId)?.push(s);
    const key = normalizeLabel(s.name);
    sectionsByName.set(key, [...(sectionsByName.get(key) ?? []), s.id]);
  }
  idx = { sectionsById, zonesById, sectionsByZone, sectionsByName };
  indexCache.set(artifact, idx);
  return idx;
}

export type ResolutionMethod = 'EXACT' | 'COMPACT' | 'STRIPPED' | 'NUMERIC' | 'ZONE_SINGLE' | 'ZONE_ONLY' | 'NONE';

export interface LabelResolution {
  sectionId: Id | null;
  zoneId: Id | null;
  ambiguity: number;
  method: ResolutionMethod;
  reasons: string[];
}

const resolutionCache = new WeakMap<VenueArtifact, Map<string, LabelResolution>>();

function lookup(index: Record<string, string>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    if (!k) continue;
    const v = index[k];
    if (v !== undefined) return v;
  }
  return undefined;
}

/**
 * Resuelve una etiqueta cruda ("SEC 101", "GRADA BAJA - 101", "PISTA") a una
 * sección. Cuanto menos directa es la coincidencia, mayor es la ambigüedad
 * (0 = segura, 1 = sin resolver). La política decide cuánta ambigüedad tolera.
 */
export function resolveLabel(raw: string, artifact: VenueArtifact): LabelResolution {
  let cache = resolutionCache.get(artifact);
  if (!cache) {
    cache = new Map();
    resolutionCache.set(artifact, cache);
  }
  const hit = cache.get(raw);
  if (hit) return hit;
  const result = resolveUncached(raw, artifact);
  if (cache.size < 50_000) cache.set(raw, result);
  return result;
}

function resolveUncached(raw: string, artifact: VenueArtifact): LabelResolution {
  const idx = venueIndex(artifact);
  const zoneOf = (sectionId: Id) => idx.sectionsById.get(sectionId)?.zoneId ?? null;
  const n = normalizeLabel(raw);
  if (!n) return { sectionId: null, zoneId: null, ambiguity: 1, method: 'NONE', reasons: ['EMPTY_LABEL'] };

  const exact = artifact.sectionAliasIndex[n];
  if (exact) return { sectionId: exact, zoneId: zoneOf(exact), ambiguity: 0, method: 'EXACT', reasons: [] };

  const compact = artifact.sectionAliasIndex[compactLabel(raw)];
  if (compact) return { sectionId: compact, zoneId: zoneOf(compact), ambiguity: 0.05, method: 'COMPACT', reasons: ['FORMAT_VARIANT'] };

  const stripped = stripLabelPrefixes(n);
  if (stripped !== n) {
    const id = lookup(artifact.sectionAliasIndex, stripped, stripped.replace(/ /g, ''));
    if (id) return { sectionId: id, zoneId: zoneOf(id), ambiguity: 0.1, method: 'STRIPPED', reasons: ['PREFIX_STRIPPED'] };
  }

  // Zona mencionada + número de sección ("GRADA ALTA - 2O3" no, pero "Nivel 1 / 103" sí).
  const tokens = n.split(' ');
  const numeric = [...tokens].reverse().find((t) => /^\d+[a-z]?$/.test(t));
  const zoneId = lookup(artifact.zoneAliasIndex, n, compactLabel(raw), stripped) ?? findZoneInTokens(artifact, tokens);

  if (numeric) {
    const candidates = (idx.sectionsByName.get(numeric) ?? []).filter((id) => zoneId === null || zoneOf(id) === zoneId);
    if (candidates.length === 1) {
      const id = candidates[0] as Id;
      return { sectionId: id, zoneId: zoneOf(id), ambiguity: zoneId ? 0.15 : 0.25, method: 'NUMERIC', reasons: ['NUMERIC_TOKEN'] };
    }
  }

  if (zoneId) {
    const sections = idx.sectionsByZone.get(zoneId) ?? [];
    if (sections.length === 1) {
      const only = sections[0] as VenueSection;
      return { sectionId: only.id, zoneId, ambiguity: 0.15, method: 'ZONE_SINGLE', reasons: ['ZONE_WITH_SINGLE_SECTION'] };
    }
    return { sectionId: null, zoneId, ambiguity: 0.6, method: 'ZONE_ONLY', reasons: ['ZONE_ONLY'] };
  }

  return { sectionId: null, zoneId: null, ambiguity: 1, method: 'NONE', reasons: ['UNKNOWN_LABEL'] };
}

function findZoneInTokens(artifact: VenueArtifact, tokens: string[]): Id | null {
  // Prueba prefijos de la etiqueta ("grada baja 101" → "grada baja").
  for (let len = tokens.length - 1; len >= 1; len--) {
    const key = tokens.slice(0, len).join(' ');
    const id = artifact.zoneAliasIndex[key] ?? artifact.zoneAliasIndex[key.replace(/ /g, '')];
    if (id) return id;
  }
  return null;
}

/**
 * Resolución estricta para las preferencias humanas: solo coincidencias
 * directas (sin adivinar por número). Devuelve una sección o una zona entera.
 */
export function resolvePreference(
  input: string,
  artifact: VenueArtifact,
): { resolvedTo: 'SECTION' | 'ZONE'; ids: Id[] } | null {
  const n = normalizeLabel(input);
  if (!n) return null;
  const c = compactLabel(input);
  const s = stripLabelPrefixes(n);
  const sectionId = lookup(artifact.sectionAliasIndex, n, c, s, s.replace(/ /g, ''));
  if (sectionId) return { resolvedTo: 'SECTION', ids: [sectionId] };
  const zoneId = lookup(artifact.zoneAliasIndex, n, c, s, s.replace(/ /g, ''));
  if (zoneId) {
    const ids = (venueIndex(artifact).sectionsByZone.get(zoneId) ?? []).map((x) => x.id).sort();
    return { resolvedTo: 'ZONE', ids };
  }
  return null;
}
