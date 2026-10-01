---
type: "venue"
id: "villa-park"
name: "Villa Park"
city: "Birmingham"
club:
  - "Aston Villa FC"
  - "Aston Villa"
aliases: []
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

# Villa Park

**Birmingham**. Estadio del **Aston Villa FC** (Inglaterra). Champions League: las entradas del equipo local las vende su club en su web oficial; si vais con el equipo visitante (p. ej. el Real Madrid o el Atlético), la afición visitante compra a través de su propio club.

## Cómo leer el plano

- **Trinity Road Stand y Doug Ellis Stand**: gradas laterales, a lo largo del campo (la mejor vista del partido).
- **Holte End y North Stand**: detrás de las porterías.
- **Niveles**, del campo hacia arriba: Grada baja, Grada alta.

## Zonas

- [[10 Recintos/Villa Park/Zonas/Trinity Road Stand|Trinity Road Stand]] — Grada principal, a lo largo del campo.
- [[10 Recintos/Villa Park/Zonas/Doug Ellis Stand|Doug Ellis Stand]] — Grada lateral enfrente de la principal, a lo largo del campo.
- [[10 Recintos/Villa Park/Zonas/Holte End|Holte End]] — Grada detrás de una de las porterías.
- [[10 Recintos/Villa Park/Zonas/North Stand|North Stand]] — Grada detrás de una de las porterías.

> [!info] Plano orientativo
> Gradas, niveles y zonas para coordinar la compra y enseñar al cliente dónde irá. Sectores, filas y asientos exactos: en el plano oficial de cada venta.

Fuente: Estadios de los clubes habituales de la UEFA Champions League: aforo aproximado y nombres habituales de sus gradas (datos de referencia). Gradas y niveles: estructura orientativa con los nombres habituales del estadio; sectores, filas y asientos exactos: en el plano oficial de cada venta.

## Secciones

```base
filters:
  and:
    - 'note.type == "section"'
    - 'file.inFolder("10 Recintos/Villa Park")'
views:
  - type: table
    name: Secciones
    order:
      - file.name
      - note.zone
      - note.level
      - note.kind
```
