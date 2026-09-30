/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import type { Account, ManagedSessionState, ManagedSessionStatus, ManagedTestPlan } from '@to/shared';
import type { App } from '../app';
import { BrowserBridgeError } from './bridge';

// Profiles are created only for this application. Never attach to or copy a personal profile.
export function managedProfilePath(root: string, accountId: string): string {
  if (!/^acc_[a-zA-Z0-9_-]{1,100}$/.test(accountId)) throw new BrowserBridgeError('Cuenta no válida', 'INVALID_REQUEST');
  const resolved = path.resolve(root, accountId);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) throw new BrowserBridgeError('Perfil no válido', 'INVALID_REQUEST');
  return resolved;
}

export const loginHome = (providerId: string): string | null =>
  providerId === 'real-madrid' ? 'https://www.realmadrid.com/es-ES/' :
    providerId === 'ticketmaster' ? 'https://www.ticketmaster.es/' : null;

export function sessionEvidence(input: { official: boolean; challengeVisible: boolean; loginForm: boolean; logoutControl: boolean }): ManagedSessionState {
  if (!input.official) return 'UNKNOWN';
  if (input.challengeVisible) return 'CAPTCHA';
  if (input.loginForm) return 'LOGIN_REQUIRED';
  return input.logoutControl ? 'AUTHENTICATED' : 'UNKNOWN';
}

export type ProfileLauncher = (dir: string) => Promise<BrowserContext>;

/** Keep a resumable official page, never an OAuth code, fragment or logout action. */
export function resumableUrl(raw: string, providerId: string): string | null {
  try {
    const u = new URL(raw);
    const roots = providerId === 'real-madrid' ? ['realmadrid.com'] : providerId === 'ticketmaster' ? ['ticketmaster.es', 'ticketmaster.com'] : [];
    if (u.protocol !== 'https:' || u.username || u.password || u.port || !roots.some((r) => u.hostname === r || u.hostname.endsWith(`.${r}`))) return null;
    if (/sign.?in|log.?in|log.?out|sign.?out|oauth|callback|authorize|reset|verify|payment|checkout/i.test(u.hostname + u.pathname)) return null;
    u.search = ''; u.hash = '';
    return u.href;
  } catch { return null; }
}

// A string keeps transpiler helpers (e.g. tsx's __name) out of the browser's scope.
export const SESSION_EVIDENCE_SCRIPT = `(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
  const controls = Array.from(document.querySelectorAll('a,button,[role=button]')).filter(visible).map((e) => (e.textContent || '').trim());
  return {
    challengeVisible: Array.from(document.querySelectorAll('iframe[title*="challenge" i],iframe[title*="captcha" i],iframe[src*="hcaptcha"],.g-recaptcha,[data-sitekey]')).some(visible) || /^(verifica que eres humano|verify you are human|no soy un robot)$/im.test(document.body.innerText),
    loginForm: Array.from(document.querySelectorAll('input[type=password],input[type=email],input[autocomplete=username]')).some(visible),
    logoutControl: controls.some((s) => /^(cerrar sesión|cerrar sesion|sign out|log out|logout)$/i.test(s)),
  };
})()`;
export const CHROME_PROFILE_OPTIONS = {
  channel: 'chrome', headless: false, chromiumSandbox: true, viewport: null,
  acceptDownloads: false, timeout: 20_000,
} as const;
const launchProfile: ProfileLauncher = async (dir) => {
  try {
    // Never open Edge's existing profile with Chrome or reuse a personal profile.
    return await chromium.launchPersistentContext(path.join(dir, 'chrome'), CHROME_PROFILE_OPTIONS);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/not found|doesn't exist|not installed|Executable doesn't exist/i.test(message)) {
      throw new Error('No se encontró Google Chrome instalado. Instala Chrome y vuelve a abrir el perfil. No se abrirá Edge como alternativa.');
    }
    throw new Error('No se pudo abrir el perfil de Chrome. Si su ventana sigue abierta, ciérrala y vuelve a intentarlo.');
  }
};

type OpenProfile = { context: BrowserContext; page: Page; status: ManagedSessionStatus; busy: boolean };
const livePlans = new Set<ManagedTestPlan['state']>(['OPENING', 'WAITING_LOGIN', 'WAITING_CAPTCHA']);

/** User-triggered profiles and explicit approval. No payment, CAPTCHA solver or guessed seat clicks. */
export class ManagedBrowserService {
  private readonly profiles = new Map<string, OpenProfile>();
  private readonly opening = new Map<string, Promise<ManagedSessionStatus>>();
  private readonly notices = new Map<string, string>();
  private readonly timer: ReturnType<typeof setInterval>;
  private stopping = false;

  constructor(private readonly app: App, private readonly profileRoot: string, private readonly launcher: ProfileLauncher = launchProfile) {
    // Never resume an attempt after a server restart without another explicit approval.
    for (const plan of app.runtime.store.managedTests.values()) if (livePlans.has(plan.state)) {
      this.save({ ...plan, state: 'STOPPED', detail: 'El servidor se reinició. Revisa la sesión y vuelve a aprobar; no se ha reintentado ninguna reserva.' });
    }
    this.timer = setInterval(() => {
      for (const id of this.profiles.keys()) void this.inspect(id).catch(() => undefined);
      for (const plan of this.plans()) if (plan.connectionId && livePlans.has(plan.state)) this.inspectConnectedTest(plan.id);
    }, 3000);
    this.timer.unref();
  }

  private account(id: string): Account {
    const a = this.app.runtime.store.accounts.get(id);
    if (!a || a.archived || !a.enabled || !loginHome(a.providerId)) throw new BrowserBridgeError('Selecciona una cuenta activa del Real Madrid o Ticketmaster', 'INVALID_REQUEST');
    return a;
  }

  status(): ManagedSessionStatus[] {
    return [...this.app.runtime.store.accounts.values()].filter((a) => !a.archived && loginHome(a.providerId)).map((a) => {
      const binding = this.app.browser.getBinding(a.id);
      if (binding) {
        try {
          const snapshot = this.app.browser.snapshot(a.id, binding.eventRef);
          return { accountId: a.id, connectedTab: true, state: snapshot.challenge === 'CAPTCHA' ? 'CAPTCHA' as const : snapshot.session === 'LOGGED_OUT' ? 'LOGIN_REQUIRED' as const : 'UNKNOWN' as const,
            detail: snapshot.detail ?? 'Pestaña de tu Chrome conectada. Esto no demuestra identidad ni reserva.', checkedAt: snapshot.observedAt,
            savedUrl: resumableUrl(binding.eventUrl, a.providerId) ?? undefined };
        } catch {
          return { accountId: a.id, connectedTab: true, state: 'ERROR' as const, detail: 'La pestaña vinculada no envía lecturas recientes. Abre tu Chrome; no se usará otro perfil.', checkedAt: null };
        }
      }
      const saved = this.app.runtime.store.managedProfiles.get(a.id);
      const valid = saved?.providerId === a.providerId ? saved : undefined;
      return { ...(this.profiles.get(a.id)?.status ?? { accountId: a.id, state: 'CLOSED' as const,
        detail: valid?.lastAuthenticatedAt ? 'Sesión guardada en el perfil; navegador cerrado. Se comprobará al abrirlo.' : 'Perfil cerrado. Las sesiones guardadas se comprobarán al abrirlo.', checkedAt: null }),
        savedUrl: valid?.savedUrl, lastAuthenticatedAt: valid?.lastAuthenticatedAt ?? null };
    });
  }

  async open(accountId: string): Promise<ManagedSessionStatus> {
    if (this.stopping) throw new BrowserBridgeError('El servidor está cerrando', 'BUSY');
    const a = this.account(accountId);
    const binding = this.app.browser.getBinding(accountId);
    if (binding) {
      this.app.browser.focus(accountId, binding.eventRef);
      return this.status().find((s) => s.accountId === accountId)!;
    }
    const prior = this.opening.get(accountId);
    if (prior) return prior;
    const existing = this.profiles.get(accountId);
    if (existing) {
      const page = existing.context.pages().filter((p) => !p.isClosed()).at(-1);
      if (page) {
        existing.page = page;
        await page.bringToFront();
        return this.inspect(accountId);
      }
      await existing.context.close();
    }
    const promise = this.launch(a).finally(() => this.opening.delete(accountId));
    this.opening.set(accountId, promise);
    return promise;
  }

  private async launch(a: Account): Promise<ManagedSessionStatus> {
    const context = await this.launcher(managedProfilePath(this.profileRoot, a.id));
    if (this.stopping) { await context.close(); throw new Error('El servidor está cerrando'); }
    const page = context.pages().find((p) => !p.isClosed()) ?? await context.newPage();
    const profile: OpenProfile = { context, page, busy: false, status: { accountId: a.id, state: 'OPENING', detail: 'Abriendo el navegador de esta cuenta…', checkedAt: null } };
    this.profiles.set(a.id, profile);
    context.on('close', () => {
      if (this.profiles.get(a.id) !== profile) return;
      this.profiles.delete(a.id);
      for (const p of this.plans()) if (!p.connectionId && p.accountId === a.id && livePlans.has(p.state)) this.save({ ...p, state: 'STOPPED', detail: 'Cerraste el navegador. La prueba no se reanuda sola.' });
    });
    const saved = this.app.runtime.store.managedProfiles.get(a.id);
    const resume = saved?.providerId === a.providerId ? resumableUrl(saved.savedUrl, a.providerId) : null;
    try { await page.goto(resume ?? loginHome(a.providerId)!, { waitUntil: 'domcontentloaded', timeout: 30_000 }); }
    catch { profile.status = { ...profile.status, state: 'ERROR', detail: 'No se pudo cargar la web oficial. Puedes revisarla en la ventana abierta.' }; }
    await page.bringToFront();
    return this.inspect(a.id);
  }

  async inspect(accountId: string): Promise<ManagedSessionStatus> {
    const p = this.profiles.get(accountId);
    if (!p) return { accountId, state: 'CLOSED', detail: 'Abre primero el navegador de esta cuenta.', checkedAt: null };
    if (p.busy) return p.status;
    p.busy = true;
    try {
      const record = this.app.runtime.store.accounts.get(accountId);
      if (!record || !record.enabled || record.archived) {
        for (const plan of this.plans()) if (plan.accountId === accountId && livePlans.has(plan.state)) this.stopTest(plan.id);
        p.status = { accountId, state: 'ERROR', detail: 'Cuenta desactivada o eliminada: no se continúa ninguna prueba.', checkedAt: new Date().toISOString() };
        return p.status;
      }
      const a = this.account(accountId);
      const pages = p.context.pages().filter((page) => !page.isClosed());
      // Follow a user-created login popup in this profile, never another account's context.
      const page = pages.at(-1);
      if (!page) { p.status = { ...p.status, state: 'CLOSED', detail: 'La ventana está cerrada.' }; return p.status; }
      p.page = page;
      const host = new URL(page.url()).hostname;
      const root = a.providerId === 'real-madrid' ? 'realmadrid.com' : 'ticketmaster.es';
      const official = host === root || host.endsWith(`.${root}`) || (a.providerId === 'ticketmaster' && (host === 'ticketmaster.com' || host.endsWith('.ticketmaster.com')));
      let state: ManagedSessionState = 'UNKNOWN';
      if (official) {
        // Read visible controls only. Never capture passwords, cookies, tokens or account identifiers.
        const evidence = await page.evaluate<{ challengeVisible: boolean; loginForm: boolean; logoutControl: boolean }>(SESSION_EVIDENCE_SCRIPT);
        state = sessionEvidence({ official, ...evidence });
      }
      const detail: Record<ManagedSessionState, string> = {
        CLOSED: 'Perfil cerrado.', OPENING: 'Abriendo perfil.', ERROR: 'No se pudo comprobar la sesión.',
        LOGIN_REQUIRED: 'Inicia sesión tú en esta ventana. No envíes contraseñas por Telegram.',
        CAPTCHA: 'Resuelve el CAPTCHA tú en esta ventana; el bot no lo pulsa.',
        AUTHENTICATED: 'Se ha observado un control de cerrar sesión en la web oficial. No acredita una reserva.',
        UNKNOWN: 'Perfil abierto. Todavía no se ve una prueba suficiente de sesión iniciada; abre tu área de cuenta.',
      };
      p.status = { accountId, state, detail: detail[state], checkedAt: new Date().toISOString() };
      const prior = this.app.runtime.store.managedProfiles.get(accountId);
      const sameProvider = prior?.providerId === a.providerId ? prior : undefined;
      const savedUrl = resumableUrl(page.url(), a.providerId) ?? sameProvider?.savedUrl ?? loginHome(a.providerId)!;
      if (!sameProvider || sameProvider.savedUrl !== savedUrl || sameProvider.lastObservedState !== state) {
        const saved = { accountId, providerId: a.providerId, savedUrl, lastObservedState: state,
          lastAuthenticatedAt: state === 'AUTHENTICATED' ? p.status.checkedAt : state === 'LOGIN_REQUIRED' ? null : sameProvider?.lastAuthenticatedAt ?? null };
        this.app.runtime.store.managedProfiles.set(accountId, saved);
        this.app.runtime.ctx.journal.persist('managedProfile', accountId, saved);
      }
      for (const plan of this.plans()) if (!plan.connectionId && plan.accountId === accountId && livePlans.has(plan.state)) this.advance(plan, state);
    } catch {
      p.status = { accountId, state: 'ERROR', detail: 'No se pudo leer esta ventana. Revisa el navegador y vuelve a comprobar.', checkedAt: new Date().toISOString() };
    } finally { p.busy = false; }
    return p.status;
  }

  plans(): ManagedTestPlan[] { return [...this.app.runtime.store.managedTests.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  private save(plan: ManagedTestPlan): ManagedTestPlan {
    const next = { ...plan, updatedAt: new Date().toISOString() };
    this.app.runtime.store.managedTests.set(next.id, next);
    this.app.runtime.ctx.journal.persist('managedTest', next.id, next);
    return next;
  }

  prepare(eventId: string, accountId: string): ManagedTestPlan {
    const account = this.account(accountId);
    const event = this.app.runtime.store.events.get(eventId);
    if (!event || event.providerId !== 'real-madrid' || account.providerId !== event.providerId || !event.url || !Number.isFinite(Date.parse(event.startsAt)) || Date.parse(event.startsAt) <= Date.now()) throw new BrowserBridgeError('Selecciona un evento futuro del Real Madrid y su cuenta', 'INVALID_REQUEST');
    const url = new URL(event.url);
    if (url.protocol !== 'https:' || url.username || url.password || !(url.hostname === 'realmadrid.com' || url.hostname.endsWith('.realmadrid.com'))) throw new BrowserBridgeError('El evento debe tener una web oficial HTTPS', 'INVALID_REQUEST');
    const existing = this.plans().find((p) => p.accountId === accountId && p.eventId === eventId && p.state !== 'STOPPED');
    if (existing) return existing;
    const now = new Date().toISOString();
    return this.save({ id: this.app.runtime.ctx.ids.next('test'), eventId, accountId, eventName: event.name,
      quantityMode: 'OFFICIAL_MAXIMUM', priceMode: 'NO_FILTER', state: 'AWAITING_APPROVAL', approvedAt: null,
      createdAt: now, updatedAt: now, detail: 'Preparada. No se abre ningún navegador ni se reservan entradas antes de aprobar.' });
  }

  async approve(id: string): Promise<ManagedTestPlan> {
    const plan = this.app.runtime.store.managedTests.get(id);
    if (!plan) throw new BrowserBridgeError('La prueba no existe', 'INVALID_REQUEST');
    this.account(plan.accountId);
    if (livePlans.has(plan.state)) return plan;
    if (plan.state === 'BLOCKED') throw new BrowserBridgeError('Falta la integración de selección y carrito: esta prueba no puede volver a ejecutarse todavía', 'INVALID_REQUEST');
    const { ctx, store } = this.app.runtime;
    if (!ctx.journal.healthy || ctx.safety.engagedFor({ providerId: 'real-madrid', accountId: plan.accountId })) throw new BrowserBridgeError('Hay una parada de seguridad o el registro no está sano', 'BUSY');
    if ([...store.operations.values()].some((o) => o.config.accountIds.includes(plan.accountId) && ['ARMED', 'FROZEN', 'RUNNING', 'PAUSED', 'RECOVERING', 'CART_SECURED'].includes(o.state))) throw new BrowserBridgeError('Esta cuenta tiene otra operación activa', 'BUSY');
    const starting = this.save({ ...plan, state: 'OPENING', approvedAt: new Date().toISOString(), detail: 'Aprobada por ti. Abriendo el perfil; todavía no hay ninguna reserva.' });
    ctx.journal.audit('managed_test.approved', { planId: id, accountId: plan.accountId, eventId: plan.eventId });
    try {
      await this.open(plan.accountId);
      const current = store.managedTests.get(id)!;
      if (livePlans.has(current.state)) this.advance(current, this.profiles.get(plan.accountId)?.status.state ?? 'UNKNOWN');
    } catch (error) {
      if (livePlans.has(store.managedTests.get(id)!.state)) this.save({ ...starting, state: 'STOPPED', detail: error instanceof Error ? error.message : 'No se pudo abrir el navegador.' });
    }
    return store.managedTests.get(id)!;
  }

  /** Dashboard approval is exclusively for the user's explicitly paired tab. */
  approveConnected(id: string): ManagedTestPlan {
    const plan = this.app.runtime.store.managedTests.get(id);
    if (!plan) throw new BrowserBridgeError('La prueba no existe', 'INVALID_REQUEST');
    this.account(plan.accountId);
    const { ctx, store } = this.app.runtime;
    if (livePlans.has(plan.state)) {
      if (!plan.connectionId) throw new BrowserBridgeError('Detén la prueba anterior antes de cambiar de navegador', 'BUSY');
      return plan;
    }
    const binding = this.app.browser.getBinding(plan.accountId);
    if (!binding || binding.eventId !== plan.eventId) throw new BrowserBridgeError('Conecta la pestaña de este evento en tu perfil habitual de Chrome. No se abrirá un perfil separado.', 'SESSION_INVALID');
    if (!ctx.journal.healthy || ctx.safety.engagedFor({ providerId: 'real-madrid', accountId: plan.accountId })) throw new BrowserBridgeError('Hay una parada de seguridad o el registro no está sano', 'BUSY');
    if ([...store.operations.values()].some((o) => o.config.accountIds.includes(plan.accountId) && ['ARMED', 'FROZEN', 'RUNNING', 'PAUSED', 'RECOVERING', 'CART_SECURED'].includes(o.state))) throw new BrowserBridgeError('Esta cuenta tiene otra operación activa', 'BUSY');
    this.app.browser.snapshot(plan.accountId, binding.eventRef);
    this.save({ ...plan, connectionId: binding.connectionId, state: 'OPENING', approvedAt: new Date().toISOString(), detail: 'Comprobando exclusivamente tu pestaña vinculada; no se ha reservado nada.' });
    ctx.journal.audit('connected_test.approved', { planId: id, accountId: plan.accountId, eventId: plan.eventId });
    this.app.browser.focus(plan.accountId, binding.eventRef);
    return this.inspectConnectedTest(id);
  }

  inspectConnectedTest(id: string): ManagedTestPlan {
    const plan = this.app.runtime.store.managedTests.get(id);
    if (!plan) throw new BrowserBridgeError('La prueba no existe', 'INVALID_REQUEST');
    if (!plan.connectionId || !livePlans.has(plan.state)) return plan;
    const blocked = (detail: string) => this.save({ ...plan, state: 'BLOCKED', detail });
    const account = this.app.runtime.store.accounts.get(plan.accountId);
    if (!account?.enabled || account.archived || this.app.runtime.ctx.safety.engagedFor({ providerId: 'real-madrid', accountId: plan.accountId })) return blocked('Cuenta desactivada o parada de seguridad. No se continúa.');
    const binding = this.app.browser.getBinding(plan.accountId);
    if (!binding || binding.connectionId !== plan.connectionId || binding.eventId !== plan.eventId) return blocked('La pestaña se desconectó o cambió de vínculo. Revisa la conexión y vuelve a aprobar; no se abre otro perfil.');
    let snapshot;
    try { snapshot = this.app.browser.snapshot(plan.accountId, binding.eventRef); }
    catch { return blocked('La pestaña dejó de enviar lecturas recientes. Revisa Chrome antes de volver a aprobar.'); }
    if (snapshot.session === 'LOGGED_OUT' || snapshot.challenge === 'CAPTCHA') {
      const captcha = snapshot.challenge === 'CAPTCHA';
      const state = captcha ? 'WAITING_CAPTCHA' : 'WAITING_LOGIN';
      const updated = plan.state === state ? plan : this.save({ ...plan, state, detail: captcha ? 'Resuelve tú el CAPTCHA en la pestaña vinculada de Chrome.' : 'Inicia sesión tú en la pestaña vinculada de Chrome.' });
      const key = `${plan.connectionId}:${state}`;
      if (this.notices.get(plan.id) !== key) {
        this.notices.set(plan.id, key);
        this.app.runtime.ctx.notifier?.notifyBrowserIntervention?.(plan.accountId, captcha ? 'CAPTCHA' : 'LOGIN');
      }
      return updated;
    }
    if (snapshot.session !== 'READY' || snapshot.queue !== 'PASSED') {
      return plan.state === 'OPENING' ? plan : this.save({ ...plan, state: 'OPENING', detail: 'Esperando a la cola o al bloqueo de la web oficial. No se intenta saltarlos.' });
    }
    return blocked('Tu pestaña está conectada, pero faltan la selección comprobada del plano, el máximo oficial y la lectura del carrito. No se ha reservado ninguna entrada.');
  }

  private advance(plan: ManagedTestPlan, state: ManagedSessionState): void {
    if (state === 'AUTHENTICATED') {
      // Fail closed: a persisted login does not implement the canvas seat selector.
      this.save({ ...plan, state: 'BLOCKED', detail: 'Sesión observada. Falta implementar y comprobar la selección de asientos, el máximo oficial y la lectura del carrito. No se han añadido entradas.' });
      return;
    }
    const next = state === 'CAPTCHA' ? 'WAITING_CAPTCHA' : 'WAITING_LOGIN';
    if (plan.state !== next) this.save({ ...plan, state: next, detail: next === 'WAITING_CAPTCHA' ? 'Esperando que resuelvas el CAPTCHA en el navegador del bot.' : 'Esperando una sesión comprobada en el navegador del bot.' });
    const key = `${plan.id}:${next}`;
    if (this.notices.get(plan.id) !== key) {
      this.notices.set(plan.id, key);
      this.app.runtime.ctx.notifier?.notifyBrowserIntervention?.(plan.accountId, next === 'WAITING_CAPTCHA' ? 'CAPTCHA' : 'LOGIN');
    }
  }

  stopTest(id: string): ManagedTestPlan {
    const plan = this.app.runtime.store.managedTests.get(id);
    if (!plan) throw new BrowserBridgeError('La prueba no existe', 'INVALID_REQUEST');
    this.notices.delete(id);
    return this.save({ ...plan, state: 'STOPPED', detail: 'Prueba detenida. El navegador sigue abierto; no se han liberado ni pagado entradas.' });
  }

  async close(): Promise<void> {
    this.stopping = true;
    clearInterval(this.timer);
    await Promise.allSettled([...this.opening.values()]);
    await Promise.allSettled([...this.profiles.values()].map((p) => p.context.close()));
  }
}
