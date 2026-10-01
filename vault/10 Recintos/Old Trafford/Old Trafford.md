---
type: "venue"
id: "old-trafford"
name: "Old Trafford"
city: "Mánchester"
club:
  - "Manchester United FC"
  - "Manchester United"
capacity: 74310
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

# Old Trafford

**Mánchester** · 74.310 localidades. Estadio del **Manchester United FC** (Inglaterra). Champions League: las entradas del equipo local las vende su club en su web oficial; si vais con el equipo visitante (p. ej. el Real Madrid o el Atlético), la afición visitante compra a través de su propio club.

## Cómo leer el plano

- **Sir Bobby Charlton Stand y Sir Alex Ferguson Stand**: gradas laterales, a lo largo del campo (la mejor vista del partido).
- **Stretford End y East Stand**: detrás de las porterías.
- **Niveles**, del campo hacia arriba: Grada baja, Grada alta, Grada media.

## Zonas

- [[10 Recintos/Old Trafford/Zonas/Sir Bobby Charlton Stand|Sir Bobby Charlton Stand]] — Grada principal, a lo largo del campo.
- [[10 Recintos/Old Trafford/Zonas/Sir Alex Ferguson Stand|Sir Alex Ferguson Stand]] — Grada lateral enfrente de la principal, a lo largo del campo.
- [[10 Recintos/Old Trafford/Zonas/Stretford End|Stretford End]] — Grada detrás de una de las porterías.
- [[10 Recintos/Old Trafford/Zonas/East Stand|East Stand]] — Grada detrás de una de las porterías.

> [!info] Plano orientativo
> Gradas, niveles y zonas para coordinar la compra y enseñar al cliente dónde irá. Sectores, filas y asientos exactos: en el plano oficial de cada venta.

Fuente: Estadios de los clubes habituales de la UEFA Champions League: aforo aproximado y nombres habituales de sus gradas (datos de referencia). Gradas y niveles: estructura orientativa con los nombres habituales del estadio; sectores, filas y asientos exactos: en el plano oficial de cada venta.

## Secciones

```base
filters:
  and:
    - 'note.type == "section"'
    - 'file.inFolder("10 Recintos/Old Trafford")'
views:
  - type: table
    name: Secciones
    order:
      - file.name
      - note.zone
      - note.level
      - note.kind
```
