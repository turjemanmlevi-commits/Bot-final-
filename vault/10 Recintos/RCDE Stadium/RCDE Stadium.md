---
type: "venue"
id: "rcde-stadium"
name: "RCDE Stadium"
city: "Cornellà de Llobregat"
capacity: 40000
aliases:
  - "Estadio RCDE"
  - "Cornellà-El Prat"
  - "Estadi Cornellà-El Prat"
source: "LaLiga 2026-27: club, estadio y aforo según es.wikipedia.org/wiki/Primera_División_de_España_2026-27 (consultado el 29-09-2026). Gradas y niveles: estructura orientativa con los nombres habituales del estadio; sectores, filas y asientos exactos: en el plano oficial de cada venta."
verifiedAt: "2026-09-29"
verifiedBy: "asistente"
confidence: 0.7
tags:
  - "recinto"
  - "real"
  - "estadio"
  - "laliga"
---

# RCDE Stadium

**Cornellà de Llobregat** · 40.000 localidades. Estadio del **RCD Espanyol** (LaLiga 2026-27). Fútbol: entradas en la web oficial del club.

## Cómo leer el plano

- **Tribuna y Lateral**: gradas laterales, a lo largo del campo (la mejor vista del partido).
- **Fondo Cornellà y Fondo El Prat**: detrás de las porterías.
- **Niveles**, del campo hacia arriba: Grada baja, Grada alta.

## Zonas

- [[10 Recintos/RCDE Stadium/Zonas/Tribuna|Tribuna]] — Grada principal, a lo largo del campo.
- [[10 Recintos/RCDE Stadium/Zonas/Lateral|Lateral]] — Grada lateral enfrente de la principal, a lo largo del campo.
- [[10 Recintos/RCDE Stadium/Zonas/Fondo Cornellà|Fondo Cornellà]] — Grada detrás de una de las porterías.
- [[10 Recintos/RCDE Stadium/Zonas/Fondo El Prat|Fondo El Prat]] — Grada detrás de una de las porterías.

> [!info] Plano orientativo
> Gradas, niveles y zonas para coordinar la compra y enseñar al cliente dónde irá. Sectores, filas y asientos exactos: en el plano oficial de cada venta.

Fuente: LaLiga 2026-27: club, estadio y aforo según es.wikipedia.org/wiki/Primera_División_de_España_2026-27 (consultado el 29-09-2026). Gradas y niveles: estructura orientativa con los nombres habituales del estadio; sectores, filas y asientos exactos: en el plano oficial de cada venta.

## Secciones

```base
filters:
  and:
    - 'note.type == "section"'
    - 'file.inFolder("10 Recintos/RCDE Stadium")'
views:
  - type: table
    name: Secciones
    order:
      - file.name
      - note.zone
      - note.level
      - note.kind
```
