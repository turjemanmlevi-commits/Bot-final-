---
type: "venue"
id: "spotify-camp-nou"
name: "Spotify Camp Nou"
city: "Barcelona"
capacity: 99354
aliases:
  - "Camp Nou"
  - "Estadi Camp Nou"
  - "Nou Camp"
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

# Spotify Camp Nou

**Barcelona** · 99.354 localidades. Estadio del **FC Barcelona** (LaLiga 2026-27). Fútbol: entradas en la web oficial del club. Acoge grandes conciertos (la venta suele ser en Ticketmaster, entradas.com u otra ticketera oficial del evento).

## Cómo leer el plano

- **Tribuna y Lateral**: gradas laterales, a lo largo del campo (la mejor vista del partido).
- **Gol Norte y Gol Sur**: detrás de las porterías. En conciertos el escenario suele ir en un fondo.
- **Niveles**, del campo hacia arriba: Primera grada, Segunda grada, Tercera grada.
- **Pista (conciertos)**: de pie sobre el césped. *Front Stage* = delante del escenario; *General* = detrás.

## Zonas

- [[10 Recintos/Spotify Camp Nou/Zonas/Pista (conciertos)|Pista (conciertos)]] — Solo en conciertos: de pie sobre el césped.
- [[10 Recintos/Spotify Camp Nou/Zonas/Tribuna|Tribuna]] — Grada principal, a lo largo del campo.
- [[10 Recintos/Spotify Camp Nou/Zonas/Lateral|Lateral]] — Grada lateral enfrente de la principal, a lo largo del campo.
- [[10 Recintos/Spotify Camp Nou/Zonas/Gol Norte|Gol Norte]] — Grada detrás de una de las porterías.
- [[10 Recintos/Spotify Camp Nou/Zonas/Gol Sur|Gol Sur]] — Grada detrás de una de las porterías.

> [!info] Plano orientativo
> Gradas, niveles y zonas para coordinar la compra y enseñar al cliente dónde irá. Sectores, filas y asientos exactos: en el plano oficial de cada venta.

Fuente: LaLiga 2026-27: club, estadio y aforo según es.wikipedia.org/wiki/Primera_División_de_España_2026-27 (consultado el 29-09-2026). Gradas y niveles: estructura orientativa con los nombres habituales del estadio; sectores, filas y asientos exactos: en el plano oficial de cada venta.

## Secciones

```base
filters:
  and:
    - 'note.type == "section"'
    - 'file.inFolder("10 Recintos/Spotify Camp Nou")'
views:
  - type: table
    name: Secciones
    order:
      - file.name
      - note.zone
      - note.level
      - note.kind
```
