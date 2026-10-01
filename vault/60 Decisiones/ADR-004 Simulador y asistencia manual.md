---
type: adr
status: aceptada
date: 2026-09-28
tags:
  - decision
---

# ADR-004 · Simulador y asistencia manual como modos incluidos

## Contexto

Automatizar contra una ticketera real sin su permiso puede vulnerar sus términos o la ley. A la vez, el sistema tiene que poder probarse de punta a punta y ser útil hoy para un grupo que compra junto.

## Decisión

- **Simulador**: proveedor interno realista (colas, retos, latencias, competencia, ambigüedad, rate limits, cambio de esquema) con escenarios y semilla.
- **Asistencia manual**: para ticketeras reales sin API autorizada. El sistema no se conecta: reparte tareas humanas por cuenta con la mejor sección pendiente y lleva límites, presupuesto y caducidades.
- **API autorizada**: el contrato existe (`ProviderAdapter`), pero cada capability solo se automatiza si está autorizada por escrito y anotada en la nota del proveedor.
- Capabilities prohibidas por diseño: pagar, resolver retos, saltar colas, sobrepasar límites, suplantar identidades.

## Consecuencias

- Se puede ensayar cualquier operación sin riesgo (y los gates lo hacen en cada ejecución).
- El valor real hoy está en la coordinación: quién compra qué, sin pasarse de límites ni de presupuesto, y sin perder carritos por caducidad.
