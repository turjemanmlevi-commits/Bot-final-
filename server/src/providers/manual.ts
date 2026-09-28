import type { ProviderAdapter } from './types';

/**
 * Asistencia manual: el sistema no toca el proveedor. No declara ninguna
 * capability automática; todo se convierte en tareas humanas.
 */
export class ManualAssistProvider implements ProviderAdapter {
  readonly id = 'manual';
  readonly name = 'Asistencia manual';
  readonly mode = 'MANUAL_ASSIST' as const;
  readonly adapterVersion = 'manual-1.0.0';
  readonly confirmationPolicy = 'HUMAN' as const;
  readonly declared: readonly string[] = [];
}
