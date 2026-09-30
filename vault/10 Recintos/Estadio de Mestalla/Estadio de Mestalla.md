---
type: "venue"
id: "estadio-de-mestalla"
name: "Estadio de Mestalla"
city: "Valencia"
club:
  - "Valencia CF"
capacity: 49430
aliases:
  - "Mestalla"
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

# Estadio de Mestalla

**Valencia** · 49.430 localidades. Estadio del **Valencia CF** (LaLiga 2026-27). Fútbol: entradas en la web oficial del club.

## Cómo leer el plano

- **Tribuna y Grada Central**: gradas laterales, a lo largo del campo (la mejor vista del partido).
- **Gol Mar y Gol Gran Capità**: detrás de las porterías.
- **Niveles**, del campo hacia arriba: Grada baja, Grada alta.

## Zonas

- [[10 Recintos/Estadio de Mestalla/Zonas/Tribuna|Tribuna]] — Grada principal, a lo largo del campo.
- [[10 Recintos/Estadio de Mestalla/Zonas/Grada Central|Grada Central]] — Grada lateral enfrente de la principal, a lo largo del campo.
- [[10 Recintos/Estadio de Mestalla/Zonas/Gol Mar|Gol Mar]] — Grada detrás de una de las porterías.
- [[10 Recintos/Estadio de Mestalla/Zonas/Gol Gran Capità|Gol Gran Capità]] — Grada detrás de una de las porterías.

> [!info] Plano orientativo
> Gradas, niveles y zonas para coordinar la compra y enseñar al cliente dónde irá. Sectores, filas y asientos exactos: en el plano oficial de cada venta.

Fuente: LaLiga 2026-27: club, estadio y aforo según es.wikipedia.org/wiki/Primera_División_de_España_2026-27 (consultado el 29-09-2026). Gradas y niveles: estructura orientativa con los nombres habituales del estadio; sectores, filas y asientos exactos: en el plano oficial de cada venta.

## Secciones

```base
filters:
  and:
    - 'note.type == "section"'
    - 'file.inFolder("10 Recintos/Estadio de Mestalla")'
views:
  - type: table
    name: Secciones
    order:
      - file.name
      - note.zone
      - note.level
      - note.kind
```
