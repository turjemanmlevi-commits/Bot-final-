import type { ChallengeType, Id, IsoDateTime, Minor, QueueState } from './domain';

/** Only these reviewed DOM recipes can execute. There is no generic click fallback. */
export interface BrowserRecipe {
  id: 'fixture-v1' | 'entradas-fastbooking-v1' | 'observe-only-v1';
  allowedOrigins: string[];
  cart?: {
    rootSelector: string;
    itemSelector: string;
    eventRefAttribute: string;
    offerRefAttribute: string;
    qtyAttribute: string;
    unitPriceAttribute: string;
    sectionAttribute: string;
    cartRefAttribute: string;
    expiresAtAttribute?: string;
  };
}

export interface BrowserOffer {
  offerRef: string;
  sectionLabel: string;
  row: string | null;
  seats: string[];
  qtyMin: number;
  qtyMax: number;
  unitPrice: Minor;
  currency: string;
  contiguous?: boolean | null;
  obstructed?: boolean;
  accessible?: boolean;
  standing?: boolean;
}

export interface BrowserCartItem {
  offerRef: string;
  sectionLabel: string;
  row: string | null;
  seats: string[];
  qty: number;
  unitPrice: Minor;
  idempotencyKey: string | null;
}

/** Actual cart rows, never the form selection or a successful button click. */
export interface BrowserCartEvidence {
  verified: true;
  cartRef: string;
  eventRef: string;
  accountId: Id;
  items: BrowserCartItem[];
  openUrl: string;
  expiresAt: IsoDateTime | null;
}

export interface BrowserSnapshot {
  observedAt: IsoDateTime;
  url: string;
  supported: boolean;
  session: 'READY' | 'CHALLENGE_REQUIRED' | 'LOGGED_OUT';
  queue: QueueState;
  challenge?: ChallengeType | null;
  detail?: string;
  offers: BrowserOffer[];
  cart: BrowserCartEvidence | null;
}

export interface BrowserPairInput {
  accountId: Id;
  eventId: Id;
  eventRef: string;
  eventUrl: string;
  recipe: BrowserRecipe;
}

export interface BrowserAuth {
  connectionId: string;
  token: string;
  sessionId: string;
  tabId: number;
}

export interface BrowserConnectInput {
  pairingCode: string;
  sessionId: string;
  tabId: number;
  url: string;
}

export interface BrowserConnection extends BrowserAuth, BrowserPairInput {}

export type BrowserCommand =
  | { id: string; type: 'FOCUS'; accountId: Id; eventRef: string }
  | {
      id: string;
      type: 'ADD_TO_CART';
      accountId: Id;
      eventRef: string;
      offerRef: string;
      qty: number;
      unitPrice: Minor;
      idempotencyKey: string;
    };

export interface BrowserCommandOutcome {
  status: 'ADDED' | 'REJECTED' | 'AMBIGUOUS' | 'CHALLENGE';
  detail?: string;
  /** A read of an empty cart BEFORE the click. Existing carts must be handled by the person. */
  beforeCart?: BrowserCartEvidence;
}

export interface BrowserReportInput extends BrowserAuth {
  snapshot: BrowserSnapshot;
  commandId?: string;
  outcome?: BrowserCommandOutcome;
}

export interface BrowserConnectionStatus {
  connectionId: string;
  accountId: Id;
  eventId: Id;
  eventRef: string;
  eventUrl: string;
  tabId: number;
  connectedAt: IsoDateTime;
  lastSeenAt: IsoDateTime | null;
  supported: boolean;
  session: BrowserSnapshot['session'] | 'UNKNOWN';
  detail: string | null;
  pendingCommands: number;
  uncertain: boolean;
}
