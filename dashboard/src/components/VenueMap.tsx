import { useMemo, useState } from 'react';
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
 */

type Side = 'top' | 'right' | 'bottom' | 'left';

export interface MapTarget {
  /** Etiqueta tal y como está en la operación (zona o sección). */
  label: string;
  /** 1, 2, 3… orden de preferencia. */
  rank: number;
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9º]+/g, ' ')
    .trim();

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

/** Nivel dentro de una grada: 0 = el más cercano al campo. null si el nombre no lo dice. */
function tierOf(s: VenueSection): number | null {
  const n = ` ${norm(`${s.name} ${s.level ?? ''}`)} `;
  if (/ (cuarto|4º|4o|4 anfiteatro) /.test(n)) return 4;
  if (/ (tercer|tercero|3er|3º|3 anfiteatro) /.test(n)) return 3;
  if (/ (segundo|2º|2o|2 anfiteatro) /.test(n)) return 2;
  if (/ (primer|primero|1er|1º|1 anfiteatro) /.test(n)) return 1;
  if (/ (nivel inferior|inferior|grada baja|tribuna baja|lower|nivel 1) /.test(n)) return 0;
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

interface Piece {
  section: VenueSection;
  zone: VenueZone;
  ring: number;
  a1: number;
  a2: number;
  tierName: string;
}

interface Layout {
  mode: 'stadium' | 'arena';
  pieces: Piece[];
  center: Array<{ section: VenueSection; zone: VenueZone }>;
  rings: number;
  zoneLabels: Array<{ zone: VenueZone; ring: number; angle: number }>;
  tierNames: string[];
}

const TIER_NAMES = ['Nivel inferior', 'Primer anfiteatro', 'Segundo anfiteatro', 'Tercer anfiteatro', 'Cuarto anfiteatro'];

function buildLayout(a: VenueArtifact): Layout {
  const byZone = new Map<string, VenueSection[]>();
  for (const s of a.sections) byZone.set(s.zoneId, [...(byZone.get(s.zoneId) ?? []), s]);
  const center: Layout['center'] = [];
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
  const tierNames = new Set<string>();
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
        const tiers = new Map<number, VenueSection[]>();
        let unknown = 0;
        for (const s of secs) {
          const t = tierOf(s);
          const key = t ?? 0;
          if (t === null) unknown++;
          tiers.set(key, [...(tiers.get(key) ?? []), s]);
        }
        const tierKeys = [...tiers.keys()].sort((x, y) => x - y);
        tierKeys.forEach((t, ringIndex) => {
          const group = (tiers.get(t) ?? []).sort((x, y) => natural(x.name, y.name));
          const w = (z1 - z0) / group.length;
          group.forEach((s, gi) => {
            const tierName = unknown === secs.length ? z.name : (s.level ?? TIER_NAMES[t] ?? `Nivel ${t + 1}`);
            tierNames.add(tierName);
            pieces.push({ section: s, zone: z, ring: ringIndex, a1: z0 + gi * w + (group.length > 1 ? 0.6 : 0), a2: z0 + (gi + 1) * w - (group.length > 1 ? 0.6 : 0), tierName });
          });
        });
        rings = Math.max(rings, tierKeys.length);
        zoneLabels.push({ zone: z, ring: tierKeys.length - 1, angle: (z0 + z1) / 2 });
      });
    }
    return { mode: 'stadium', pieces, center, rings, zoneLabels, tierNames: [...tierNames] };
  }

  // Pabellón / teatro: escenario arriba y anillos en «U».
  const U0 = -58;
  const U1 = 238;
  const ordered = ringZones.map((z, i) => ({ z, r: zoneRingRank(z, i) })).sort((x, y) => x.r - y.r);
  let ring = 0;
  for (const { z } of ordered) {
    const secs = [...(byZone.get(z.id) ?? [])];
    const withAngle = secs
      .sort((x, y) => natural(x.name, y.name))
      .map((s, i) => ({ s, want: preferredAngle(s.name) ?? U0 + ((i + 0.5) / secs.length) * (U1 - U0) }))
      .sort((x, y) => x.want - y.want);
    const w = (U1 - U0) / withAngle.length;
    withAngle.forEach(({ s }, i) => {
      pieces.push({ section: s, zone: z, ring, a1: U0 + i * w + 0.8, a2: U0 + (i + 1) * w - 0.8, tierName: z.name });
    });
    tierNames.add(z.name);
    zoneLabels.push({ zone: z, ring, angle: U0 - 6 });
    ring++;
  }
  rings = Math.max(1, ring);
  return { mode: 'arena', pieces, center, rings, zoneLabels, tierNames: [...tierNames] };
}

// ---------------------------------------------------------------------------
// Geometría
// ---------------------------------------------------------------------------

const RING = 34;
const RING_GAP = 3;
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

/** «Platea Central» en la zona «Platea» → «Central». */
function shortName(section: string, zone: string): string {
  const z = zone.trim();
  if (z && section.toLowerCase().startsWith(z.toLowerCase()) && section.length > z.length + 1) {
    return section.slice(z.length).replace(/^[\s·:-]+/, '');
  }
  return section;
}

function matches(label: string, p: { section: VenueSection; zone: VenueZone }): boolean {
  const l = norm(label);
  if (!l) return false;
  return norm(p.section.name) === l || norm(p.zone.name) === l || p.section.aliases.some((x) => norm(x) === l) || p.zone.aliases.some((x) => norm(x) === l);
}

function tierFill(ring: number, rings: number): string {
  // Del nivel más cercano (más intenso) al más alto (más claro).
  const strength = rings <= 1 ? 80 : Math.round(92 - (ring / (rings - 1)) * 58);
  return `color-mix(in srgb, var(--data-1) ${strength}%, var(--surface))`;
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
  const [selected, setSelected] = useState<Piece | null>(null);
  const [hover, setHover] = useState<Piece | null>(null);

  const stadium = layout.mode === 'stadium';
  const fw = stadium ? 200 : 300;
  const fh = stadium ? 300 : 170;
  const r0x = fw / 2 + 26;
  const r0y = fh / 2 + 26;
  const outerX = r0x + layout.rings * (RING + RING_GAP);
  const outerY = r0y + layout.rings * (RING + RING_GAP);
  const margin = 70;
  const cx = outerX + margin + 40;
  const cy = outerY + margin;
  const W = 2 * cx;
  const H = 2 * cy + (stadium ? 0 : 10);
  const radii = (ring: number): [[number, number], [number, number]] => [
    [r0x + ring * (RING + RING_GAP), r0y + ring * (RING + RING_GAP)],
    [r0x + ring * (RING + RING_GAP) + RING, r0y + ring * (RING + RING_GAP) + RING],
  ];

  const k = compact ? 1.7 : 1; // textos y marcadores más grandes cuando el plano se ve pequeño
  const hl = highlight ?? null;
  const targetOf = (p: { section: VenueSection; zone: VenueZone }) => targets.map((t, i) => ({ t, i })).find(({ t }) => matches(t, p));
  const isHl = (p: { section: VenueSection; zone: VenueZone }) => (hl ? matches(hl, p) : false);
  const dim = hl !== null;

  // Marcadores numerados: uno por objetivo, en el centro de lo que abarca.
  const markers = targets
    .map((label, i) => {
      const hitPieces = layout.pieces.filter((p) => matches(label, p));
      const hitCenter = layout.center.filter((c) => matches(label, c));
      if (hitPieces.length > 0) {
        const mid = hitPieces.reduce((acc, p) => acc + (p.a1 + p.a2) / 2, 0) / hitPieces.length;
        const ring = Math.max(...hitPieces.map((p) => p.ring));
        const [[a, b], [c, d]] = radii(ring);
        const [x, y] = pt(cx, cy, (a + c) / 2, (b + d) / 2, mid);
        return { label, rank: i + 1, x, y };
      }
      if (hitCenter.length > 0) return { label, rank: i + 1, x: cx, y: cy + (stadium ? 0 : 20) };
      return { label, rank: i + 1, x: null as number | null, y: null as number | null };
    });
  const unplaced = markers.filter((m) => m.x === null);
  const info = hover ?? selected;

  return (
    <div className="stack" style={{ gap: 10 }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Plano de ${artifact.name}`}
        style={{ width: '100%', maxHeight: compact ? 300 : 620, display: 'block', fontFamily: 'var(--font-sans)' }}
      >
        {/* Campo / pista / escenario */}
        {stadium ? (
          <g>
            <rect x={cx - fw / 2} y={cy - fh / 2} width={fw} height={fh} rx={8} fill="color-mix(in srgb, var(--good) 22%, var(--surface))" stroke="var(--line-strong)" />
            <line x1={cx - fw / 2} y1={cy} x2={cx + fw / 2} y2={cy} stroke="var(--line-strong)" />
            <circle cx={cx} cy={cy} r={26} fill="none" stroke="var(--line-strong)" />
            <rect x={cx - 44} y={cy - fh / 2} width={88} height={36} fill="none" stroke="var(--line-strong)" />
            <rect x={cx - 44} y={cy + fh / 2 - 36} width={88} height={36} fill="none" stroke="var(--line-strong)" />
            <text x={cx} y={cy - 38} textAnchor="middle" fontSize={13 * k} fill="var(--ink-2)">
              Campo
            </text>
          </g>
        ) : (
          <g>
            <rect x={cx - fw / 2} y={cy - fh / 2 - 34} width={fw} height={26} rx={4} fill="var(--ink)" />
            <text x={cx} y={cy - fh / 2 - 16} textAnchor="middle" fontSize={13} fontWeight={700} fill="var(--surface)">
              ESCENARIO
            </text>
            {layout.center.length > 0 ? <rect x={cx - fw / 2} y={cy - fh / 2} width={fw} height={fh} rx={8} fill="var(--surface-2)" stroke="var(--line-strong)" /> : null}
          </g>
        )}
        {layout.center.map((c, i) => {
          const n = layout.center.length;
          const pad = 10;
          const w = (fw - pad * 2 - (n - 1) * 6) / n;
          const x = cx - fw / 2 + pad + i * (w + 6);
          const y = cy - fh / 2 + (stadium ? 50 : 12);
          const h = fh - (stadium ? 100 : 24);
          const on = isHl(c);
          const t = targetOf(c);
          return (
            <g key={c.section.id}>
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                rx={6}
                fill={on ? 'var(--warning)' : 'color-mix(in srgb, var(--data-1) 55%, var(--surface))'}
                opacity={c.section.closed ? 0.3 : dim && !on ? 0.45 : 1}
                stroke={t ? 'var(--ink)' : 'none'}
                strokeWidth={t ? 2 : 0}
              >
                <title>{`${c.zone.name} · ${c.section.name} (de pie)`}</title>
              </rect>
              <text x={x + w / 2} y={y + h / 2 + 4} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--ink)">
                {c.section.name}
              </text>
            </g>
          );
        })}

        {/* Gradas, anillos y secciones */}
        {layout.pieces.map((p) => {
          const [r0, r1] = radii(p.ring);
          const on = isHl(p);
          const t = targetOf(p);
          const isSel = selected?.section.id === p.section.id || hover?.section.id === p.section.id;
          const accessible = p.section.attributes.accessible === true;
          return (
            <path
              key={p.section.id}
              d={sectorPath(cx, cy, r0, r1, p.a1, p.a2)}
              fill={on ? 'var(--warning)' : accessible ? 'color-mix(in srgb, var(--good) 45%, var(--surface))' : tierFill(p.ring, layout.rings)}
              opacity={p.section.closed ? 0.25 : dim && !on ? 0.4 : 1}
              stroke={isSel ? 'var(--ink)' : t ? 'var(--ink)' : 'var(--surface)'}
              strokeWidth={isSel ? 2.5 : t ? 1.6 : 1}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHover(p)}
              onMouseLeave={() => setHover(null)}
              onClick={() => {
                if (onPick) onPick(p.section.name);
                else setSelected(selected?.section.id === p.section.id ? null : p);
              }}
            >
              <title>{`${p.zone.name} · ${p.section.name}${p.section.closed ? ' (cerrada en este evento)' : ''}`}</title>
            </path>
          );
        })}

        {/* Nombres cortos de sección (101, PMR 1, Palco 2…) cuando caben */}
        {layout.pieces
          .map((p) => ({ p, text: shortName(p.section.name, p.zone.name) }))
          .filter(({ p, text }) => (layout.mode === 'arena' || text.length <= 8) && text.length * 6.6 * k + 8 < (p.a2 - p.a1) * (Math.PI / 180) * radii(p.ring)[0][0])
          .map(({ p, text }) => {
            const [[a, b], [c, d]] = radii(p.ring);
            const [x, y] = pt(cx, cy, (a + c) / 2, (b + d) / 2, (p.a1 + p.a2) / 2);
            return (
              <text key={`l-${p.section.id}`} x={x} y={y + 4} textAnchor="middle" fontSize={11 * k} fontWeight={600} fill="var(--ink)" pointerEvents="none">
                {text}
              </text>
            );
          })}

        {/* Nombres de las gradas / zonas */}
        {(layout.mode === 'stadium' ? layout.zoneLabels : []).map(({ zone, ring, angle }) => {
          const [, r1] = radii(ring);
          const [x, y] = pt(cx, cy, r1[0] + 16, r1[1] + 16, angle);
          const c = Math.cos(rad(angle));
          const anchor = Math.abs(c) < 0.3 ? 'middle' : c > 0 ? 'start' : 'end';
          return (
            <text key={zone.id} x={x} y={y} textAnchor={anchor} dominantBaseline="middle" fontSize={15 * k} fontWeight={700} fill="var(--ink)" style={{ letterSpacing: '0.02em' }}>
              {zone.name}
            </text>
          );
        })}

        {/* Orden de compra */}
        {markers
          .filter((m) => m.x !== null)
          .map((m) => (
            <g key={`${m.rank}-${m.label}`} pointerEvents="none">
              <circle cx={m.x ?? 0} cy={m.y ?? 0} r={13 * k} fill="var(--ink)" stroke="var(--surface)" strokeWidth={2} />
              <text x={m.x ?? 0} y={(m.y ?? 0) + 4.5 * k} textAnchor="middle" fontSize={13 * k} fontWeight={800} fill="var(--surface)">
                {m.rank}
              </text>
            </g>
          ))}

        {stadium && Object.values(layout.zoneLabels).some((z) => sideFor(z.zone.name)) ? (
          <g transform={`translate(${W - 46}, 40)`} aria-hidden>
            <path d="M0 -18 L7 4 L0 0 L-7 4 Z" fill="var(--ink)" />
            <text y={20} textAnchor="middle" fontSize={12} fontWeight={700} fill="var(--ink)">
              N
            </text>
          </g>
        ) : null}
      </svg>

      {/* Leyenda */}
      <div className="row small" style={{ gap: 14, flexWrap: 'wrap' }}>
        {layout.tierNames.length > 0
          ? layout.tierNames.slice(0, 8).map((name, i) => (
              <span key={name} className="row" style={{ gap: 6 }}>
                <span style={{ width: 14, height: 14, borderRadius: 3, background: tierFill(i, layout.rings), display: 'inline-block' }} />
                {i + 1}. {name}
              </span>
            ))
          : null}
        {hl ? (
          <span className="row" style={{ gap: 6 }}>
            <span style={{ width: 14, height: 14, borderRadius: 3, background: 'var(--warning)', display: 'inline-block' }} />
            Tu zona
          </span>
        ) : null}
        {targets.length > 0 ? (
          <span className="row" style={{ gap: 6 }}>
            <span style={{ width: 16, height: 16, borderRadius: 8, background: 'var(--ink)', color: 'var(--surface)', fontSize: 10, fontWeight: 800, display: 'inline-grid', placeItems: 'center' }}>1</span>
            Orden en que se intentará comprar
          </span>
        ) : null}
        {layout.pieces.some((p) => p.section.attributes.accessible) ? (
          <span className="row" style={{ gap: 6 }}>
            <span style={{ width: 14, height: 14, borderRadius: 3, background: 'color-mix(in srgb, var(--good) 45%, var(--surface))', display: 'inline-block' }} />
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
              <b>{info.section.name}</b> · grada {info.zone.name}
              {layout.mode === 'stadium' ? ` · anillo ${info.ring + 1} de ${layout.rings} (${info.tierName})` : ''}
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
