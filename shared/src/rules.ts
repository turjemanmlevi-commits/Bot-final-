/**
 * Reglas de la máquina de estados de una operación (§4), compartidas para que
 * el dashboard solo ofrezca los comandos que el servidor aceptará.
 */

import type { OperationCommand, OperationState } from './domain';

/** Estados desde los que se acepta cada comando. */
export const COMMAND_STATES: Record<OperationCommand, readonly OperationState[]> = {
  validate: ['DRAFT', 'VALIDATED'],
  arm: ['VALIDATED'],
  disarm: ['ARMED', 'FROZEN'],
  readiness: ['VALIDATED', 'ARMED', 'FROZEN', 'RUNNING', 'PAUSED', 'RECOVERING'],
  'start-now': ['ARMED', 'FROZEN'],
  pause: ['RUNNING', 'RECOVERING'],
  resume: ['PAUSED'],
  stop: ['FROZEN', 'RUNNING', 'PAUSED', 'RECOVERING'],
  cancel: ['DRAFT', 'VALIDATED', 'ARMED', 'FROZEN', 'RUNNING', 'PAUSED', 'RECOVERING'],
  'reduce-qty': ['ARMED', 'FROZEN', 'RUNNING', 'PAUSED', 'RECOVERING'],
  'lower-max-price': ['ARMED', 'FROZEN', 'RUNNING', 'PAUSED', 'RECOVERING'],
  close: ['CART_SECURED', 'ENDED'],
};

/** Transiciones de estado permitidas. Cualquier otra es un bug y se rechaza. */
export const STATE_TRANSITIONS: Record<OperationState, readonly OperationState[]> = {
  DRAFT: ['VALIDATED', 'CANCELLED'],
  VALIDATED: ['DRAFT', 'ARMED', 'CANCELLED'],
  ARMED: ['VALIDATED', 'FROZEN', 'RUNNING', 'ENDED', 'CANCELLED'],
  FROZEN: ['VALIDATED', 'RUNNING', 'ENDED', 'CANCELLED'],
  RUNNING: ['PAUSED', 'RECOVERING', 'CART_SECURED', 'ENDED', 'CANCELLED'],
  PAUSED: ['RUNNING', 'RECOVERING', 'CART_SECURED', 'ENDED', 'CANCELLED'],
  RECOVERING: ['RUNNING', 'PAUSED', 'CART_SECURED', 'ENDED', 'CANCELLED'],
  CART_SECURED: ['RUNNING', 'CLOSED'],
  ENDED: ['CLOSED'],
  CANCELLED: [],
  CLOSED: [],
};

/** Estados editables (la configuración se puede cambiar creando una versión nueva). */
export const EDITABLE_STATES: readonly OperationState[] = ['DRAFT', 'VALIDATED'];

/** Estados en los que la operación retiene sus cuentas (arrendamiento). */
export const LEASING_STATES: readonly OperationState[] = [
  'ARMED',
  'FROZEN',
  'RUNNING',
  'PAUSED',
  'RECOVERING',
  'CART_SECURED',
  'ENDED',
];

export function commandAllowed(command: OperationCommand, state: OperationState): boolean {
  return COMMAND_STATES[command].includes(state);
}

export function allowedCommands(state: OperationState): OperationCommand[] {
  return (Object.keys(COMMAND_STATES) as OperationCommand[]).filter((c) => COMMAND_STATES[c].includes(state));
}

export function transitionAllowed(from: OperationState, to: OperationState): boolean {
  return STATE_TRANSITIONS[from].includes(to);
}
