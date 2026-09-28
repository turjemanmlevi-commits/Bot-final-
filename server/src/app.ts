/**
 * Construye el sistema completo (reloj, journal, proveedores, runtime, vault).
 * Lo usan el servidor real, los gates, el bench y los tests (con reloj virtual
 * y journal en memoria).
 */

import { ManualAssistProvider } from './providers/manual';
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

export interface App {
  runtime: Runtime;
  sim: SimulatedProvider;
  registry: ProviderRegistry;
  compileAndApply(opts?: { force?: boolean }): Promise<{ compiled: CompiledVault; applied: boolean; reason: string | null }>;
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

  let compiling: Promise<{ compiled: CompiledVault; applied: boolean; reason: string | null }> | null = null;
  const compileAndApply = async (o: { force?: boolean } = {}) => {
    if (!opts.vaultDir) throw new Error('No hay vault configurado');
    if (compiling) return compiling;
    compiling = (async () => {
      const compiled = await compileVault({ vaultDir: opts.vaultDir as string, timeZone: opts.timeZone, now: () => clock.now() });
      const { applied, reason } = runtime.applyVault(compiled, o);
      return { compiled, applied, reason };
    })().finally(() => {
      compiling = null;
    });
    return compiling;
  };

  let unwatch: (() => void) | null = null;
  if (opts.vaultDir) {
    const first = await compileAndApply({ force: true });
    const r = first.compiled.report;
    log.info('Vault compilado', { venues: r.venues.length, events: r.events, errors: r.errors.length, warnings: r.warnings.length, ms: r.durationMs });
    for (const e of r.errors) log.warn(`Vault: ${e.file}: ${e.message}`);
    if (opts.watchVault) {
      unwatch = watchVault(opts.vaultDir, () => {
        void compileAndApply().then(({ compiled, applied }) => {
          log.info(applied ? 'Vault recompilado' : 'Vault con errores: se mantiene la versión anterior', {
            errors: compiled.report.errors.length,
            warnings: compiled.report.warnings.length,
          });
        });
      });
    }
  }

  runtime.start();

  return {
    runtime,
    sim,
    registry,
    compileAndApply,
    async stop() {
      unwatch?.();
      await runtime.stop();
    },
  };
}
