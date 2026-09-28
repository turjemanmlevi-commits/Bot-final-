import type { ProviderAdapter } from './types';

/**
 * Asistencia manual: el sistema no toca el proveedor. No declara ninguna
 * capability automática; todo se convierte en tareas humanas.
 *
 * Hay una instancia por cada proveedor del vault que no tiene adapter propio
 * (Ticketmaster, entradas.com, Real Madrid…): cada persona hace cada acción en
 * la web oficial con su propia cuenta y el sistema solo coordina.
 */
export class ManualAssistProvider implements ProviderAdapter {
  readonly mode = 'MANUAL_ASSIST' as const;
  readonly adapterVersion = 'manual-1.0.0';
  readonly confirmationPolicy = 'HUMAN' as const;
  readonly declared: readonly string[] = [];

  constructor(
    readonly id = 'manual',
    readonly name = 'Asistencia manual',
  ) {}
}
