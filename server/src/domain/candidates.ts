/**
 * Normalización del inventario del proveedor a candidatos canónicos (§15).
 */

import type { Candidate, Id, Minor, VenueArtifact } from '@to/shared';
import { hashOf } from '../util/hash';
import { iso } from '../util/time';
import { resolveLabel, venueIndex } from './venue';

/** Oferta tal y como la devuelve un adapter (ya en unidades menores). */
export interface RawOffer {
  offerRef: string;
  sectionLabel: string;
  row: string | null;
  seats: string[];
  qtyMin: number;
  qtyMax: number;
  unitPrice: Minor;
  currency: string;
  contiguous?: boolean | null | undefined;
  obstructed?: boolean | undefined;
  accessible?: boolean | undefined;
  standing?: boolean | undefined;
}

export interface CandidateSnapshot {
  id: string;
  /** Hash solo del contenido (ids de candidatos): igual si el inventario no ha cambiado. */
  contentHash: string;
  operationId: Id;
  observedAt: string;
  observedAtMs: number;
  offers: number;
  candidates: Candidate[];
  duplicates: number;
  unresolvedLabels: string[];
}

/** true si los asientos numéricos son consecutivos; null si no se puede saber. */
export function seatsContiguous(seats: string[]): boolean | null {
  if (seats.length === 0) return null;
  if (seats.length === 1) return true;
  const nums = seats.map((s) => (/^\d+$/.test(s) ? Number(s) : Number.NaN));
  if (nums.some((n) => Number.isNaN(n))) return null;
  nums.sort((a, b) => a - b);
  for (let i = 1; i < nums.length; i++) if ((nums[i] as number) - (nums[i - 1] as number) !== 1) return false;
  return true;
}

export function normalizeInventory(
  operationId: Id,
  offers: RawOffer[],
  observedAtMs: number,
  artifact: VenueArtifact,
): CandidateSnapshot {
  const idx = venueIndex(artifact);
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  const unresolved = new Set<string>();
  let duplicates = 0;
  const observedAt = iso(observedAtMs);

  for (const o of offers) {
    const res = resolveLabel(o.sectionLabel, artifact);
    const section = res.sectionId ? idx.sectionsById.get(res.sectionId) : undefined;
    const kind = section?.kind ?? (o.standing === undefined ? null : o.standing ? 'STANDING' : 'SEATED');
    let ambiguity = res.ambiguity;
    const reasons = [...res.reasons];
    if (section && o.standing !== undefined && o.standing !== (section.kind === 'STANDING')) {
      ambiguity = Math.max(ambiguity, 0.3);
      reasons.push('KIND_MISMATCH');
    }
    const contiguous = kind === 'STANDING' ? true : o.contiguous !== undefined ? o.contiguous : seatsContiguous(o.seats);
    const id = hashOf([o.offerRef, o.sectionLabel, o.row, o.seats, o.qtyMin, o.qtyMax, o.unitPrice, o.currency], 16);
    if (seen.has(id)) {
      duplicates++;
      continue;
    }
    seen.add(id);
    if (res.sectionId === null && unresolved.size < 20) unresolved.add(o.sectionLabel);
    candidates.push({
      id,
      offerRef: o.offerRef,
      sectionId: res.sectionId,
      sectionLabelRaw: o.sectionLabel,
      zoneId: res.zoneId,
      kind,
      row: o.row,
      seats: o.seats,
      contiguous,
      qtyMin: o.qtyMin,
      qtyMax: o.qtyMax,
      unitPrice: o.unitPrice,
      currency: o.currency,
      obstructed: Boolean(o.obstructed) || Boolean(section?.attributes.obstructed),
      accessible: Boolean(o.accessible) || Boolean(section?.attributes.accessible),
      ambiguity: Math.round(ambiguity * 1000) / 1000,
      ambiguityReasons: reasons,
      observedAt,
    });
  }

  const ids = candidates.map((c) => c.id);
  return {
    id: hashOf({ operationId, observedAtMs, ids }, 16),
    contentHash: hashOf(ids, 16),
    operationId,
    observedAt,
    observedAtMs,
    offers: offers.length,
    candidates,
    duplicates,
    unresolvedLabels: [...unresolved],
  };
}
