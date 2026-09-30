export type ManagedSessionState = 'CLOSED' | 'OPENING' | 'LOGIN_REQUIRED' | 'CAPTCHA' | 'AUTHENTICATED' | 'UNKNOWN' | 'ERROR';
export interface ManagedSessionStatus {
  connectedTab?: boolean;
  savedUrl?: string;
  lastAuthenticatedAt?: string | null;
  accountId: string;
  state: ManagedSessionState;
  detail: string;
  checkedAt: string | null;
}
export interface ManagedProfileRecord {
  accountId: string;
  providerId: string;
  savedUrl: string;
  lastAuthenticatedAt: string | null;
  lastObservedState: ManagedSessionState;
}
export interface ManagedTestPlan {
  /** Pin approval to the exact extension binding; never switch profiles silently. */
  connectionId?: string;
  id: string;
  eventId: string;
  accountId: string;
  eventName: string;
  quantityMode: 'OFFICIAL_MAXIMUM';
  priceMode: 'NO_FILTER';
  state: 'AWAITING_APPROVAL' | 'OPENING' | 'WAITING_LOGIN' | 'WAITING_CAPTCHA' | 'BLOCKED' | 'STOPPED';
  detail: string;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
}
