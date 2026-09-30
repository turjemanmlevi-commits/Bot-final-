---
type: "venue"
id: "signal-iduna-park"
name: "Signal Iduna Park"
city: "Dortmund"
club:
  - "Borussia Dortmund"
  - "Dortmund"
capacity: 81365
aliases:
  - "Westfalenstadion"
  - "BVB Stadion Dortmund"
source: "Estadios de los clubes habituales de la UEFA Champions League: aforo aproximado y nombres habituales de sus gradas (datos de referencia). Gradas y niveles: estructura orientativa con los nombres habituales del estadio; sectores, filas y asientos exactos: en el plano oficial de cada venta."
verifiedAt: "2026-09-29"
verifiedBy: "asistente"
confidence: 0.7
tags:
  - "recinto"
  - "real"
  - "estadio"
  - "champions"
---

# Signal Iduna Park

**Dortmund** · 81.365 localidades. Estadio del **Borussia Dortmund** (Alemania). Champions League: las entradas del equipo local las vende su club en su web oficial; si vais con el equipo visitante (p. ej. el Real Madrid o el Atlético), la afición visitante compra a través de su propio club.

## Cómo leer el plano

- **Westtribüne y Osttribüne**: gradas laterales, a lo largo del campo (la mejor vista del partido).
- **Südtribüne y Nordtribüne**: detrás de las porterías.
- **Niveles**, del campo hacia arriba: Grada baja, Grada alta.

## Zonas

- [[10 Recintos/Signal Iduna Park/Zonas/Westtribüne|Westtribüne]] — Grada principal, a lo largo del campo.
- [[10 Recintos/Signal Iduna Park/Zonas/Osttribüne|Osttribüne]] — Grada lateral enfrente de la principal, a lo largo del campo.
- [[10 Recintos/Signal Iduna Park/Zonas/Südtribüne|Südtribüne]] — Grada detrás de una de las porterías.
- [[10 Recintos/Signal Iduna Park/Zonas/Nordtribüne|Nordtribüne]] — Grada detrás de una de las porterías.

> [!info] Plano orientativo
> Gradas, niveles y zonas para coordinar la compra y enseñar al cliente dónde irá. Sectores, filas y asientos exactos: en el plano oficial de cada venta.

Fuente: Estadios de los clubes habituales de la UEFA Champions League: aforo aproximado y nombres habituales de sus gradas (datos de referencia). Gradas y niveles: estructura orientativa con los nombres habituales del estadio; sectores, filas y asientos exactos: en el plano oficial de cada venta.

## Secciones

```base
filters:
  and:
    - 'note.type == "section"'
    - 'file.inFolder("10 Recintos/Signal Iduna Park")'
views:
  - type: table
    name: Secciones
    order:
      - file.name
      - note.zone
      - note.level
      - note.kind
```
