import type { ScenarioInfo } from '@to/shared';

export interface ScenarioParams {
  id: string;
  name: string;
  description: string;
  /** Probabilidad de que abrir sesión pida un reto que resuelve una persona. */
  challengeRate: number;
  queue: { minPassMs: number; maxPassMs: number; maxPosition: number; expireRate: number };
  inventory: {
    offersPerSection: [number, number];
    seatedBlock: [number, number];
    standingRemaining: [number, number];
    unknownLabelRate: number;
    zoneOnlyRate: number;
    duplicateRate: number;
    splitRate: number;
    bestAvailableRate: number;
    accessibleRate: number;
    obstructedRate: number;
  };
  /** Fracción de ofertas por segundo que se llevan otros compradores (ponderada por visión). */
  competitionPerSec: number;
  latency: { add: { median: number; p95: number }; read: { median: number; p95: number } };
  failures: {
    ambiguousRate: number;
    priceChangeRate: number;
    rateLimitRate: number;
    readFailRate: number;
    /** Tras este tiempo desde T0 el proveedor cambia el esquema de respuesta (null = nunca). */
    driftAfterMs: number | null;
  };
  cartHoldMs: number;
  serverSkewMs: number;
}

const BASE: ScenarioParams = {
  id: 'demo',
  name: 'Demo',
  description: 'Operación normal: cola corta, algún reto de sesión, algo de competencia y fallos ocasionales.',
  challengeRate: 0.2,
  queue: { minPassMs: 3000, maxPassMs: 12_000, maxPosition: 4000, expireRate: 0 },
  inventory: {
    offersPerSection: [3, 8],
    seatedBlock: [2, 6],
    standingRemaining: [2, 10],
    unknownLabelRate: 0.06,
    zoneOnlyRate: 0.05,
    duplicateRate: 0.02,
    splitRate: 0.12,
    bestAvailableRate: 0.06,
    accessibleRate: 0.04,
    obstructedRate: 0.04,
  },
  competitionPerSec: 0.04,
  latency: { add: { median: 180, p95: 450 }, read: { median: 60, p95: 160 } },
  failures: { ambiguousRate: 0.05, priceChangeRate: 0.03, rateLimitRate: 0.02, readFailRate: 0.02, driftAfterMs: null },
  cartHoldMs: 10 * 60_000,
  serverSkewMs: 140,
};

export const SCENARIOS: Record<string, ScenarioParams> = {
  demo: BASE,
  'alta-demanda': {
    ...BASE,
    id: 'alta-demanda',
    name: 'Alta demanda',
    description: 'El inventario se agota en segundos: la velocidad y el ranking importan.',
    challengeRate: 0.25,
    queue: { ...BASE.queue, maxPassMs: 20_000, maxPosition: 40_000 },
    inventory: { ...BASE.inventory, offersPerSection: [2, 5] },
    competitionPerSec: 0.35,
  },
  caos: {
    ...BASE,
    id: 'caos',
    name: 'Caos',
    description: 'Respuestas ambiguas, rate limits, cambios de precio, etiquetas raras y un cambio de esquema a los 45 s.',
    challengeRate: 0.4,
    queue: { ...BASE.queue, expireRate: 0.1 },
    inventory: { ...BASE.inventory, unknownLabelRate: 0.15, duplicateRate: 0.1, zoneOnlyRate: 0.1 },
    competitionPerSec: 0.1,
    failures: { ambiguousRate: 0.2, priceChangeRate: 0.1, rateLimitRate: 0.1, readFailRate: 0.15, driftAfterMs: 45_000 },
    serverSkewMs: 900,
  },
  tranquilo: {
    ...BASE,
    id: 'tranquilo',
    name: 'Tranquilo',
    description: 'Sin competencia ni fallos. Ideal para aprender a usar el dashboard.',
    challengeRate: 0,
    queue: { minPassMs: 1000, maxPassMs: 3000, maxPosition: 200, expireRate: 0 },
    inventory: { ...BASE.inventory, unknownLabelRate: 0.02, zoneOnlyRate: 0, duplicateRate: 0 },
    competitionPerSec: 0,
    failures: { ambiguousRate: 0, priceChangeRate: 0, rateLimitRate: 0, readFailRate: 0, driftAfterMs: null },
    serverSkewMs: 20,
  },
};

export const DEFAULT_SCENARIO = 'demo';

export function scenarioInfos(): ScenarioInfo[] {
  return Object.values(SCENARIOS).map((s) => ({ id: s.id, name: s.name, description: s.description }));
}
