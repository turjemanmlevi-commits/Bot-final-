---
type: "venue"
id: "estadio-de-la-cartuja"
name: "Estadio de La Cartuja"
city: "Sevilla"
club:
  - "Real Betis"
  - "Real Betis Balompié"
capacity: 68887
aliases:
  - "La Cartuja"
  - "Estadio Olímpico de La Cartuja"
  - "Estadio Olímpico de Sevilla"
  - "Cartuja"
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

# Estadio de La Cartuja

**Sevilla** · 68.887 localidades. Estadio del **Real Betis** (LaLiga 2026-27). Fútbol: entradas en la web oficial del club. En 2026-27 juega aquí el Real Betis mientras se reconstruye el Benito Villamarín. Acoge grandes conciertos y festivales: Puro Latino Fest Sevilla 2026 (3 y 4 de julio, según estadiolacartuja.es).

## Cómo leer el plano

- **Tribuna y Preferencia**: gradas laterales, a lo largo del campo (la mejor vista del partido).
- **Fondo Norte y Fondo Sur**: detrás de las porterías. En conciertos el escenario suele ir en un fondo.
- **Niveles**, del campo hacia arriba: Grada baja, Grada alta.
- **Pista (conciertos)**: de pie sobre el césped. *Front Stage* = delante del escenario; *General* = detrás.

## Zonas

- [[10 Recintos/Estadio de La Cartuja/Zonas/Pista (conciertos)|Pista (conciertos)]] — Solo en conciertos: de pie sobre el césped.
- [[10 Recintos/Estadio de La Cartuja/Zonas/Tribuna|Tribuna]] — Grada principal, a lo largo del campo.
- [[10 Recintos/Estadio de La Cartuja/Zonas/Preferencia|Preferencia]] — Grada lateral enfrente de la principal, a lo largo del campo.
- [[10 Recintos/Estadio de La Cartuja/Zonas/Fondo Norte|Fondo Norte]] — Grada detrás de una de las porterías.
- [[10 Recintos/Estadio de La Cartuja/Zonas/Fondo Sur|Fondo Sur]] — Grada detrás de una de las porterías.

> [!info] Plano orientativo
> Gradas, niveles y zonas para coordinar la compra y enseñar al cliente dónde irá. Sectores, filas y asientos exactos: en el plano oficial de cada venta.

Fuente: LaLiga 2026-27: club, estadio y aforo según es.wikipedia.org/wiki/Primera_División_de_España_2026-27 (consultado el 29-09-2026). Gradas y niveles: estructura orientativa con los nombres habituales del estadio; sectores, filas y asientos exactos: en el plano oficial de cada venta.

## Secciones

```base
filters:
  and:
    - 'note.type == "section"'
    - 'file.inFolder("10 Recintos/Estadio de La Cartuja")'
views:
  - type: table
    name: Secciones
    order:
      - file.name
      - note.zone
      - note.level
      - note.kind
```
