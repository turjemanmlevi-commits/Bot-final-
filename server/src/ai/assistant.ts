/**
 * Crear un evento con Claude de principio a fin (lo usa el bot de Telegram):
 * web de venta → eventos que tiene → datos del evento → evento creado en la
 * sala con su recinto (el que ya estaba o uno nuevo con las zonas que ha leído
 * Claude) y la vigilancia puesta → dónde queréis sentaros.
 *
 * Es el mismo camino que el dashboard: mismas reglas (el límite solo queda
 * verificado si Claude cita la web de venta oficial) y mismas notas del vault.
 * Nada compra ni entra en ninguna web: solo prepara la operación.
 */

import {
  aiEventDraft,
  aiLayoutText,
  EventNoteInputSchema,
  guessVenueLayout,
  type AiEventDetails,
  type AiEventsResult,
  type AiEventSummary,
  type CatalogEvent,
  type EventNoteInput,
  type ProviderAuthorization,
} from '@to/shared';
import type { App } from '../app';
import { localDateTime } from '../feeds/common';
import type { VaultAuthoring } from '../vault/authoring';
import { log } from '../util/log';
import { AiError, type ClaudeControl } from './claude';

/** Días hacia delante en los que se buscan eventos desde Telegram. */
export const ASSISTANT_DAYS = 60;
/** Vigilancia por defecto: desde 2 días antes de la venta. */
const WATCH_DAYS = 2;

export interface CreatedFromAi {
  event: CatalogEvent;
  file: string;
  venue: { id: string; name: string; created: boolean; zones: string[] };
  /** Imagen del plano oficial (tal cual se ve al comprar), si Claude la ha encontrado. */
  planImage: string | null;
  /** Claude situando las zonas sobre el plano (en segundo plano; null si no hay plano). */
  planReady: Promise<void> | null;
  limitsVerified: boolean;
  /** Avisos del vault sobre la nota (no impiden usarla). */
  warnings: string[];
}

export class EventAssistant {
  constructor(
    private readonly app: App,
    private readonly ai: ClaudeControl,
    private readonly authoring: VaultAuthoring,
  ) {}

  configured(): boolean {
    return this.ai.configured();
  }

  /** Webs de venta reales (las de ensayo no). */
  sellers(): ProviderAuthorization[] {
    return this.app.runtime.store.providerAuthorizations
      .filter((p) => p.mode !== 'SIMULATED')
      .sort((a, b) => Number(Boolean(b.url)) - Number(Boolean(a.url)) || a.name.localeCompare(b.name, 'es'));
  }

  find(providerId: string, fresh = false): Promise<AiEventsResult> {
    return this.ai.findEvents({ providerId, days: ASSISTANT_DAYS, fresh });
  }

  details(providerId: string, e: AiEventSummary): Promise<AiEventDetails> {
    return this.ai.eventDetails({ providerId, name: e.name, startsAtLocal: e.startsAtLocal, venue: e.venue, city: e.city, url: e.url });
  }

  /** Ahora en hora local de la sala («AAAA-MM-DDTHH:mm»). */
  nowLocal(): string {
    return localDateTime(this.app.runtime.ctx.now(), this.app.timeZone);
  }

  /** Zonas del recinto (para elegir dónde sentarse). */
  zones(venueId: string): string[] {
    const artifact = [...this.app.runtime.store.artifacts.values()].find((a) => a.venueId === venueId && a.eventId === null);
    return artifact ? artifact.zones.map((z) => z.name) : [];
  }

  /**
   * Crea el evento con los datos de Claude. `saleName` = la fase de venta cuya
   * hora es la apertura (undefined: la venta general próxima).
   */
  async create(providerId: string, d: AiEventDetails, saleName: string | null | undefined, actor: string): Promise<CreatedFromAi> {
    const nowLocal = this.nowLocal();
    const draft = aiEventDraft(d, { saleName, today: nowLocal.slice(0, 10), nowLocal });
    if (!draft.startsAt) throw new AiError('INCOMPLETE', 'Claude no ha encontrado la fecha del evento: créalo desde el dashboard (Eventos → Nuevo evento).');
    if (draft.name.trim().length < 3) throw new AiError('INCOMPLETE', 'Claude no ha encontrado el nombre del evento: créalo desde el dashboard.');
    const venue = await this.ensureVenue(d, actor);
    const n = draft.limit?.perAccount ?? null;
    const input: EventNoteInput = {
      name: draft.name,
      venueId: venue.id,
      providerId,
      url: draft.url,
      startsAt: draft.startsAt,
      onSaleAt: draft.onSaleAt,
      currency: draft.currency,
      limitPerAccount: n ?? 4,
      limitPerGroup: n ?? 4,
      limitPerOperation: Math.max(n ?? 0, 8),
      limitSemantics: draft.limit?.semantics ?? 'PER_HOLDER',
      limitsVerified: draft.limit?.verified ?? false,
      limitsSource: draft.limit?.source ?? draft.limitsSource,
      limitsNotes: draft.limit?.notes || undefined,
      notes: draft.notes,
      officialFeed: null,
      officialId: null,
      officialSale: null,
      watchDaysBefore: WATCH_DAYS,
      preferredTargets: [],
      planImage: d.planImageUrl,
      planPoints: [],
    };
    const parsed = EventNoteInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new AiError('INCOMPLETE', `No se puede crear así: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}. Créalo desde el dashboard.`);
    }
    const r = await this.authoring.createEvent(parsed.data, actor);
    const errors = r.issues.filter((i) => i.severity === 'ERROR');
    if (!r.event || errors.length > 0) {
      const why = errors.map((i) => i.message).join(' · ') || 'el vault tiene errores en otras notas';
      throw new AiError('INCOMPLETE', `La nota se ha creado (${r.file}) pero el evento no se ha cargado: ${why}. Revísalo en el dashboard.`);
    }
    const zones = this.zones(venue.id);
    const planImage = parsed.data.planImage ?? null;
    return {
      event: r.event,
      file: r.file,
      venue: { ...venue, zones },
      planImage,
      planReady: planImage && zones.length > 0 ? this.locateZones(r.event.id, planImage, zones, venue.name, actor) : null,
      limitsVerified: parsed.data.limitsVerified,
      warnings: r.issues.filter((i) => i.severity === 'WARNING').map((i) => i.message),
    };
  }

  /** El recinto de la sala que corresponde o uno nuevo con las zonas que ha leído Claude. */
  private async ensureVenue(d: AiEventDetails, actor: string): Promise<{ id: string; name: string; created: boolean }> {
    const venues = this.app.runtime.store.vaultReport?.venues ?? [];
    const known = d.vaultVenueId ? venues.find((v) => v.venueId === d.vaultVenueId) : undefined;
    if (known) return { id: known.venueId, name: known.name, created: false };
    const name = (d.venue ?? '').trim().slice(0, 100);
    if (name.length < 3) throw new AiError('INCOMPLETE', 'Claude no ha encontrado el recinto: créalo desde el dashboard (Eventos → Nuevo evento).');
    const existing = this.authoring.venueNamed(name);
    if (existing) return { id: existing, name, created: false };
    const layout = aiLayoutText(d.layout);
    const r = await this.authoring.createVenue(
      {
        name,
        city: d.city ?? undefined,
        source: (layout
          ? `Zonas leídas por Claude de ${d.sources[0] ?? d.url ?? 'la web de venta'}: revísalas con el plano oficial`
          : `Creado al elegir el evento${d.url ? ` (${d.url})` : ''}. Estructura orientativa: revísala con el plano oficial`
        ).slice(0, 300),
        layout: layout || guessVenueLayout(name),
      },
      actor,
    );
    if (!r.venueId) throw new AiError('INCOMPLETE', `El recinto «${name}» se ha creado pero tiene errores: revísalo en el dashboard (Recintos).`);
    return { id: r.venueId, name, created: true };
  }

  /** Claude sitúa las zonas sobre el plano oficial y se guarda en el evento (si falla, el plano se queda sin puntos). */
  private async locateZones(eventId: string, image: string, zones: string[], venue: string, actor: string): Promise<void> {
    try {
      const map = await this.ai.seatMap({ imageUrl: image, zones, venue });
      if (map.points.length > 0) await this.authoring.setPlan(eventId, image, map.points, actor);
    } catch (err) {
      log.warn('Claude no ha podido situar las zonas en el plano', { error: (err as Error).message });
    }
  }

  /** Guarda dónde queréis sentaros (zonas en orden). */
  async setSeats(eventId: string, targets: string[], actor: string): Promise<void> {
    await this.authoring.setPreferredTargets(eventId, targets, actor);
  }
}
