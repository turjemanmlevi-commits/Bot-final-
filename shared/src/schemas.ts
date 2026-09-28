/**
 * Esquemas zod de ENTRADA de la API. Validan forma y tipos; la validación
 * semántica (límites, recinto, cuentas…) la hace el servidor y la devuelve
 * como ValidationIssue, no como error HTTP.
 */

import { z } from 'zod';
import { CHALLENGE_TYPES, KILL_SCOPES, OPERATION_COMMANDS } from './domain';

const isoDateTime = z.iso.datetime({ offset: true });

/** Rechaza cosas que parecen datos personales: el titular se identifica con un alias. */
const alias = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .refine((s) => !s.includes('@') && !/\d{7,}/.test(s.replace(/[\s.-]/g, '')), {
    message: 'Usa un alias, nunca emails, teléfonos ni documentos',
  });

export const OperationPreferencesSchema = z.object({
  targets: z.array(z.string().trim().min(1)).max(50),
  excludeSections: z.array(z.string().trim().min(1)).max(200),
  requireContiguous: z.boolean(),
  minGroupSize: z.number().int(),
  allowStanding: z.boolean(),
  allowObstructed: z.boolean(),
  allowAccessible: z.boolean(),
  maxAmbiguity: z.number(),
});

export const OperationConfigSchema = z.object({
  name: z.string().trim().min(1).max(120),
  eventId: z.string().min(1),
  providerId: z.string().min(1),
  t0: isoDateTime,
  runWindowMinutes: z.number().int(),
  freezeLeadSeconds: z.number().int(),
  requestedQty: z.number().int(),
  currency: z.string().trim().length(3).toUpperCase(),
  maxUnitPrice: z.number().int(),
  budget: z.number().int(),
  preferences: OperationPreferencesSchema,
  accountIds: z.array(z.string().min(1)).max(50),
  cartExpiryAlertsSeconds: z.array(z.number().int().positive()).max(10),
  simulation: z.object({ scenarioId: z.string().min(1), seed: z.number().int() }).optional(),
});

export const AccountInputSchema = z.object({
  label: z.string().trim().min(1).max(60),
  providerId: z.string().min(1),
  holderRef: alias,
  householdRef: alias.nullable().optional(),
  paymentRef: alias.nullable().optional(),
  verification: z.enum(['UNVERIFIED', 'VERIFIED', 'NEEDS_ATTENTION']).optional(),
  eligibility: z.array(z.string().trim().min(1)).max(50).optional(),
  enabled: z.boolean().optional(),
  telegramChatId: z
    .string()
    .trim()
    .regex(/^-?\d{1,20}$/, 'El chat ID de Telegram es un número (en los grupos empieza por -). Escribe /id al bot para verlo.')
    .nullable()
    .optional(),
});
export const AccountPatchSchema = AccountInputSchema.partial();

export const CommandRequestSchema = z.object({
  command: z.enum(OPERATION_COMMANDS),
  value: z.number().int().optional(),
  reason: z.string().max(500).optional(),
});

export const HumanTaskResponseInputSchema = z.object({
  result: z.enum(['IN_CART', 'FAILED', 'UNKNOWN', 'READY']),
  qty: z.number().int().min(1).max(100).optional(),
  unitPrice: z.number().int().positive().optional(),
  seats: z.array(z.string().trim().min(1)).max(100).optional(),
  expiresAt: isoDateTime.optional(),
  note: z.string().max(500).optional(),
});

export const KillSwitchInputSchema = z.object({
  scope: z.enum(KILL_SCOPES),
  targetId: z.string().min(1).nullable().optional(),
  engaged: z.boolean(),
  reason: z.string().max(300).optional(),
});

export const CartMarkSchema = z.object({
  state: z.enum(['PAID', 'RELEASED']),
  note: z.string().max(300).optional(),
});

export const SessionHumanSchema = z.object({
  /** El humano confirma que ha resuelto el reto o iniciado sesión en el proveedor. */
  challenge: z.enum(CHALLENGE_TYPES).optional(),
  note: z.string().max(300).optional(),
});

export const TelegramTestSchema = z.object({
  /** Chat al que enviar la prueba; por defecto el principal (TELEGRAM_CHAT_ID). */
  chatId: z.string().trim().regex(/^-?\d{1,20}$/).nullable().optional(),
});

export const DemoSeedSchema = z.object({
  startInSeconds: z.number().int().min(20).max(3600).optional(),
  scenarioId: z.string().min(1).optional(),
  seed: z.number().int().optional(),
});

export type OperationConfigInput = z.infer<typeof OperationConfigSchema>;
export type AccountInput = z.infer<typeof AccountInputSchema>;
export type AccountPatch = z.infer<typeof AccountPatchSchema>;
export type HumanTaskResponseInput = z.infer<typeof HumanTaskResponseInputSchema>;
export type KillSwitchInput = z.infer<typeof KillSwitchInputSchema>;
export type DemoSeedInput = z.infer<typeof DemoSeedSchema>;
