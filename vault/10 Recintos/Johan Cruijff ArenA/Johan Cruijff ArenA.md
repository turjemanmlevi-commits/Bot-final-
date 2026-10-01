---
type: "venue"
id: "johan-cruijff-arena"
name: "Johan Cruijff ArenA"
city: "Ámsterdam"
club:
  - "AFC Ajax"
  - "Ajax"
capacity: 55865
aliases:
  - "Johan Cruyff Arena"
  - "Amsterdam ArenA"
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

# Johan Cruijff ArenA

**Ámsterdam** · 55.865 localidades. Estadio del **AFC Ajax** (Países Bajos). Champions League: las entradas del equipo local las vende su club en su web oficial; si vais con el equipo visitante (p. ej. el Real Madrid o el Atlético), la afición visitante compra a través de su propio club.

## Cómo leer el plano

- **Tribuna Principal y Tribuna Lateral**: gradas laterales, a lo largo del campo (la mejor vista del partido).
- **Fondo Norte y Fondo Sur**: detrás de las porterías.
- **Niveles**, del campo hacia arriba: Grada baja, Grada alta.

## Zonas

- [[10 Recintos/Johan Cruijff ArenA/Zonas/Tribuna Principal|Tribuna Principal]] — Grada principal, a lo largo del campo.
- [[10 Recintos/Johan Cruijff ArenA/Zonas/Tribuna Lateral|Tribuna Lateral]] — Grada lateral enfrente de la principal, a lo largo del campo.
- [[10 Recintos/Johan Cruijff ArenA/Zonas/Fondo Norte|Fondo Norte]] — Grada detrás de una de las porterías.
- [[10 Recintos/Johan Cruijff ArenA/Zonas/Fondo Sur|Fondo Sur]] — Grada detrás de una de las porterías.

> [!info] Plano orientativo
> Gradas, niveles y zonas para coordinar la compra y enseñar al cliente dónde irá. Sectores, filas y asientos exactos: en el plano oficial de cada venta.

Fuente: Estadios de los clubes habituales de la UEFA Champions League: aforo aproximado y nombres habituales de sus gradas (datos de referencia). Gradas y niveles: estructura orientativa con los nombres habituales del estadio; sectores, filas y asientos exactos: en el plano oficial de cada venta.

## Secciones

```base
filters:
  and:
    - 'note.type == "section"'
    - 'file.inFolder("10 Recintos/Johan Cruijff ArenA")'
views:
  - type: table
    name: Secciones
    order:
      - file.name
      - note.zone
      - note.level
      - note.kind
```
