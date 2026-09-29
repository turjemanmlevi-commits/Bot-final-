/**
 * Alta y edición de eventos y recintos (notas del vault). La usan el dashboard
 * (API) y el bot de Telegram: mismo código y mismas comprobaciones, así que un
 * evento creado desde el móvil es idéntico a uno creado desde el dashboard.
 */

import path from 'node:path';
import { EventNoteInputSchema, formatPlanPoint, parseVenueLayout, type EventNoteInput, type EventNoteResult, type VenueQuickInput, type VenueQuickResult } from '@to/shared';
import type { App, CompileResult } from '../app';
import { normalizeLabel, slugify } from '../util/normalize';
import { createEventNote, createVenueNotes, patchEventNote, updateEventNote, type EventWriteContext } from './writer';

export class AuthoringError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const noteBase = (file: string) => path.posix.basename(file, '.md');

export class VaultAuthoring {
  constructor(private readonly app: App) {}

  private vaultDir(): string {
    if (!this.app.vaultDir) throw new AuthoringError(409, 'NO_VAULT', 'No hay vault configurado (VAULT_DIR)');
    return this.app.vaultDir;
  }

  private eventCtx(input: EventNoteInput, actor: string): EventWriteContext {
    const store = this.app.runtime.store;
    const venue = store.vaultReport?.venues.find((v) => v.venueId === input.venueId);
    if (!venue) throw new AuthoringError(400, 'BAD_REQUEST', `El recinto ${input.venueId} no está en el vault`);
    const provider = store.providerAuthorizations.find((p) => p.providerId === input.providerId);
    if (!provider) throw new AuthoringError(400, 'BAD_REQUEST', `El proveedor ${input.providerId} no está en el vault (30 Proveedores)`);
    return { vaultDir: this.vaultDir(), timeZone: this.app.timeZone, actor, venueNote: noteBase(venue.sourceFile), providerNote: noteBase(provider.sourceFile) };
  }

  private issuesFor(result: CompileResult, match: (file: string) => boolean) {
    return [...result.compiled.report.errors, ...result.compiled.report.warnings].filter((i) => match(i.file));
  }

  private eventResult(file: string, created: boolean, result: CompileResult): EventNoteResult {
    return {
      file,
      created,
      event: result.compiled.events.find((e) => e.sourceFile === file) ?? null,
      issues: this.issuesFor(result, (f) => f === file),
      report: result.compiled.report,
    };
  }

  /** Crea la nota del evento y recompila. `input` ya validado (EventNoteInputSchema). */
  async createEvent(input: EventNoteInput, actor: string): Promise<EventNoteResult> {
    const wctx = this.eventCtx(input, actor);
    const events = this.app.runtime.store.events;
    const base = `evt-${slugify(input.name)}`.slice(0, 90);
    let id = base;
    for (let n = 2; events.has(id); n++) id = `${base}-${n}`;
    const file = await createEventNote(input, id, wctx);
    this.app.runtime.ctx.journal.audit('vault.event_created', { file, eventId: id }, { actor });
    return this.eventResult(file, true, await this.app.compileAndApply());
  }

  async updateEvent(eventId: string, input: EventNoteInput, actor: string): Promise<EventNoteResult> {
    const event = this.app.runtime.store.events.get(eventId);
    if (!event) throw new AuthoringError(404, 'NOT_FOUND', 'El evento no existe (¿se ha borrado la nota?)');
    const file = await updateEventNote(event.sourceFile, event.id, input, this.eventCtx(input, actor));
    this.app.runtime.ctx.journal.audit('vault.event_updated', { file, eventId: event.id }, { actor });
    return this.eventResult(file, false, await this.app.compileAndApply());
  }

  /** Dónde queréis sentaros (zonas o secciones, en orden): solo cambia esa propiedad de la nota. */
  async setPreferredTargets(eventId: string, targets: string[], actor: string): Promise<EventNoteResult> {
    const event = this.app.runtime.store.events.get(eventId);
    if (!event) throw new AuthoringError(404, 'NOT_FOUND', 'El evento no existe (¿se ha borrado la nota?)');
    const parsed = EventNoteInputSchema.shape.preferredTargets.safeParse(targets);
    if (!parsed.success) throw new AuthoringError(400, 'BAD_REQUEST', 'Zonas no válidas (como mucho 30)');
    await patchEventNote(this.vaultDir(), event.sourceFile, { preferredTargets: parsed.data ?? [] });
    this.app.runtime.ctx.journal.audit('vault.event_targets', { file: event.sourceFile, eventId, targets: parsed.data ?? [] }, { actor });
    return this.eventResult(event.sourceFile, false, await this.app.compileAndApply());
  }

  /** Plano oficial del evento (imagen) y dónde está cada zona en él. */
  async setPlan(eventId: string, image: string | null, points: Array<{ zone: string; x: number; y: number }>, actor: string): Promise<EventNoteResult> {
    const event = this.app.runtime.store.events.get(eventId);
    if (!event) throw new AuthoringError(404, 'NOT_FOUND', 'El evento no existe (¿se ha borrado la nota?)');
    const parsed = EventNoteInputSchema.shape.planPoints.safeParse(points);
    if (!parsed.success || (image !== null && !/^https:\/\/\S+$/i.test(image))) throw new AuthoringError(400, 'BAD_REQUEST', 'Plano no válido');
    await patchEventNote(this.vaultDir(), event.sourceFile, { planImage: image, planPoints: (parsed.data ?? []).map(formatPlanPoint) });
    this.app.runtime.ctx.journal.audit('vault.event_plan', { file: event.sourceFile, eventId, points: points.length }, { actor });
    return this.eventResult(event.sourceFile, false, await this.app.compileAndApply());
  }

  /** Recinto con ese nombre (sin mayúsculas ni acentos) si ya está en la sala. */
  venueNamed(name: string): string | null {
    const key = normalizeLabel(name);
    return this.app.runtime.store.vaultReport?.venues.find((v) => normalizeLabel(v.name) === key)?.venueId ?? null;
  }

  /** «Recinto rápido»: carpeta con su nota, una por zona y una por sección. */
  async createVenue(input: VenueQuickInput, actor: string): Promise<VenueQuickResult> {
    const vaultDir = this.vaultDir();
    const layout = parseVenueLayout(input.layout);
    if (layout.errors.length > 0) throw new AuthoringError(400, 'BAD_LAYOUT', layout.errors.join(' · '));
    const venues = this.app.runtime.store.vaultReport?.venues ?? [];
    if (this.venueNamed(input.name)) throw new AuthoringError(409, 'VAULT_CONFLICT', `Ya existe un recinto llamado «${input.name}»`);
    const base = slugify(input.name) || 'recinto';
    let venueId = base;
    for (let n = 2; venues.some((v) => v.venueId === venueId); n++) venueId = `${base}-${n}`;
    const { folder, files } = await createVenueNotes(input, layout.zones, venueId, { vaultDir, timeZone: this.app.timeZone, actor });
    this.app.runtime.ctx.journal.audit('vault.venue_created', { folder, venueId, files }, { actor });
    const result = await this.app.compileAndApply();
    return {
      folder,
      files,
      venueId: result.compiled.report.venues.some((v) => v.venueId === venueId) ? venueId : null,
      issues: this.issuesFor(result, (f) => f.startsWith(`${folder}/`)),
      report: result.compiled.report,
    };
  }
}
