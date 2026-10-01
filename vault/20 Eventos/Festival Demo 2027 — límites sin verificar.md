---
type: event
id: evt-festival-demo-2027
name: Festival Demo 2027 — límites sin verificar
venue: "[[Arena Demo Madrid]]"
provider: "[[Simulador]]"
providerEventRef: SIM-FD27-MAD
startsAt: 2027-06-12T18:00
onSaleAt: 2026-11-15T10:00
currency: EUR
limitPerAccount: 6
limitPerGroup: 6
limitPerOperation: 12
limitSemantics: UNKNOWN
limitsVerified: false
limitsSource: ""
limitsVerifiedAt: null
limitsVerifiedBy: null
limitsNotes: "Todavía no se han publicado las condiciones de compra."
closedSections: []
overrideNotes: []
tags:
  - evento
  - demo
---

# Festival Demo 2027 — límites sin verificar

Ejemplo del comportamiento **fail-closed**: mientras `limitsVerified` sea `false` y la semántica sea `UNKNOWN`, el dashboard deja crear y validar borradores, pero **no deja armar** la operación.

Para desbloquearlo: lee las condiciones oficiales, rellena `limitSemantics`, `limitsSource`, `limitsVerifiedAt` y pon `limitsVerified: true`.
