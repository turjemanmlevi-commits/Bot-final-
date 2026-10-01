---
type: "venue"
id: "stamford-bridge"
name: "Stamford Bridge"
city: "Londres"
club:
  - "Chelsea FC"
  - "Chelsea"
capacity: 40343
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

# Stamford Bridge

**Londres** · 40.343 localidades. Estadio del **Chelsea FC** (Inglaterra). Champions League: las entradas del equipo local las vende su club en su web oficial; si vais con el equipo visitante (p. ej. el Real Madrid o el Atlético), la afición visitante compra a través de su propio club.

## Cómo leer el plano

- **West Stand y East Stand**: gradas laterales, a lo largo del campo (la mejor vista del partido).
- **Matthew Harding Stand y Shed End**: detrás de las porterías.
- **Niveles**, del campo hacia arriba: Grada baja, Grada alta.

## Zonas

- [[10 Recintos/Stamford Bridge/Zonas/West Stand|West Stand]] — Grada principal, a lo largo del campo.
- [[10 Recintos/Stamford Bridge/Zonas/East Stand|East Stand]] — Grada lateral enfrente de la principal, a lo largo del campo.
- [[10 Recintos/Stamford Bridge/Zonas/Matthew Harding Stand|Matthew Harding Stand]] — Grada detrás de una de las porterías.
- [[10 Recintos/Stamford Bridge/Zonas/Shed End|Shed End]] — Grada detrás de una de las porterías.

> [!info] Plano orientativo
> Gradas, niveles y zonas para coordinar la compra y enseñar al cliente dónde irá. Sectores, filas y asientos exactos: en el plano oficial de cada venta.

Fuente: Estadios de los clubes habituales de la UEFA Champions League: aforo aproximado y nombres habituales de sus gradas (datos de referencia). Gradas y niveles: estructura orientativa con los nombres habituales del estadio; sectores, filas y asientos exactos: en el plano oficial de cada venta.

## Secciones

```base
filters:
  and:
    - 'note.type == "section"'
    - 'file.inFolder("10 Recintos/Stamford Bridge")'
views:
  - type: table
    name: Secciones
    order:
      - file.name
      - note.zone
      - note.level
      - note.kind
```
