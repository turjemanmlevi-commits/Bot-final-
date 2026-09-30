import type { Account, CatalogEvent, OperationConfig, OperationState, OperationSummary } from '@to/shared';

export const REAL_TEST_MAX_PRICE = 6000;
export interface BrowserRealTestInput {
  eventId: string;
  accountIds: string[];
  maxUnitPrice: number;
  requestId: string;
}
export interface BrowserRealTestBlocker { code: string; message: string; accountId?: string }
export interface BrowserRealTestPreflight {
  ok: boolean;
  blockers: BrowserRealTestBlocker[];
  plannedConfig: OperationConfig | null;
  bindings: Array<{ accountId: string; label: string; connected: boolean; supported: boolean; recipeId: string | null; detail: string | null }>;
  requestId?: string;
}
export interface BrowserRealTestExecution {
  ok: boolean;
  operationId?: string;
  state?: OperationState;
  message?: string;
  blockers?: BrowserRealTestBlocker[];
}

/** Reuse the exact accounts from the previous Paris FC operation, never names or arbitrary profiles. */
export function realTestDefaults(accounts: Account[], events: CatalogEvent[], operations: OperationSummary[]) {
  const paris = events.filter((e) => e.providerId === 'real-madrid' && /paris\s*fc/i.test(e.name));
  const previous = operations.filter((o) => !o.archived && o.providerId === 'real-madrid' && paris.some((e) => e.id === o.eventId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const eligible = new Set(accounts.filter((a) => !a.archived && a.providerId === 'real-madrid' && a.enabled && a.verification === 'VERIFIED').map((a) => a.id));
  return {
    eventId: previous?.eventId ?? paris[0]?.id ?? '',
    accountIds: previous?.accountIds.length === 2 && previous.accountIds.every((id) => eligible.has(id)) ? [...previous.accountIds] : [],
  };
}

/** A read from an earlier form selection must never enable a changed purchase. */
export function realTestCanExecute(input: BrowserRealTestInput, report: BrowserRealTestPreflight | null, checkedAt: number, now: number): boolean {
  const config = report?.plannedConfig;
  return Boolean(report?.ok && report.blockers.length === 0 && config && checkedAt > 0 && now - checkedAt <= 10_000 &&
    input.accountIds.length > 0 && new Set(input.accountIds).size === input.accountIds.length &&
    input.maxUnitPrice > 0 && input.maxUnitPrice <= REAL_TEST_MAX_PRICE &&
    report.bindings.length === input.accountIds.length && report.bindings.every((b) => b.connected && b.supported && input.accountIds.includes(b.accountId)) &&
    config.providerId === 'real-madrid' && config.eventId === input.eventId &&
    config.currency === 'EUR' && config.maxUnitPrice === input.maxUnitPrice && config.requestedQty === input.accountIds.length &&
    config.preferences.maxPerAccount === 1 && config.budget === input.maxUnitPrice * input.accountIds.length &&
    config.accountIds.length === input.accountIds.length && config.accountIds.every((id) => input.accountIds.includes(id)));
}
