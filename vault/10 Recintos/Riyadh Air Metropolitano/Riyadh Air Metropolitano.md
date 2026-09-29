---
type: "venue"
id: "riyadh-air-metropolitano"
name: "Riyadh Air Metropolitano"
city: "Madrid"
capacity: 70460
aliases:
  - "Metropolitano"
  - "Estadio Metropolitano"
  - "Cívitas Metropolitano"
  - "Wanda Metropolitano"
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

# Riyadh Air Metropolitano

**Madrid** · 70.460 localidades. Estadio del **Atlético de Madrid** (LaLiga 2026-27). Fútbol: entradas en la web oficial del club. Acoge grandes conciertos (la venta suele ser en Ticketmaster, entradas.com u otra ticketera oficial del evento).

## Cómo leer el plano

- **Lateral Oeste y Lateral Este**: gradas laterales, a lo largo del campo (la mejor vista del partido).
- **Fondo Norte y Fondo Sur**: detrás de las porterías. En conciertos el escenario suele ir en un fondo.
- **Niveles**, del campo hacia arriba: Grada baja, Grada media, Grada alta.
- **Pista (conciertos)**: de pie sobre el césped. *Front Stage* = delante del escenario; *General* = detrás.

## Zonas

- [[10 Recintos/Riyadh Air Metropolitano/Zonas/Pista (conciertos)|Pista (conciertos)]] — Solo en conciertos: de pie sobre el césped.
- [[10 Recintos/Riyadh Air Metropolitano/Zonas/Lateral Oeste|Lateral Oeste]] — Grada principal, a lo largo del campo.
- [[10 Recintos/Riyadh Air Metropolitano/Zonas/Lateral Este|Lateral Este]] — Grada lateral enfrente de la principal, a lo largo del campo.
- [[10 Recintos/Riyadh Air Metropolitano/Zonas/Fondo Norte|Fondo Norte]] — Grada detrás de una de las porterías.
- [[10 Recintos/Riyadh Air Metropolitano/Zonas/Fondo Sur|Fondo Sur]] — Grada detrás de una de las porterías.

> [!info] Plano orientativo
> Gradas, niveles y zonas para coordinar la compra y enseñar al cliente dónde irá. Sectores, filas y asientos exactos: en el plano oficial de cada venta.

Fuente: LaLiga 2026-27: club, estadio y aforo según es.wikipedia.org/wiki/Primera_División_de_España_2026-27 (consultado el 29-09-2026). Gradas y niveles: estructura orientativa con los nombres habituales del estadio; sectores, filas y asientos exactos: en el plano oficial de cada venta.

## Secciones

```base
filters:
  and:
    - 'note.type == "section"'
    - 'file.inFolder("10 Recintos/Riyadh Air Metropolitano")'
views:
  - type: table
    name: Secciones
    order:
      - file.name
      - note.zone
      - note.level
      - note.kind
```
