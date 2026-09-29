import type { Clock } from '../util/clock';
import type { IdGen } from '../util/ids';
import type { ProviderRegistry } from '../providers/registry';
import type { SimulatedProvider } from '../providers/simulated';
import type { Journal } from '../store/journal';
import type { AccountService } from './accounts';
import type { AlertService } from './alerts';
import type { CartService } from './carts';
import type { ClaimService } from './claims';
import type { ProviderGateway } from './gateway';
import type { Hub } from './hub';
import type { MetricsService } from './metrics';
import type { OperationService } from './operations';
import type { RunnerManager } from './runners';
import type { SafetyService } from './safety';
import type { Store } from './store';
import type { HumanTaskService } from './tasks';

export interface Notifier {
  readonly enabled: boolean;
  readonly connected: boolean;
  readonly detail: string;
  notifyAlert(alert: import('@to/shared').Alert): void;
  notifyTask(task: import('@to/shared').HumanTask): void;
  /** Estado detallado para el dashboard (bot, chat principal, chats vistos). */
  status?(): import('@to/shared').TelegramStatus;
  /** Envía un mensaje de prueba y espera la respuesta de Telegram. */
  sendTest?(chatId?: string | null): Promise<{ ok: boolean; message: string }>;
  /** Una tarea se ha cerrado (por cualquier vía): quitar sus botones donde se enviaron. */
  taskClosed?(task: import('@to/shared').HumanTask): void;
  /** Aviso a todo el grupo (chat principal + chats de esas cuentas), con enlace opcional. */
  announce?(text: string, accountIds: import('@to/shared').Id[], link?: string | null): void;
  /** Una cuenta acaba de quedar vinculada a su chat de Telegram. */
  accountLinked?(account: import('@to/shared').Account): void;
}

export interface RuntimeConfig {
  version: string;
  timeZone: string;
  /** Tick del scheduler (transiciones por tiempo, readiness, caducidades). */
  schedulerTickMs: number;
  /** Tick del runner en RUNNING (speed-first). */
  runnerTickMs: number;
  inventoryPollMs: number;
  queuePollMs: number;
  sessionPollMs: number;
  clockSyncMs: number;
  /** Plazo para responder una tarea de asistencia manual antes de pedir verificación. */
  humanTaskDeadlineMs: number;
  noProgressMs: number;
  circuitFailureThreshold: number;
  circuitCooldownMs: number;
  /** Publica en el dashboard la URL base para "abrir carrito" del simulador. */
  publicBaseUrl: string;
}

export const DEFAULT_RUNTIME_CONFIG: Omit<RuntimeConfig, 'version' | 'timeZone' | 'publicBaseUrl'> = {
  schedulerTickMs: 250,
  runnerTickMs: 50,
  inventoryPollMs: 250,
  queuePollMs: 700,
  sessionPollMs: 5000,
  clockSyncMs: 30_000,
  humanTaskDeadlineMs: 180_000,
  noProgressMs: 45_000,
  circuitFailureThreshold: 5,
  circuitCooldownMs: 5000,
};

/**
 * Contexto compartido por los servicios del runtime. Los servicios se
 * referencian entre sí a través de él (se enlazan al construir el Runtime).
 */
export class Ctx {
  alerts!: AlertService;
  safety!: SafetyService;
  metrics!: MetricsService;
  gateway!: ProviderGateway;
  accounts!: AccountService;
  ops!: OperationService;
  claims!: ClaimService;
  carts!: CartService;
  tasks!: HumanTaskService;
  runners!: RunnerManager;
  notifier: Notifier | null = null;
  /** Estado de Telegram cuando se configura desde el dashboard (con o sin bot conectado). */
  telegramStatus: (() => import('@to/shared').TelegramStatus) | null = null;
  readonly startedAt: number;

  constructor(
    readonly clock: Clock,
    readonly ids: IdGen,
    readonly journal: Journal,
    readonly registry: ProviderRegistry,
    readonly sim: SimulatedProvider | null,
    readonly store: Store,
    readonly hub: Hub,
    readonly cfg: RuntimeConfig,
  ) {
    this.startedAt = clock.now();
  }

  now(): number {
    return this.clock.now();
  }
}
