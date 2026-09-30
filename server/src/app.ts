/**
 * Construye el sistema completo (reloj, journal, proveedores, runtime, vault).
 * Lo usan el servidor real, los gates, el bench y los tests (con reloj virtual
 * y journal en memoria).
 */

import { ManualAssistProvider } from './providers/manual';
import { BrowserBridge } from './browser/bridge';
import { ProviderRegistry } from './providers/registry';
import { SimulatedProvider } from './providers/simulated';
import { DEFAULT_RUNTIME_CONFIG, type Notifier, type RuntimeConfig } from './runtime/context';
import { Runtime } from './runtime/runtime';
import type { JournalDriver } from './store/drivers';
import { Journal } from './store/journal';
import { SystemClock, type Clock } from './util/clock';
import { TimeIdGen, type IdGen } from './util/ids';
import { log } from './util/log';
import { compileVault, type CompiledVault } from './vault/compiler';
import { watchVault } from './vault/watch';

export const APP_VERSION = '0.4.0';

export interface AppOptions {
  driver: JournalDriver;
  vaultDir: string | null;
  timeZone: string;
  publicBaseUrl: string;
  clock?: Clock;
  ids?: IdGen;
  simSeed?: number;
  cfg?: Partial<RuntimeConfig>;
  notifier?: Notifier | null;
  watchVault?: boolean;
  journalFlushMs?: number;
}

export interface CompileResult {
  compiled: CompiledVault;
  applied: boolean;
  reason: string | null;
}

export interface App {
  browser: BrowserBridge;
  runtime: Runtime;
  sim: SimulatedProvider;
  registry: ProviderRegistry;
  /** Carpeta del vault (null si no hay). */
  vaultDir: string | null;
  timeZone: string;
  /**
   * Compila el vault y lo aplica. Si ya hay una compilación en marcha, espera a
   * que termine y lanza otra (así siempre incluye los últimos cambios); las
   * peticiones que llegan mientras tanto comparten esa segunda compilación.
   */
  compileAndApply(opts?: { force?: boolean }): Promise<CompileResult>;
  stop(): Promise<void>;
}

export async function createApp(opts: AppOptions): Promise<App> {
  const clock = opts.clock ?? new SystemClock();
  const ids = opts.ids ?? new TimeIdGen(clock);
  const journal = new Journal(opts.driver, clock, ids, { flushIntervalMs: opts.journalFlushMs ?? 20 });
  const rows = await journal.init();

  const registry = new ProviderRegistry();
  const sim = new SimulatedProvider(clock, opts.publicBaseUrl, opts.simSeed ?? 1);
  registry.register(sim);
  registry.register(new ManualAssistProvider());

  const runtime = new Runtime({
    clock,
    ids,
    journal,
    registry,
    sim,
    notifier: opts.notifier ?? null,
    cfg: {
      ...DEFAULT_RUNTIME_CONFIG,
      version: APP_VERSION,
      timeZone: opts.timeZone,
      publicBaseUrl: opts.publicBaseUrl,
      ...opts.cfg,
    },
  });
  runtime.hydrate(rows);
  const browser = new BrowserBridge({
    now: () => clock.now(),
    onSnapshot(accountId, snapshot) {
      const account = runtime.store.accounts.get(accountId);
      if (!account || registry.get(account.providerId)?.mode !== 'BROWSER_SESSION') return;
      const recipe = browser.recipe(accountId);
      const compatible = snapshot.supported && recipe?.id !== 'observe-only-v1' && (recipe?.id !== 'entradas-fastbooking-v1' || Boolean(recipe.cart));
      const state = snapshot.session === 'READY' && !compatible ? 'UNKNOWN' : snapshot.session;
      runtime.ctx.accounts.setSession(accountId, {
        state,
        challenge: snapshot.session === 'CHALLENGE_REQUIRED' ? { type: snapshot.challenge ?? 'CAPTCHA', since: snapshot.observedAt } : null,
        queue: { state: snapshot.queue, etaMs: null, position: null, updatedAt: snapshot.observedAt },
        lastCheckedAt: snapshot.observedAt,
        detail: !compatible && snapshot.session === 'READY' ? 'Pestaña conectada, pero selección automática no compatible con esta página' : snapshot.detail ?? null,
      });
      if (account.leasedBy && state === 'READY') runtime.ctx.runners.nudge(account.leasedBy);
    },
  });

  let running: Promise<CompileResult> | null = null;
  let queued: Promise<CompileResult> | null = null;
  const runCompile = (o: { force?: boolean }): Promise<CompileResult> => {
    const p = (async () => {
      const compiled = await compileVault({ vaultDir: opts.vaultDir as string, timeZone: opts.timeZone, now: () => clock.now() });
      const { applied, reason } = runtime.applyVault(compiled, o);
      return { compiled, applied, reason };
    })().finally(() => {
      if (running === p) running = null;
    });
    running = p;
    return p;
  };
  const compileAndApply = (o: { force?: boolean } = {}): Promise<CompileResult> => {
    if (!opts.vaultDir) return Promise.reject(new Error('No hay vault configurado'));
    if (!running) return runCompile(o);
    if (!queued) {
      const current = running;
      queued = current
        .catch(() => undefined)
        .then(() => {
          queued = null;
          return runCompile(o);
        });
    }
    return queued;
  };

  let unwatch: (() => void) | null = null;
  if (opts.vaultDir) {
    const first = await compileAndApply({ force: true });
    const r = first.compiled.report;
    log.info('Vault compilado', { venues: r.venues.length, events: r.events, errors: r.errors.length, warnings: r.warnings.length, ms: r.durationMs });
    for (const e of r.errors) log.warn(`Vault: ${e.file}: ${e.message}`);
    if (opts.watchVault) {
      unwatch = watchVault(opts.vaultDir, () => {
        void compileAndApply()
          .then(({ compiled, applied }) => {
            log.info(applied ? 'Vault recompilado' : 'Vault con errores: se mantiene la versión anterior', {
              errors: compiled.report.errors.length,
              warnings: compiled.report.warnings.length,
            });
          })
          // Una carpeta renombrada a medias no puede tumbar el servidor: se reintenta en el siguiente cambio.
          .catch((err: Error) => log.warn('No se pudo recompilar el vault', { error: err.message }));
      });
    }
  }

  runtime.start();

  return {
    browser,
    runtime,
    sim,
    registry,
    vaultDir: opts.vaultDir,
    timeZone: opts.timeZone,
    compileAndApply,
    async stop() {
      browser.close();
      unwatch?.();
      await runtime.stop();
    },
  };
}
