/**
 * Registro de proveedores con guardarraíles de diseño (§11, §26).
 *
 * - Rechaza adapters que declaren capabilities prohibidas o que expongan
 *   métodos de pago, resolución de retos, salto de colas, etc.
 * - La capability solo se ejecuta de forma AUTOMÁTICA si el adapter la
 *   implementa Y una persona la ha autorizado en el vault (nota del proveedor).
 *   Si no, pasa a HUMAN (tarea humana) o DISABLED. Fail-closed.
 */

import {
  CAPABILITIES,
  PROHIBITED_CAPABILITIES,
  type CapabilityDescriptor,
  type CapabilityName,
  type ProviderAuthorization,
  type ProviderDescriptor,
} from '@to/shared';
import type { ProviderAdapter } from './types';

/** Capabilities que una persona puede ejecutar a mano si no hay automatización. */
export const HUMAN_CAPABLE: readonly CapabilityName[] = ['session.open', 'session.status', 'queue.status', 'cart.add', 'cart.read'];

/** Nombres de método que ningún adapter puede tener. */
export const FORBIDDEN_METHODS: readonly string[] = [
  'pay',
  'checkout',
  'checkoutPay',
  'submitPayment',
  'solveChallenge',
  'solveCaptcha',
  'bypassQueue',
  'skipQueue',
  'overrideLimit',
  'spoofIdentity',
];

export class ProhibitedCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProhibitedCapabilityError';
  }
}

export class ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();
  private authorizations = new Map<string, ProviderAuthorization>();

  register(adapter: ProviderAdapter): void {
    for (const cap of adapter.declared) {
      if ((PROHIBITED_CAPABILITIES as readonly string[]).includes(cap)) {
        throw new ProhibitedCapabilityError(`El adapter ${adapter.id} declara una capability prohibida: ${cap}`);
      }
      if (!(CAPABILITIES as readonly string[]).includes(cap)) {
        throw new Error(`El adapter ${adapter.id} declara una capability desconocida: ${cap}`);
      }
    }
    for (const m of FORBIDDEN_METHODS) {
      if (typeof (adapter as unknown as Record<string, unknown>)[m] === 'function') {
        throw new ProhibitedCapabilityError(`El adapter ${adapter.id} expone un método prohibido: ${m}()`);
      }
    }
    if (this.adapters.has(adapter.id)) throw new Error(`Adapter duplicado: ${adapter.id}`);
    this.adapters.set(adapter.id, adapter);
  }

  setAuthorizations(list: ProviderAuthorization[]): void {
    this.authorizations = new Map(list.map((a) => [a.providerId, a]));
  }

  authorization(providerId: string): ProviderAuthorization | null {
    return this.authorizations.get(providerId) ?? null;
  }

  get(providerId: string): ProviderAdapter | undefined {
    return this.adapters.get(providerId);
  }

  ids(): string[] {
    return [...this.adapters.keys()].sort();
  }

  capabilities(providerId: string): CapabilityDescriptor[] {
    const adapter = this.adapters.get(providerId);
    if (!adapter) return [];
    const auth = this.authorizations.get(providerId);
    return CAPABILITIES.map((name): CapabilityDescriptor => {
      const declared = adapter.declared.includes(name);
      const authorized = Boolean(auth?.authorized.includes(name));
      const humanCapable = HUMAN_CAPABLE.includes(name);
      if (adapter.mode === 'MANUAL_ASSIST') {
        return {
          name,
          declared,
          authorized: false,
          executor: humanCapable ? 'HUMAN' : 'DISABLED',
          notes: humanCapable ? 'La hace una persona (tarea humana).' : 'No aplica en asistencia manual.',
        };
      }
      if (declared && authorized) return { name, declared, authorized, executor: 'AUTOMATED', notes: 'Autorizada en el vault.' };
      const why = !declared ? 'El adapter no la implementa.' : auth ? 'No autorizada en el vault.' : 'Sin nota del proveedor en el vault (fail-closed).';
      return { name, declared, authorized, executor: humanCapable ? 'HUMAN' : 'DISABLED', notes: why };
    });
  }

  descriptor(providerId: string): ProviderDescriptor | null {
    const adapter = this.adapters.get(providerId);
    if (!adapter) return null;
    return {
      id: adapter.id,
      name: this.authorizations.get(providerId)?.name ?? adapter.name,
      mode: adapter.mode,
      adapterVersion: adapter.adapterVersion,
      capabilities: this.capabilities(providerId),
      confirmationPolicy: adapter.confirmationPolicy,
    };
  }

  descriptors(): ProviderDescriptor[] {
    return this.ids()
      .map((id) => this.descriptor(id))
      .filter((d): d is ProviderDescriptor => d !== null);
  }

  /** true si la capability se ejecuta automáticamente para este proveedor. */
  automated(providerId: string, capability: CapabilityName): boolean {
    return this.capabilities(providerId).some((c) => c.name === capability && c.executor === 'AUTOMATED');
  }
}
