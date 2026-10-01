/**
 * Prueba real con el navegador (desde la sala de control): el bot entra en la web de entradas
 * del Real Madrid con una cuenta de «Cuentas», mete las entradas en el carrito, abre la pantalla
 * de pago y avisa por Telegram con botones. Nunca paga.
 */
import { z } from 'zod';
import type { Id, IsoDateTime, Minor } from './domain';

export type BrowserTestStatus = 'IDLE' | 'RUNNING' | 'WAITING_HUMAN' | 'CART_SECURED' | 'OPENED' | 'CANCELLED' | 'EXPIRED' | 'FAILED';
export type BrowserTestLogLevel = 'info' | 'ok' | 'warn' | 'error' | 'human';

export interface BrowserTestLogEntry {
  at: IsoDateTime;
  level: BrowserTestLogLevel;
  message: string;
}

export interface BrowserTestOptionsView {
  quantity: number;
  zones: string[];
  maxUnitPrice: Minor | null;
  contiguous: boolean;
  fallbackFewer: boolean;
  eventUrl: string;
  /** Partido elegido («Real Madrid vs Paris FC · lun 10 nov 18:45 · Women's Champions League»). */
  matchTitle: string | null;
}

/** Partido del femenino con entradas a la venta (de realmadrid.com). */
export interface BrowserTestMatch {
  id: string;
  title: string;
  label: string;
  competition: string | null;
  dateTime: string;
  venue: string | null;
  ticketsUrl: string;
}

export interface BrowserTestCartView {
  eventTitle: string;
  items: Array<{ label: string; qty: number; unitPrice: Minor; row: string | null; seats: string[] }>;
  qty: number;
  total: Minor | null;
  expiresAt: IsoDateTime | null;
  url: string;
  /** 'checkout' = pantalla de pago abierta en la ventana del bot; 'cart' = se quedó en la selección. */
  stage: 'checkout' | 'cart';
  strategy: string;
  hasScreenshot: boolean;
}

export interface BrowserTestState {
  /** false si el servidor no puede abrir el navegador del bot (falta instalar Chromium de Playwright). */
  available: boolean;
  detail: string;
  id: string | null;
  status: BrowserTestStatus;
  startedAt: IsoDateTime | null;
  options: BrowserTestOptionsView | null;
  accountId: Id | null;
  accountLabel: string | null;
  /** true si la cuenta tiene email y contraseña guardados para que el bot inicie sesión solo. */
  accountHasCredentials: boolean;
  log: BrowserTestLogEntry[];
  cart: BrowserTestCartView | null;
  error: string | null;
  telegram: { sent: boolean; detail: string };
}

export const BrowserTestStartSchema = z
  .object({
    /** Cuenta de «Cuentas» con la que entrar (por defecto, la primera del Real Madrid activa). */
    accountId: z.string().trim().min(1).max(100).optional(),
    quantity: z.number().int().min(1).max(10).optional(),
    zones: z.array(z.string().trim().max(80)).max(10).optional(),
    maxUnitPriceEur: z.number().positive().max(10_000).nullable().optional(),
    contiguous: z.boolean().optional(),
    fallbackFewer: z.boolean().optional(),
    eventUrl: z.string().trim().max(500).optional(),
  })
  .strict();
export type BrowserTestStartInput = z.infer<typeof BrowserTestStartSchema>;

export const BrowserTestDecisionSchema = z.object({ decision: z.enum(['comprar', 'cancelar']) }).strict();
export type BrowserTestDecision = z.infer<typeof BrowserTestDecisionSchema>['decision'];

/** Email y contraseña de la web oficial de una cuenta: el bot los usa para iniciar sesión. Null = quitarlos. */
export const AccountCredentialsSchema = z
  .object({
    email: z.string().trim().email().max(200).nullable(),
    password: z.string().min(1).max(200).nullable(),
  })
  .strict();
export type AccountCredentialsInput = z.infer<typeof AccountCredentialsSchema>;

/** Requisitos de la prueba rápida (los pone el bot; solo hay que pulsar). */
export const BROWSER_TEST_QUICK = {
  quantity: 3,
  zones: [] as string[],
  maxUnitPriceEur: null as number | null,
  contiguous: true,
  fallbackFewer: true,
  eventUrl: '',
};
