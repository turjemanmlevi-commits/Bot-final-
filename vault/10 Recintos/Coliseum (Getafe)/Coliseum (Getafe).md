---
type: "venue"
id: "coliseum-getafe"
name: "Coliseum (Getafe)"
city: "Getafe"
capacity: 16500
aliases:
  - "Coliseum Alfonso Pérez"
  - "Estadio Coliseum"
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

# Coliseum (Getafe)

**Getafe** · 16.500 localidades. Estadio del **Getafe CF** (LaLiga 2026-27). Fútbol: entradas en la web oficial del club.

## Cómo leer el plano

- **Tribuna y Preferencia**: gradas laterales, a lo largo del campo (la mejor vista del partido).
- **Fondo Norte y Fondo Sur**: detrás de las porterías.
- Cada grada va como un solo nivel en este plano.

## Zonas

- [[10 Recintos/Coliseum (Getafe)/Zonas/Tribuna|Tribuna]] — Grada principal, a lo largo del campo.
- [[10 Recintos/Coliseum (Getafe)/Zonas/Preferencia|Preferencia]] — Grada lateral enfrente de la principal, a lo largo del campo.
- [[10 Recintos/Coliseum (Getafe)/Zonas/Fondo Norte|Fondo Norte]] — Grada detrás de una de las porterías.
- [[10 Recintos/Coliseum (Getafe)/Zonas/Fondo Sur|Fondo Sur]] — Grada detrás de una de las porterías.

> [!info] Plano orientativo
> Gradas, niveles y zonas para coordinar la compra y enseñar al cliente dónde irá. Sectores, filas y asientos exactos: en el plano oficial de cada venta.

Fuente: LaLiga 2026-27: club, estadio y aforo según es.wikipedia.org/wiki/Primera_División_de_España_2026-27 (consultado el 29-09-2026). Gradas y niveles: estructura orientativa con los nombres habituales del estadio; sectores, filas y asientos exactos: en el plano oficial de cada venta.

## Secciones

```base
filters:
  and:
    - 'note.type == "section"'
    - 'file.inFolder("10 Recintos/Coliseum (Getafe)")'
views:
  - type: table
    name: Secciones
    order:
      - file.name
      - note.zone
      - note.level
      - note.kind
```
