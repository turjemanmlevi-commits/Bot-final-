import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { VenueArtifact, VenueSection, VenueZone } from '@to/shared';

/**
 * Plano visual del recinto generado desde el vault.
 *
 * - Estadios (zonas con orientación: Norte/Sur/Este/Oeste, Fondo, Lateral):
 *   óvalo con el campo en el centro, una grada por lado y sus niveles como
 *   anillos (del más cercano al campo al más alto), con el norte arriba.
 * - Pabellones y teatros: escenario arriba y las zonas como anillos en «U»
 *   alrededor de la pista o la platea; las secciones se reparten a lo largo.
 * - Zonas de pie (pista) dentro del campo.
 *
 * Es orientativo: sirve para ver de un vistazo dónde queda cada zona y en qué
 * orden se va a intentar comprar; los sectores exactos están en el plano
 * oficial de cada venta.
 *
 * Los textos y marcadores se escalan con el ancho real en pantalla: los
 * nombres de zona nunca bajan de ~11 px ni los marcadores de ~18 px.
 */

type Side = 'top' | 'right' | 'bottom' | 'left';

export interface MapTarget {
  /** Etiqueta tal y como está en la operación (zona o sección). */
  label: string;
  /** 1, 2, 3… orden de preferencia. */
  rank: number;
}

/** Normalización para leer nombres (conserva «º» para los niveles «1º»). */
const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9º]+/g, ' ')
    .trim();

/** Normalización para comparar etiquetas: minúsculas, sin acentos ni signos. */
const key = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Palabras genéricas que se anteponen a una sección o zona («SEC 101», «Grada Alta»). */
const LABEL_PREFIXES = new Set(['sec', 'secc', 'seccion', 'section', 'sector', 'zona', 'zone', 'grada', 'tribuna']);

function stripPrefix(k: string): string {
  const words = k.split(' ').filter(Boolean);
  if (words.length > 1 && LABEL_PREFIXES.has(words[0] ?? '')) return words.slice(1).join(' ');
  return k;
}

function sideFor(name: string): Side | null {
  const n = ` ${norm(name)} `;
  // «oeste» contiene «este»: se comprueba antes.
  if (/ (oeste|west|poniente) /.test(n)) return 'left';
  if (/ (este|east|levante) /.test(n)) return 'right';
  if (/ (norte|north) /.test(n)) return 'top';
  if (/ (sur|south) /.test(n)) return 'bottom';
  if (/ (izquierda|izq|left) /.test(n)) return 'left';
  if (/ (derecha|der|right) /.test(n)) return 'right';
  return null;
}

/**
 * Nivel dentro de una grada: cuanto más bajo, más cerca del campo. Solo importa
 * el orden relativo dentro de cada grada. null si el nombre no lo dice.
 */
function tierOf(s: VenueSection): number | null {
  const n = ` ${norm(`${s.name} ${s.level ?? ''}`)} `;
  if (/ (cuarto|4º|4o|4 anfiteatro) /.test(n)) return 4;
  if (/ (tercer|tercero|3er|3º|3 anfiteatro) /.test(n)) return 3;
  if (/ (segundo|2º|2o|2 anfiteatro) /.test(n)) return 2;
  if (/ (primer|primero|1er|1º|1 anfiteatro) /.test(n)) return 1;
  const numbered = / (?:nivel|anillo|piso|planta) (\d{1,2}) /.exec(n);
  if (numbered) return Math.max(0, Number(numbered[1]) - 1);
  if (/ (nivel inferior|inferior|baja|bajo|lower|nivel campo|pie de campo) /.test(n)) return 0;
  if (/ (media|medio|intermedia|intermedio|middle) /.test(n)) return 1.5;
  if (/ (alta|alto|superior|upper) /.test(n)) return 9;
  if (/ anfiteatro /.test(n)) return 1;
  return null;
}

/** Orden de una zona «anillo» (pabellones y teatros). */
function zoneRingRank(z: VenueZone, index: number): number {
  const n = ` ${norm(z.name)} `;
  if (/ (platea|baja|inferior|nivel 1|lower|pista) /.test(n)) return 0;
  if (/ (palco|palcos|club|vip) /.test(n)) return 1;
  if (/ (anfiteatro|media|nivel 2|entresuelo) /.test(n)) return 2;
  if (/ (alta|superior|nivel 3|upper|paraiso|gallinero) /.test(n)) return 3;
  return 4 + index;
}

/** Orden natural «101» < «102» < «PMR 1». */
const natural = (a: string, b: string) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });

/** Ángulo deseado de una sección en un anillo en «U» (0 = derecha, 90 = abajo, 180 = izquierda). */
function preferredAngle(name: string): number | null {
  const n = ` ${norm(name)} `;
  if (/ (izquierda|izq) /.test(n)) return 200;
  if (/ (derecha|der) /.test(n)) return -20;
  if (/ (central|centro) /.test(n)) return 90;
  return null;
}

/** «Platea Central» en la zona «Platea» → «Central»; «Lateral Este · Primer anfiteatro» → «Primer anfiteatro». */
function shortName(section: string, zone: string): string {
  const z = zone.trim();
  if (z && section.toLowerCase().startsWith(z.toLowerCase()) && section.length > z.length + 1) {
    const rest = section.slice(z.length).replace(/^[\s·:,/-]+/, '');
    if (rest) return rest;
  }
  return section;
}

/** «Zona · sección» sin repetir la zona. */
function spotLabel(s: Spot): string {
  const short = shortName(s.section.name, s.zone.name);
  return key(short) === key(s.zone.name) ? s.zone.name : `${s.zone.name} · ${short}`;
}

interface Spot {
  section: VenueSection;
  zone: VenueZone;
}

interface Piece extends Spot {
  /** Único por trozo: una sección «Lateral» sin lado ocupa los dos lados de la «U». */
  pid: string;
  ring: number;
  a1: number;
  a2: number;
  /** Nombre del nivel (nombre corto de la sección). */
  tierName: string;
  /** Anillos que tiene su grada. */
  zoneRings: number;
}

interface Layout {
  mode: 'stadium' | 'arena';
  pieces: Piece[];
  center: Spot[];
  rings: number;
  zoneLabels: Array<{ zone: VenueZone; ring: number; angle: number }>;
  /** Leyenda: nombre del nivel y anillos que colorea (el mismo nombre puede estar a distinta altura en cada grada). */
  legend: Array<{ name: string; rings: number[] }>;
}

const U0 = -58;
const U1 = 238;

/**
 * Reparte las secciones de una zona a lo largo de la «U». Las que dicen dónde
 * están («Central», «Izquierda», «Derecha») se centran en su sitio; las demás
 * llenan los huecos en orden. Si solo queda una («Lateral»), ocupa todos los
 * huecos (los dos lados).
 */
function arrangeU(sections: VenueSection[]): Array<{ s: VenueSection; a1: number; a2: number }> {
  const sorted = [...sections].sort((x, y) => natural(x.name, y.name));
  const n = sorted.length;
  if (n === 0) return [];
  const w = (U1 - U0) / n;
  const fixed = sorted
    .map((s) => ({ s, want: preferredAngle(s.name) }))
    .filter((x): x is { s: VenueSection; want: number } => x.want !== null)
    .sort((a, b) => a.want - b.want);
  const free = sorted.filter((s) => preferredAngle(s.name) === null);
  if (fixed.length === 0 || free.length === 0) {
    const withAngle = sorted.map((s, i) => ({ s, want: preferredAngle(s.name) ?? U0 + ((i + 0.5) / n) * (U1 - U0) })).sort((x, y) => x.want - y.want);
    return withAngle.map(({ s }, i) => ({ s, a1: U0 + i * w, a2: U0 + (i + 1) * w }));
  }
  // Fijas: centradas en su ángulo, sin solaparse y dentro de la «U».
  const spans = fixed.map((f) => ({ s: f.s, a1: f.want - w / 2, a2: f.want + w / 2 }));
  let cursor = U0;
  for (const sp of spans) {
    const shift = Math.max(0, cursor - sp.a1);
    sp.a1 += shift;
    sp.a2 += shift;
    cursor = sp.a2;
  }
  let limit = U1;
  for (let i = spans.length - 1; i >= 0; i--) {
    const sp = spans[i];
    if (!sp) continue;
    const shift = Math.max(0, sp.a2 - limit);
    sp.a1 -= shift;
    sp.a2 -= shift;
    limit = sp.a1;
  }
  // Huecos libres entre las fijas.
  const gaps: Array<{ a1: number; a2: number; left: number | null; right: number | null }> = [];
  let prev = U0;
  spans.forEach((sp, i) => {
    if (sp.a1 - prev > 0.5) gaps.push({ a1: prev, a2: sp.a1, left: i === 0 ? null : i - 1, right: i });
    prev = sp.a2;
  });
  if (U1 - prev > 0.5) gaps.push({ a1: prev, a2: U1, left: spans.length - 1, right: null });
  const out: Array<{ s: VenueSection; a1: number; a2: number }> = [];
  if (free.length === 1) {
    const only = free[0] as VenueSection;
    for (const gp of gaps) out.push({ s: only, a1: gp.a1, a2: gp.a2 });
  } else {
    // Cuántas secciones van a cada hueco: proporcional a su tamaño (mayor resto).
    const total = gaps.reduce((acc, gp) => acc + gp.a2 - gp.a1, 0);
    const exact = gaps.map((gp) => ((gp.a2 - gp.a1) / total) * free.length);
    const counts = exact.map((x) => Math.floor(x));
    let left = free.length - counts.reduce((a, b) => a + b, 0);
    const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r);
    for (const o of order) {
      if (left <= 0) break;
      counts[o.i] = (counts[o.i] ?? 0) + 1;
      left--;
    }
    let next = 0;
    gaps.forEach((gp, gi) => {
      const c = counts[gi] ?? 0;
      if (c === 0) {
        // Hueco sin secciones: lo cubren las fijas de al lado.
        const mid = (gp.a1 + gp.a2) / 2;
        const l = gp.left === null ? undefined : spans[gp.left];
        const r = gp.right === null ? undefined : spans[gp.right];
        if (l && r) {
          l.a2 = mid;
          r.a1 = mid;
        } else if (l) l.a2 = gp.a2;
        else if (r) r.a1 = gp.a1;
        return;
      }
      const gw = (gp.a2 - gp.a1) / c;
      for (let j = 0; j < c; j++) {
        const s = free[next++];
        if (s) out.push({ s, a1: gp.a1 + j * gw, a2: gp.a1 + (j + 1) * gw });
      }
    });
  }
  return [...spans, ...out].sort((a, b) => a.a1 - b.a1);
}

/** Nivel desconocido en una grada donde los demás sí se conocen: anillo propio, por fuera. */
const UNKNOWN_TIER = 100;

function buildLayout(a: VenueArtifact): Layout {
  const byZone = new Map<string, VenueSection[]>();
  for (const s of a.sections) byZone.set(s.zoneId, [...(byZone.get(s.zoneId) ?? []), s]);
  const center: Spot[] = [];
  const sided: Record<Side, VenueZone[]> = { top: [], right: [], bottom: [], left: [] };
  const ringZones: VenueZone[] = [];
  for (const z of a.zones) {
    const secs = byZone.get(z.id) ?? [];
    if (secs.length === 0) continue;
    const isFloor = secs.every((s) => s.kind === 'STANDING') || /^(pista|floor|general)/.test(norm(z.name));
    if (isFloor) {
      for (const s of [...secs].sort((x, y) => natural(x.name, y.name))) center.push({ section: s, zone: z });
      continue;
    }
    const side = sideFor(z.name);
    if (side) sided[side].push(z);
    else ringZones.push(z);
  }
  const hasSided = Object.values(sided).some((l) => l.length > 0);
  const pieces: Piece[] = [];
  const zoneLabels: Layout['zoneLabels'] = [];
  const legend = new Map<string, { name: string; rings: number[] }>();
  const addLegend = (name: string, ring: number) => {
    const lk = key(name);
    const e = legend.get(lk);
    if (!e) legend.set(lk, { name, rings: [ring] });
    else if (!e.rings.includes(ring)) e.rings = [...e.rings, ring].sort((a, b) => a - b);
  };
  let rings = 1;

  if (hasSided) {
    // Estadio: las zonas sin orientación ocupan los lados libres.
    for (const z of ringZones) {
      const free = (['left', 'right', 'top', 'bottom'] as Side[]).find((sd) => sided[sd].length === 0);
      sided[free ?? 'bottom'].push(z);
    }
    const RANGE: Record<Side, [number, number]> = { right: [-45, 45], bottom: [45, 135], left: [135, 225], top: [225, 315] };
    for (const side of Object.keys(sided) as Side[]) {
      const zones = sided[side];
      if (zones.length === 0) continue;
      const [s0, s1] = RANGE[side];
      const span = (s1 - s0) / zones.length;
      zones.forEach((z, zi) => {
        const z0 = s0 + zi * span + 1.5;
        const z1 = s0 + (zi + 1) * span - 1.5;
        const secs = byZone.get(z.id) ?? [];
        const known = secs.map((s) => tierOf(s));
        const anyKnown = known.some((t) => t !== null);
        const tiers = new Map<number, VenueSection[]>();
        secs.forEach((s, i) => {
          const t = known[i] ?? null;
          const k = t ?? (anyKnown ? UNKNOWN_TIER : 0);
          tiers.set(k, [...(tiers.get(k) ?? []), s]);
        });
        const tierKeys = [...tiers.keys()].sort((x, y) => x - y);
        tierKeys.forEach((t, ringIndex) => {
          const group = (tiers.get(t) ?? []).sort((x, y) => natural(x.name, y.name));
          const w = (z1 - z0) / group.length;
          group.forEach((s, gi) => {
            const tierName = shortName(s.name, z.name);
            // Solo van a la leyenda los niveles que se reconocen (o los que tienen anillo propio).
            if (anyKnown) addLegend(tierName, ringIndex);
            pieces.push({
              pid: s.id,
              section: s,
              zone: z,
              ring: ringIndex,
              a1: z0 + gi * w + (group.length > 1 ? 0.6 : 0),
              a2: z0 + (gi + 1) * w - (group.length > 1 ? 0.6 : 0),
              tierName,
              zoneRings: tierKeys.length,
            });
          });
        });
        rings = Math.max(rings, tierKeys.length);
        zoneLabels.push({ zone: z, ring: tierKeys.length - 1, angle: (z0 + z1) / 2 });
      });
    }
    const legendList = [...legend.values()].sort((x, y) => (x.rings[0] ?? 0) - (y.rings[0] ?? 0) || x.rings.length - y.rings.length);
    return { mode: 'stadium', pieces, center, rings, zoneLabels, legend: legendList };
  }

  // Pabellón / teatro: escenario arriba y anillos en «U».
  const ordered = ringZones.map((z, i) => ({ z, r: zoneRingRank(z, i) })).sort((x, y) => x.r - y.r);
  let ring = 0;
  for (const { z } of ordered) {
    arrangeU(byZone.get(z.id) ?? []).forEach(({ s, a1, a2 }, i) => {
      pieces.push({ pid: `${s.id}#${i}`, section: s, zone: z, ring, a1: a1 + 0.8, a2: a2 - 0.8, tierName: z.name, zoneRings: 1 });
    });
    addLegend(z.name, ring);
    zoneLabels.push({ zone: z, ring, angle: U0 - 6 });
    ring++;
  }
  rings = Math.max(1, ring);
  return { mode: 'arena', pieces, center, rings, zoneLabels, legend: [...legend.values()] };
}

// ---------------------------------------------------------------------------
// Coincidencias (objetivos y resaltado)
// ---------------------------------------------------------------------------

/**
 * Busca las secciones a las que se refiere una etiqueta, de la coincidencia más
 * directa a la más tolerante; se queda con el primer nivel que encuentra algo.
 * Así «Tribuna · Baja» no marca también «Fondo Norte · Baja».
 */
function matchSections(label: string, layout: Layout): Set<string> {
  const spots: Spot[] = [...layout.pieces, ...layout.center];
  const l = key(label);
  const out = new Set<string>();
  if (!l) return out;
  const lc = l.replace(/ /g, '');
  const ls = stripPrefix(l);
  const lsc = ls.replace(/ /g, '');
  const names = (s: Spot) => [s.section.name, s.zone.name, ...s.section.aliases, ...s.zone.aliases].map(key);
  const short = (s: Spot) => key(shortName(s.section.name, s.zone.name));
  const levels: Array<(s: Spot) => boolean> = [
    (s) => names(s).includes(l),
    (s) => names(s).some((n) => n.replace(/ /g, '') === lc),
    (s) => {
      const sh = short(s);
      return sh === l || sh.replace(/ /g, '') === lc;
    },
    // «SEC 201» → «201», «Zona Pista» → «Pista» (como el servidor: solo se quita de la etiqueta).
    (s) => {
      if (ls === l) return false;
      return [...names(s), short(s)].some((n) => n === ls || n.replace(/ /g, '') === lsc);
    },
  ];
  for (const test of levels) {
    for (const s of spots) if (test(s)) out.add(s.section.id);
    if (out.size > 0) return out;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Geometría
// ---------------------------------------------------------------------------

const RING_GAP = 3;
/** Texto y marcadores: tamaños base en unidades del plano (se multiplican por k). */
const ZONE_FONT = 15;
const MARKER_R = 13;
/** k·escala mínima en pantalla: 15 × 0,75 ≈ 11 px de rótulo y 26 × 0,75 ≈ 19,5 px de marcador. */
const MIN_SCREEN = 0.75;
const CHAR_W = 0.62;

const rad = (d: number) => (d * Math.PI) / 180;

function pt(cx: number, cy: number, rx: number, ry: number, deg: number): [number, number] {
  return [cx + rx * Math.cos(rad(deg)), cy + ry * Math.sin(rad(deg))];
}

function sectorPath(cx: number, cy: number, r0: [number, number], r1: [number, number], a1: number, a2: number): string {
  const large = a2 - a1 > 180 ? 1 : 0;
  const [ox1, oy1] = pt(cx, cy, r1[0], r1[1], a1);
  const [ox2, oy2] = pt(cx, cy, r1[0], r1[1], a2);
  const [ix2, iy2] = pt(cx, cy, r0[0], r0[1], a2);
  const [ix1, iy1] = pt(cx, cy, r0[0], r0[1], a1);
  const f = (n: number) => n.toFixed(1);
  return `M${f(ox1)} ${f(oy1)} A${f(r1[0])} ${f(r1[1])} 0 ${large} 1 ${f(ox2)} ${f(oy2)} L${f(ix2)} ${f(iy2)} A${f(r0[0])} ${f(r0[1])} 0 ${large} 0 ${f(ix1)} ${f(iy1)}Z`;
}

/** ¿Está el punto dentro del trozo de anillo (entre elipses y entre ángulos)? */
function inPiece(px: number, py: number, cx: number, cy: number, r0: [number, number], r1: [number, number], a1: number, a2: number, mx: number, my: number): boolean {
  const dx = px - cx;
  const dy = py - cy;
  if ((dx / r0[0]) ** 2 + (dy / r0[1]) ** 2 < 1) return false;
  if ((dx / r1[0]) ** 2 + (dy / r1[1]) ** 2 > 1) return false;
  let th = (Math.atan2(dy / my, dx / mx) * 180) / Math.PI;
  while (th < a1) th += 360;
  while (th >= a1 + 360) th -= 360;
  return th <= a2;
}

type LabelPlacement = { kind: 'flat'; x: number; y: number } | { kind: 'arc'; d: string };

/**
 * Dónde va el nombre de una sección: en horizontal si cabe entero dentro de su
 * trozo de anillo; si no, curvado a lo largo del anillo (siempre derecho); si
 * tampoco cabe, no se dibuja (el nombre sale al tocar o pasar el ratón).
 */
function sectionLabelPlacement(
  text: string,
  fs: number,
  cx: number,
  cy: number,
  r0: [number, number],
  r1: [number, number],
  a1: number,
  a2: number,
): LabelPlacement | null {
  const mx = (r0[0] + r1[0]) / 2;
  const my = (r0[1] + r1[1]) / 2;
  const mid = (a1 + a2) / 2;
  const [x, y] = pt(cx, cy, mx, my, mid);
  const textW = CHAR_W * fs * text.length;
  const hw = textW / 2 + 3;
  const hh = fs * 0.42 + 2;
  const corners: Array<[number, number]> = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
    [0, -hh],
    [0, hh],
  ];
  if (corners.every(([u, v]) => inPiece(x + u, y + v, cx, cy, r0, r1, a1 + 0.3, a2 - 0.3, mx, my))) return { kind: 'flat', x, y };
  // Curvado: el grosor del anillo tiene que dar para la altura del texto y el arco para su largo.
  if (fs * 0.95 > Math.min(r1[0] - r0[0], r1[1] - r0[1]) - 4) return null;
  let arc = 0;
  let prev = pt(cx, cy, mx, my, a1);
  for (let i = 1; i <= 24; i++) {
    const cur = pt(cx, cy, mx, my, a1 + ((a2 - a1) * i) / 24);
    arc += Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    prev = cur;
  }
  if (textW + 10 > arc) return null;
  // En la mitad de abajo el texto va de a2 a a1 para que se lea derecho.
  const bottom = Math.sin(rad(mid)) > 0.05;
  const from = bottom ? a2 : a1;
  const to = bottom ? a1 : a2;
  const [sx, sy] = pt(cx, cy, mx, my, from);
  const [ex, ey] = pt(cx, cy, mx, my, to);
  const f = (n: number) => n.toFixed(1);
  const large = a2 - a1 > 180 ? 1 : 0;
  return { kind: 'arc', d: `M${f(sx)} ${f(sy)} A${f(mx)} ${f(my)} 0 ${large} ${bottom ? 0 : 1} ${f(ex)} ${f(ey)}` };
}

/** Parte un rótulo en dos líneas por el espacio más centrado («Lateral» / «Oeste»). */
function wrapLabel(text: string): string[] {
  const words = text.split(' ');
  if (words.length < 2) return [text];
  let best: string[] = [text];
  let bestLen = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const len = Math.max(a.length, b.length);
    if (len < bestLen) {
      bestLen = len;
      best = [a, b];
    }
  }
  return best;
}

interface ZoneLabelGeo {
  zone: VenueZone;
  lines: string[];
  x: number;
  /** y del centro de la primera línea. */
  y: number;
  anchor: 'start' | 'middle' | 'end';
}

interface Geo {
  k: number;
  /** Escala del plano en pantalla (px por unidad). */
  scale: number;
  W: number;
  H: number;
  cx: number;
  cy: number;
  ring: number;
  step: number;
  r0x: number;
  r0y: number;
  /** Medio ancho/alto del campo o de la pista. */
  fieldX: number;
  fieldY: number;
  fs: number;
  lineH: number;
  labels: ZoneLabelGeo[];
  compass: { x: number; y: number } | null;
  stage: { x: number; y: number; w: number; h: number } | null;
}

function radiiOf(g: Pick<Geo, 'r0x' | 'r0y' | 'ring' | 'step'>, ring: number): [[number, number], [number, number]] {
  return [
    [g.r0x + ring * g.step, g.r0y + ring * g.step],
    [g.r0x + ring * g.step + g.ring, g.r0y + ring * g.step + g.ring],
  ];
}

function geometry(layout: Layout, k: number, thick: boolean, wrap: boolean): Omit<Geo, 'scale'> {
  const stadium = layout.mode === 'stadium';
  const ring = stadium ? (thick ? 44 : 34) : thick ? 38 : 34;
  const step = ring + RING_GAP;
  const fw = stadium ? (thick ? 150 : 200) : 300;
  const fh = stadium ? (thick ? 225 : 300) : 170;
  const r0x = fw / 2 + 26;
  const r0y = fh / 2 + 26;
  const outerX = r0x + layout.rings * step - RING_GAP;
  const outerY = r0y + layout.rings * step - RING_GAP;
  const fs = ZONE_FONT * k;
  const lineH = fs * 1.15;
  const markerR = MARKER_R * k;

  // Caja alrededor del centro (0, 0): se amplía con cada rótulo.
  let minX = -outerX - 8;
  let maxX = outerX + 8;
  let minY = -outerY - 8;
  let maxY = outerY + 8;
  const labels: ZoneLabelGeo[] = [];
  const boxes: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];
  let stage: Geo['stage'] = null;
  let compass: Geo['compass'] = null;
  let fieldX: number;
  let fieldY: number;

  if (stadium) {
    // El campo cabe dentro del primer anillo: sus esquinas no asoman.
    fieldX = r0x * 0.66;
    fieldY = r0y * 0.66;
    // Separación para que un marcador en el anillo exterior no tape el rótulo.
    const pad = Math.max(14, markerR - ring / 2 + 8);
    for (const zl of layout.zoneLabels) {
      const r1 = radiiOf({ r0x, r0y, ring, step }, zl.ring)[1];
      const [px, py] = pt(0, 0, r1[0] + pad, r1[1] + pad, zl.angle);
      const c = Math.cos(rad(zl.angle));
      const sn = Math.sin(rad(zl.angle));
      const anchor: ZoneLabelGeo['anchor'] = Math.abs(c) < 0.3 ? 'middle' : c > 0 ? 'start' : 'end';
      const lines = wrap && anchor !== 'middle' ? wrapLabel(zl.zone.name) : [zl.zone.name];
      const tw = CHAR_W * fs * Math.max(...lines.map((l) => l.length));
      const bh = lineH * lines.length;
      let top: number;
      if (anchor === 'middle') top = sn < 0 ? py - bh : py;
      else top = py - bh / 2;
      const x0 = anchor === 'start' ? px : anchor === 'end' ? px - tw : px - tw / 2;
      minX = Math.min(minX, x0 - 24);
      maxX = Math.max(maxX, x0 + tw + 24);
      minY = Math.min(minY, top - 10);
      maxY = Math.max(maxY, top + bh + 10);
      boxes.push({ x0, x1: x0 + tw, y0: top, y1: top + bh });
      labels.push({ zone: zl.zone, lines, x: px, y: top + lineH / 2, anchor });
    }
  } else {
    fieldX = (fw / 2) * 0.78;
    fieldY = (fh / 2) * 0.78;
    // Escenario entre los extremos de la «U».
    const sw = Math.max(90, 2 * (r0x * Math.cos(rad(58)) - 8));
    const sh = Math.max(24, 16 * k);
    const sy = -r0y * Math.sin(rad(58)) - sh - 6;
    stage = { x: -sw / 2, y: sy, w: sw, h: sh };
    // La «U» no cierra arriba: su punto más alto es el extremo del anillo exterior.
    minY = Math.min(sy, -outerY * Math.sin(rad(58))) - 10;
  }
  // Simétrico en horizontal para que el plano quede centrado.
  const halfW = Math.max(-minX, maxX);
  let halfTop = stadium ? Math.max(-minY, maxY) : -minY;
  const showCompass = stadium && layout.zoneLabels.some((z) => sideFor(z.zone.name));
  if (showCompass) {
    // La brújula va en la esquina de arriba a la derecha; si pisa un rótulo, se deja más aire arriba.
    const bx0 = halfW - 38 * k;
    const clash = () => boxes.some((b) => b.x1 > bx0 && b.y0 < -halfTop + 50 * k);
    for (let i = 0; i < 4 && clash(); i++) halfTop += 24 * k;
  }
  const halfBottom = stadium ? halfTop : maxY;
  const W = 2 * halfW;
  const H = halfTop + halfBottom;
  const cx = halfW;
  const cy = halfTop;
  if (showCompass) compass = { x: W - 20 * k - 6, y: 22 * k + 6 };
  return {
    k,
    W,
    H,
    cx,
    cy,
    ring,
    step,
    r0x,
    r0y,
    fieldX,
    fieldY,
    fs,
    lineH,
    labels: labels.map((l) => ({ ...l, x: l.x + cx, y: l.y + cy })),
    compass,
    stage: stage ? { ...stage, x: stage.x + cx, y: stage.y + cy } : null,
  };
}

/** Busca k para que, al ancho real, los rótulos y marcadores se lean. */
function fitGeometry(layout: Layout, width: number, maxH: number, compact: boolean): Geo {
  const thick = compact || width < 520;
  const solve = (wrap: boolean): Geo => {
    let k = 1;
    let g = geometry(layout, k, thick, wrap);
    for (let i = 0; i < 40; i++) {
      const scale = Math.min(width / g.W, maxH / g.H);
      const next = Math.min(8, Math.max(1, MIN_SCREEN / scale));
      if (Math.abs(next - k) < 0.002) break;
      k = next;
      g = geometry(layout, k, thick, wrap);
    }
    return { ...g, scale: Math.min(width / g.W, maxH / g.H) };
  };
  const plain = solve(false);
  if (layout.mode !== 'stadium' || !layout.zoneLabels.some((z) => z.zone.name.includes(' '))) return plain;
  // En pantallas estrechas «Lateral Oeste» en dos líneas deja el plano bastante más grande.
  const wrapped = solve(true);
  return wrapped.scale > plain.scale * 1.08 ? wrapped : plain;
}

function tierFill(ring: number, rings: number): string {
  // Rampa ordinal azul del sistema (--meter-*): del nivel más cercano al campo
  // (más intenso) al más alto. Con un mínimo para que los anillos exteriores
  // sigan distinguiéndose del fondo, también en modo oscuro.
  const raw = rings <= 1 ? 80 : 92 - (ring / (rings - 1)) * 72;
  const strength = Math.round(Math.min(92, Math.max(20, raw)));
  return `color-mix(in oklab, var(--meter-fill) ${strength}%, var(--meter-track))`;
}

const HL_FILL = 'var(--warning)';
const HALO = (fs: number) => ({ stroke: 'var(--surface)', strokeWidth: fs * 0.15, strokeOpacity: 0.75, strokeLinejoin: 'round' as const, paintOrder: 'stroke' as const });
/** Texto sobre el amarillo de «tu zona»: siempre oscuro (también en modo oscuro). */
const HL_INK = '#0b0b0b';
const ACCESSIBLE_FILL = 'color-mix(in srgb, var(--good) 45%, var(--surface))';

interface Marker {
  ranks: number[];
  x: number;
  y: number;
}

export function VenueMap({
  artifact,
  highlight,
  targets = [],
  compact = false,
  onPick,
}: {
  artifact: VenueArtifact;
  /** Zona o sección a resaltar (p. ej. el objetivo de una tarea). */
  highlight?: string | null;
  /** Objetivos de la operación en orden: se numeran en el plano. */
  targets?: string[];
  compact?: boolean;
  /** Si se indica, tocar una sección la elige (p. ej. para añadirla como objetivo). */
  onPick?: (sectionName: string) => void;
}) {
  const layout = useMemo(() => buildLayout(artifact), [artifact]);
  const uid = `vm${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [selected, setSelected] = useState<Spot | null>(null);
  const [hover, setHover] = useState<Spot | null>(null);

  // Ancho real del plano en pantalla (800 hasta que se mide).
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(800);
  useLayoutEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.round(el.getBoundingClientRect().width);
      if (w > 0) setWidth((prev) => (Math.abs(prev - w) >= 1 ? w : prev));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const maxH = compact ? 300 : 620;
  const g = useMemo(() => fitGeometry(layout, width, maxH, compact), [layout, width, maxH, compact]);
  const { k, W, H, cx, cy } = g;
  const stadium = layout.mode === 'stadium';
  const radii = (ring: number) => radiiOf(g, ring);
  const midRadii = (ring: number): [number, number] => {
    const [[a, b], [c, d]] = radii(ring);
    return [(a + c) / 2, (b + d) / 2];
  };

  // Rectángulos de la pista / zonas de pie.
  const centerRects = useMemo(() => {
    const n = layout.center.length;
    const pad = 10;
    const gap = 6;
    const w = (2 * g.fieldX - pad * 2 - (n - 1) * gap) / Math.max(1, n);
    const h = stadium ? g.fieldY * 1.2 : 2 * g.fieldY - pad * 2;
    const y = cy - h / 2;
    return layout.center.map((c, i) => ({ ...c, x: cx - g.fieldX + pad + i * (w + gap), y, w, h }));
  }, [layout, g, cx, cy, stadium]);

  const targetsKey = targets.join('\u0000');
  // targets llega como array nuevo en cada render: se memoriza por su contenido.
  const targetSets = useMemo(() => targets.map((t) => matchSections(t, layout)), [targetsKey, layout]);
  const hlSet = useMemo(() => (highlight ? matchSections(highlight, layout) : new Set<string>()), [highlight, layout]);
  // Solo se atenúa el resto si el resaltado coincide con algo del plano.
  const dim = hlSet.size > 0;
  const isHl = (s: Spot) => hlSet.has(s.section.id);
  const isTarget = (s: Spot) => targetSets.some((set) => set.has(s.section.id));

  // Marcadores numerados: uno por objetivo (y grada), sin pisarse.
  const markerR = MARKER_R * k;
  const { markers, unplaced } = useMemo(() => {
    const placed: Marker[] = [];
    const missing: Array<{ rank: number; label: string }> = [];
    const tooClose = (x: number, y: number, except?: Marker) => placed.find((m) => m !== except && Math.hypot(m.x - x, m.y - y) < 2.2 * markerR);
    const place = (rank: number, x: number, y: number, ring?: { rx: number; ry: number; angle: number; lo: number; hi: number }) => {
      const clash = tooClose(x, y);
      if (!clash) {
        placed.push({ ranks: [rank], x, y });
        return;
      }
      if (ring) {
        // Se desplaza a lo largo del anillo sin salir de su zona.
        for (const d of [8, -8, 16, -16, 24, -24, 32, -32]) {
          const a = ring.angle + d;
          if (a < ring.lo + 1 || a > ring.hi - 1) continue;
          const [nx, ny] = pt(cx, cy, ring.rx, ring.ry, a);
          if (!tooClose(nx, ny)) {
            placed.push({ ranks: [rank], x: nx, y: ny });
            return;
          }
        }
      }
      // Sin sitio: se apila en el mismo marcador («1·5»).
      if (!clash.ranks.includes(rank)) clash.ranks.push(rank);
    };
    targets.forEach((label, i) => {
      const rank = i + 1;
      const set = targetSets[i] ?? new Set<string>();
      const hitPieces = layout.pieces.filter((p) => set.has(p.section.id));
      const hitCenter = centerRects.filter((c) => set.has(c.section.id));
      if (hitPieces.length === 0 && hitCenter.length === 0) {
        missing.push({ rank, label });
        return;
      }
      if (hitCenter.length > 0) {
        const x0 = Math.min(...hitCenter.map((c) => c.x));
        const x1 = Math.max(...hitCenter.map((c) => c.x + c.w));
        const y0 = Math.min(...hitCenter.map((c) => c.y));
        const y1 = Math.max(...hitCenter.map((c) => c.y + c.h));
        place(rank, (x0 + x1) / 2, (y0 + y1) / 2);
      }
      // Un marcador por grada: en su anillo central (el exterior lleva el rótulo).
      const zones = [...new Set(hitPieces.map((p) => p.zone.id))];
      for (const zid of zones) {
        const zp = hitPieces.filter((p) => p.zone.id === zid);
        const rs = [...new Set(zp.map((p) => p.ring))].sort((a, b) => a - b);
        const ring = rs[Math.floor((rs.length - 1) / 2)] ?? 0;
        const inRing = zp.filter((p) => p.ring === ring).sort((a, b) => a.a1 - b.a1);
        // Tramos seguidos del anillo (una sección «Lateral» puede estar a los dos lados).
        const runs: Array<{ lo: number; hi: number }> = [];
        for (const p of inRing) {
          const last = runs[runs.length - 1];
          if (last && p.a1 - last.hi <= 4) last.hi = Math.max(last.hi, p.a2);
          else runs.push({ lo: p.a1, hi: p.a2 });
        }
        const [rx, ry] = midRadii(ring);
        for (const { lo, hi } of runs) {
          const angle = (lo + hi) / 2;
          const [x, y] = pt(cx, cy, rx, ry, angle);
          place(rank, x, y, { rx, ry, angle, lo, hi });
        }
      }
    });
    return { markers: placed, unplaced: missing };
  }, [targetsKey, targetSets, layout, centerRects, g]);

  const info = hover ?? selected;
  const pick = (s: Spot) => {
    if (onPick) {
      onPick(s.section.name);
      setSelected(s);
    } else setSelected(selected?.section.id === s.section.id ? null : s);
  };
  const handlers = (s: Spot) => ({
    onMouseEnter: () => setHover(s),
    onMouseLeave: () => setHover(null),
    onClick: () => pick(s),
  });
  // Zona de toque: un trazo invisible más ancho por debajo de las secciones rellena los huecos.
  const hitWidth = Math.max(RING_GAP + 4, 10 / Math.max(0.05, g.scale));
  const secFont = 12 * k;
  const infoPiece = info ? layout.pieces.find((p) => p.section.id === info.section.id) ?? null : null;

  return (
    <div className="stack" style={{ gap: 10, minWidth: 0 }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W.toFixed(1)} ${H.toFixed(1)}`}
        role="img"
        aria-label={`Plano de ${artifact.name}`}
        style={{ width: '100%', maxHeight: maxH, display: 'block', fontFamily: 'var(--font-sans)' }}
      >
        {/* Campo / pista / escenario */}
        {stadium ? (
          <g pointerEvents="none">
            <rect
              x={cx - g.fieldX}
              y={cy - g.fieldY}
              width={2 * g.fieldX}
              height={2 * g.fieldY}
              rx={6}
              fill="color-mix(in srgb, var(--good) 22%, var(--surface))"
              stroke="var(--line-strong)"
            />
            <line x1={cx - g.fieldX} y1={cy} x2={cx + g.fieldX} y2={cy} stroke="var(--line-strong)" />
            <circle cx={cx} cy={cy} r={g.fieldX * 0.28} fill="none" stroke="var(--line-strong)" />
            <rect x={cx - g.fieldX * 0.44} y={cy - g.fieldY} width={g.fieldX * 0.88} height={g.fieldY * 0.24} fill="none" stroke="var(--line-strong)" />
            <rect x={cx - g.fieldX * 0.44} y={cy + g.fieldY * 0.76} width={g.fieldX * 0.88} height={g.fieldY * 0.24} fill="none" stroke="var(--line-strong)" />
            {layout.center.length === 0 ? (
              <text x={cx} y={cy - g.fieldY * 0.4} textAnchor="middle" dominantBaseline="central" fontSize={Math.min(13 * k, g.fieldX * 0.42)} fill="var(--ink-2)">
                Campo
              </text>
            ) : null}
          </g>
        ) : (
          <g pointerEvents="none">
            {g.stage ? (
              <>
                <rect x={g.stage.x} y={g.stage.y} width={g.stage.w} height={g.stage.h} rx={4} fill="var(--ink)" />
                <text
                  x={cx}
                  y={g.stage.y + g.stage.h / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={Math.min(13 * k, g.stage.h * 0.62, (g.stage.w - 12) / (CHAR_W * 9))}
                  fontWeight={700}
                  fill="var(--surface)"
                >
                  ESCENARIO
                </text>
              </>
            ) : null}
            {layout.center.length > 0 ? (
              <rect x={cx - g.fieldX} y={cy - g.fieldY} width={2 * g.fieldX} height={2 * g.fieldY} rx={8} fill="var(--surface-2)" stroke="var(--line-strong)" />
            ) : null}
          </g>
        )}

        {/* Zonas de toque (por debajo de todo lo visible) */}
        <g aria-hidden>
          {layout.pieces.map((p) => {
            const [r0, r1] = radii(p.ring);
            return (
              <path
                key={`hit-${p.pid}`}
                d={sectorPath(cx, cy, r0, r1, p.a1, p.a2)}
                fill="transparent"
                stroke="transparent"
                strokeWidth={hitWidth}
                strokeLinejoin="round"
                pointerEvents="all"
                style={{ cursor: 'pointer' }}
                {...handlers(p)}
              />
            );
          })}
        </g>

        {/* Pista y zonas de pie */}
        {centerRects.map((c) => {
          const on = isHl(c);
          const t = isTarget(c);
          const isSel = selected?.section.id === c.section.id || hover?.section.id === c.section.id;
          // El nombre completo («Pista A») si cabe; si no, el corto («A»).
          const fitFont = (t: string) => Math.min(12 * k, (c.w - 8) / Math.max(1, CHAR_W * t.length));
          const text = fitFont(c.section.name) >= 9 * k ? c.section.name : shortName(c.section.name, c.zone.name);
          const fsz = fitFont(text);
          return (
            <g key={c.section.id} style={{ cursor: 'pointer' }} {...handlers(c)}>
              <rect
                x={c.x}
                y={c.y}
                width={c.w}
                height={c.h}
                rx={6}
                fill={on ? HL_FILL : 'color-mix(in srgb, var(--data-1) 55%, var(--surface))'}
                opacity={c.section.closed ? 0.3 : dim && !on ? 0.45 : 1}
                stroke={isSel || t ? 'var(--ink)' : 'none'}
                strokeWidth={isSel ? 2.5 : t ? 2 : 0}
              >
                <title>{`${spotLabel(c)} (de pie)${c.section.closed ? ' (cerrada en este evento)' : ''}`}</title>
              </rect>
              <text
                x={c.x + c.w / 2}
                y={c.y + c.h / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={fsz}
                fontWeight={600}
                fill={on ? HL_INK : 'var(--ink)'}
                pointerEvents="none"
                opacity={dim && !on ? 0.6 : 1}
                {...(on ? {} : HALO(fsz))}
              >
                {text}
              </text>
            </g>
          );
        })}

        {/* Gradas, anillos y secciones */}
        {layout.pieces.map((p) => {
          const [r0, r1] = radii(p.ring);
          const on = isHl(p);
          const t = isTarget(p);
          const isSel = selected?.section.id === p.section.id || hover?.section.id === p.section.id;
          const accessible = p.section.attributes.accessible === true;
          return (
            <path
              key={p.pid}
              d={sectorPath(cx, cy, r0, r1, p.a1, p.a2)}
              fill={on ? HL_FILL : accessible ? ACCESSIBLE_FILL : tierFill(p.ring, layout.rings)}
              opacity={p.section.closed ? 0.25 : dim && !on ? 0.4 : 1}
              stroke={isSel || t ? 'var(--ink)' : 'var(--surface)'}
              strokeWidth={isSel ? 2.5 : t ? 1.6 : 1}
              style={{ cursor: 'pointer' }}
              {...handlers(p)}
            >
              <title>{`${spotLabel(p)}${p.section.closed ? ' (cerrada en este evento)' : ''}`}</title>
            </path>
          );
        })}

        {/* Nombres cortos de sección (101, PMR 1, Palco 2…) cuando caben: en horizontal o curvados a lo largo del anillo */}
        {layout.pieces.map((p) => {
          const text = shortName(p.section.name, p.zone.name);
          if (!(layout.mode === 'arena' || text.length <= 12)) return null;
          const [r0, r1] = radii(p.ring);
          const place = sectionLabelPlacement(text, secFont, cx, cy, r0, r1, p.a1, p.a2);
          if (!place) return null;
          const on = isHl(p);
          const common = {
            fontSize: secFont,
            fontWeight: 600,
            fill: on ? HL_INK : 'var(--ink)',
            opacity: dim && !on ? 0.6 : 1,
            pointerEvents: 'none' as const,
            // Halo del color del fondo: se lee sobre cualquier tono del anillo.
            ...(on ? {} : HALO(secFont)),
          };
          if (place.kind === 'flat') {
            return (
              <text key={`l-${p.pid}`} x={place.x} y={place.y} textAnchor="middle" dominantBaseline="central" {...common}>
                {text}
              </text>
            );
          }
          const id = `${uid}-arc-${p.pid.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
          return (
            <g key={`l-${p.pid}`}>
              <path id={id} d={place.d} fill="none" stroke="none" />
              <text textAnchor="middle" dy="0.35em" {...common}>
                <textPath href={`#${id}`} startOffset="50%">
                  {text}
                </textPath>
              </text>
            </g>
          );
        })}

        {/* Nombres de las gradas / zonas */}
        {g.labels.map((l) => (
          <text
            key={l.zone.id}
            x={l.x}
            y={l.y}
            textAnchor={l.anchor}
            dominantBaseline="central"
            fontSize={g.fs}
            fontWeight={700}
            fill="var(--ink)"
            pointerEvents="none"
            style={{ letterSpacing: '0.02em' }}
          >
            {l.lines.map((line, i) => (
              <tspan key={i} x={l.x} dy={i === 0 ? 0 : g.lineH}>
                {line}
              </tspan>
            ))}
          </text>
        ))}

        {/* Orden de compra: el 1 queda por encima */}
        {[...markers].reverse().map((m) => {
          const text = m.ranks.join('·');
          const fsz = 13 * k;
          const w = Math.max(2 * markerR, CHAR_W * fsz * text.length + 12 * k);
          return (
            <g key={`m-${text}-${m.x.toFixed(0)}-${m.y.toFixed(0)}`} pointerEvents="none">
              <rect x={m.x - w / 2} y={m.y - markerR} width={w} height={2 * markerR} rx={markerR} fill="var(--ink)" stroke="var(--surface)" strokeWidth={Math.max(2, 1.5 * k)} />
              <text x={m.x} y={m.y} textAnchor="middle" dominantBaseline="central" fontSize={fsz} fontWeight={800} fill="var(--surface)">
                {text}
              </text>
            </g>
          );
        })}

        {g.compass ? (
          <g transform={`translate(${g.compass.x.toFixed(1)}, ${g.compass.y.toFixed(1)}) scale(${k.toFixed(3)})`} aria-hidden pointerEvents="none">
            <path d="M0 -18 L7 4 L0 0 L-7 4 Z" fill="var(--ink)" />
            <text y={20} textAnchor="middle" fontSize={12} fontWeight={700} fill="var(--ink)">
              N
            </text>
          </g>
        ) : null}
      </svg>

      {compact ? (
        <div className="small ink2" style={{ minHeight: '1.5em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {info ? (
            <>
              <b>{spotLabel(info)}</b>
              {info.section.closed ? ' · cerrada en este evento' : ''}
            </>
          ) : onPick ? (
            'Toca una zona para añadirla.'
          ) : (
            'Toca una zona para ver su nombre.'
          )}
        </div>
      ) : null}

      {/* Leyenda */}
      <div className="row small" style={{ gap: 14, flexWrap: 'wrap' }}>
        {layout.legend.length > 0 ? (
          <span className="muted">{stadium ? 'Niveles, del campo hacia fuera:' : 'Zonas, de dentro a fuera:'}</span>
        ) : null}
        {layout.legend.slice(0, 10).map((e) => (
          <span key={e.name} className="row" style={{ gap: 6 }}>
            <span className="row" style={{ gap: 2, flex: '0 0 auto' }}>
              {e.rings.map((r) => (
                <span key={r} style={{ width: 14, height: 14, borderRadius: 3, background: tierFill(r, layout.rings), display: 'inline-block' }} />
              ))}
            </span>
            {e.name}
          </span>
        ))}
        {dim ? (
          <span className="row" style={{ gap: 6 }}>
            <span style={{ width: 14, height: 14, borderRadius: 3, background: HL_FILL, display: 'inline-block', flex: '0 0 auto' }} />
            Tu zona
          </span>
        ) : null}
        {targets.length > 0 ? (
          <span className="row" style={{ gap: 6 }}>
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: 9,
                background: 'var(--ink)',
                color: 'var(--surface)',
                fontSize: 11,
                fontWeight: 800,
                display: 'inline-grid',
                placeItems: 'center',
                flex: '0 0 auto',
              }}
            >
              1
            </span>
            Orden en que se intentará comprar
          </span>
        ) : null}
        {layout.pieces.some((p) => p.section.attributes.accessible) ? (
          <span className="row" style={{ gap: 6 }}>
            <span style={{ width: 14, height: 14, borderRadius: 3, background: ACCESSIBLE_FILL, display: 'inline-block', flex: '0 0 auto' }} />
            Plazas accesibles
          </span>
        ) : null}
      </div>

      {unplaced.length > 0 ? (
        <div className="small muted">No se pueden situar en el plano: {unplaced.map((m) => `${m.rank}. ${m.label}`).join(' · ')}.</div>
      ) : null}

      {!compact ? (
        <div className="small ink2" style={{ minHeight: 40 }}>
          {info ? (
            <>
              <b>{spotLabel(info)}</b>
              {key(info.section.name) !== key(spotLabel(info)) ? ` · sección «${info.section.name}»` : ''}
              {stadium && infoPiece && infoPiece.zoneRings > 1 ? ` · anillo ${infoPiece.ring + 1} de ${infoPiece.zoneRings} desde el campo` : ''}
              {!infoPiece ? ' · de pie' : ''}
              {info.section.attributes.view !== undefined ? ` · visión ${info.section.attributes.view}/5` : ''}
              {info.section.attributes.covered ? ' · cubierta' : ''}
              {info.section.attributes.accessible ? ' · accesible' : ''}
              {info.section.closed ? ' · cerrada en este evento' : ''}
              {info.section.aliases.length > 0 ? (
                <>
                  <br />
                  En la web puede aparecer como: {info.section.aliases.slice(0, 4).join(' · ')}
                </>
              ) : null}
            </>
          ) : (
            'Toca o pasa el ratón por una zona para ver su nombre. Cada grada va del nivel más cercano al campo (dentro) al más alto (fuera). Plano orientativo: los sectores exactos están en el plano oficial de la venta.'
          )}
        </div>
      ) : null}
    </div>
  );
}
