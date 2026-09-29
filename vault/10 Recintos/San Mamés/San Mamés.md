---
type: "venue"
id: "san-mames"
name: "San Mamés"
city: "Bilbao"
capacity: 53289
aliases:
  - "Estadio San Mamés"
source: "LaLiga 2026-27: club, estadio y aforo según es.wikipedia.org/wiki/Primera_División_de_España_2026-27 (consultado el 29-09-2026). Gradas y niveles: estructura orientativa con los nombres habituales del estadio; sectores, filas y asientos exactos: en el plano oficial de cada venta."
verifiedAt: "2026-09-29"
verifiedBy: "asistente"
confidence: 0.7
tags:
  - "recinto"
  - "real"
  - "estadio"
  - "laliga"
  - "conciertos"
---

# San Mamés

**Bilbao** · 53.289 localidades. Estadio del **Athletic Club** (LaLiga 2026-27). Fútbol: entradas en la web oficial del club. Acoge grandes conciertos (la venta suele ser en Ticketmaster, entradas.com u otra ticketera oficial del evento).

## Cómo leer el plano

- **Tribuna Principal y Tribuna Este**: gradas laterales, a lo largo del campo (la mejor vista del partido).
- **Fondo Norte y Fondo Sur**: detrás de las porterías. En conciertos el escenario suele ir en un fondo.
- **Niveles**, del campo hacia arriba: Grada baja, Grada alta.
- **Pista (conciertos)**: de pie sobre el césped. *Front Stage* = delante del escenario; *General* = detrás.

## Zonas

- [[10 Recintos/San Mamés/Zonas/Pista (conciertos)|Pista (conciertos)]] — Solo en conciertos: de pie sobre el césped.
- [[10 Recintos/San Mamés/Zonas/Tribuna Principal|Tribuna Principal]] — Grada principal, a lo largo del campo.
- [[10 Recintos/San Mamés/Zonas/Tribuna Este|Tribuna Este]] — Grada lateral enfrente de la principal, a lo largo del campo.
- [[10 Recintos/San Mamés/Zonas/Fondo Norte|Fondo Norte]] — Grada detrás de una de las porterías.
- [[10 Recintos/San Mamés/Zonas/Fondo Sur|Fondo Sur]] — Grada detrás de una de las porterías.

> [!info] Plano orientativo
> Gradas, niveles y zonas para coordinar la compra y enseñar al cliente dónde irá. Sectores, filas y asientos exactos: en el plano oficial de cada venta.

Fuente: LaLiga 2026-27: club, estadio y aforo según es.wikipedia.org/wiki/Primera_División_de_España_2026-27 (consultado el 29-09-2026). Gradas y niveles: estructura orientativa con los nombres habituales del estadio; sectores, filas y asientos exactos: en el plano oficial de cada venta.

## Secciones

```base
filters:
  and:
    - 'note.type == "section"'
    - 'file.inFolder("10 Recintos/San Mamés")'
views:
  - type: table
    name: Secciones
    order:
      - file.name
      - note.zone
      - note.level
      - note.kind
```
