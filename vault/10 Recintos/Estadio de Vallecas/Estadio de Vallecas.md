---
type: "venue"
id: "estadio-de-vallecas"
name: "Estadio de Vallecas"
city: "Madrid"
capacity: 14708
aliases:
  - "Vallecas"
  - "Campo de Fútbol de Vallecas"
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

# Estadio de Vallecas

**Madrid** · 14.708 localidades. Estadio del **Rayo Vallecano** (LaLiga 2026-27). Fútbol: entradas en la web oficial del club. Tiene gradas en tres lados: detrás de una de las porterías no hay grada.

## Cómo leer el plano

- **Tribuna y Preferencia**: gradas laterales, a lo largo del campo (la mejor vista del partido).
- **Fondo**: detrás de las porterías.
- Cada grada va como un solo nivel en este plano.

## Zonas

- [[10 Recintos/Estadio de Vallecas/Zonas/Tribuna|Tribuna]] — Grada principal, a lo largo del campo.
- [[10 Recintos/Estadio de Vallecas/Zonas/Preferencia|Preferencia]] — Grada lateral enfrente de la principal, a lo largo del campo.
- [[10 Recintos/Estadio de Vallecas/Zonas/Fondo|Fondo]] — Grada detrás de una de las porterías.

> [!info] Plano orientativo
> Gradas, niveles y zonas para coordinar la compra y enseñar al cliente dónde irá. Sectores, filas y asientos exactos: en el plano oficial de cada venta.

Fuente: LaLiga 2026-27: club, estadio y aforo según es.wikipedia.org/wiki/Primera_División_de_España_2026-27 (consultado el 29-09-2026). Gradas y niveles: estructura orientativa con los nombres habituales del estadio; sectores, filas y asientos exactos: en el plano oficial de cada venta.

## Secciones

```base
filters:
  and:
    - 'note.type == "section"'
    - 'file.inFolder("10 Recintos/Estadio de Vallecas")'
views:
  - type: table
    name: Secciones
    order:
      - file.name
      - note.zone
      - note.level
      - note.kind
```
