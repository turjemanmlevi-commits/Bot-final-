---
type: "venue"
id: "abanca-balaidos"
name: "Abanca-Balaídos"
city: "Vigo"
capacity: 24870
aliases:
  - "Balaídos"
  - "Estadio de Balaídos"
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

# Abanca-Balaídos

**Vigo** · 24.870 localidades. Estadio del **RC Celta** (LaLiga 2026-27). Fútbol: entradas en la web oficial del club.

## Cómo leer el plano

- **Tribuna y Río**: gradas laterales, a lo largo del campo (la mejor vista del partido).
- **Marcador y Gol**: detrás de las porterías.
- Cada grada va como un solo nivel en este plano.

## Zonas

- [[10 Recintos/Abanca-Balaídos/Zonas/Tribuna|Tribuna]] — Grada principal, a lo largo del campo.
- [[10 Recintos/Abanca-Balaídos/Zonas/Río|Río]] — Grada lateral enfrente de la principal, a lo largo del campo.
- [[10 Recintos/Abanca-Balaídos/Zonas/Marcador|Marcador]] — Grada detrás de una de las porterías.
- [[10 Recintos/Abanca-Balaídos/Zonas/Gol|Gol]] — Grada detrás de una de las porterías.

> [!info] Plano orientativo
> Gradas, niveles y zonas para coordinar la compra y enseñar al cliente dónde irá. Sectores, filas y asientos exactos: en el plano oficial de cada venta.

Fuente: LaLiga 2026-27: club, estadio y aforo según es.wikipedia.org/wiki/Primera_División_de_España_2026-27 (consultado el 29-09-2026). Gradas y niveles: estructura orientativa con los nombres habituales del estadio; sectores, filas y asientos exactos: en el plano oficial de cada venta.

## Secciones

```base
filters:
  and:
    - 'note.type == "section"'
    - 'file.inFolder("10 Recintos/Abanca-Balaídos")'
views:
  - type: table
    name: Secciones
    order:
      - file.name
      - note.zone
      - note.level
      - note.kind
```
