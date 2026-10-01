---
type: event
id: evt-gira-demo-2026-madrid
name: Gira Demo 2026 — Arena Madrid
venue: "[[Arena Demo Madrid]]"
provider: "[[Simulador]]"
providerEventRef: SIM-GD26-MAD
startsAt: 2026-11-21T21:00
onSaleAt: 2026-10-09T10:00
currency: EUR
limitPerAccount: 4
limitPerGroup: 4
limitPerOperation: 12
limitSemantics: PER_HOLDER
limitsVerified: true
limitsSource: "Condiciones de compra del evento (demo)"
limitsVerifiedAt: 2026-09-25
limitsVerifiedBy: demo
limitsNotes: "Máximo 4 entradas por titular, aunque tenga varias cuentas."
closedSections:
  - "[[Palco 2]]"
overrideNotes:
  - "Palco 2 reservado para producción en esta fecha."
tags:
  - evento
  - demo
---

# Gira Demo 2026 — Arena Madrid

Evento **de demostración** contra el [[Simulador]]. Sirve para ver una operación completa en el dashboard: armado, congelado, T0, cola, selección, carritos y pago humano.

## Límites

| Límite | Valor |
|---|---|
| Por cuenta | 4 |
| Por grupo (titular) | 4 |
| Por operación | 12 |
| Semántica | `PER_HOLDER` (por titular) |

Con semántica **por titular**, dos cuentas del mismo titular comparten el mismo cupo de 4. El sistema lo aplica al asignar y nunca lo sobrepasa (ver [[Asignación y límites]]).

> [!important] Fail-closed
> Si `limitsVerified` es `false` o la semántica es `UNKNOWN`, **no se puede armar** ninguna operación de este evento. Verifica siempre los límites en las condiciones oficiales y anota la fuente.

## Overrides del evento

- [[Palco 2]] cerrado para esta fecha (`closedSections`).
