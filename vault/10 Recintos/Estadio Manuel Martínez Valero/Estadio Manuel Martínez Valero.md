---
type: "venue"
id: "estadio-manuel-martinez-valero"
name: "Estadio Manuel Martínez Valero"
city: "Elche"
capacity: 33732
aliases:
  - "Martínez Valero"
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

# Estadio Manuel Martínez Valero

**Elche** · 33.732 localidades. Estadio del **Elche CF** (LaLiga 2026-27). Fútbol: entradas en la web oficial del club.

## Cómo leer el plano

- **Tribuna y Preferencia**: gradas laterales, a lo largo del campo (la mejor vista del partido).
- **Fondo Norte y Fondo Sur**: detrás de las porterías.
- **Niveles**, del campo hacia arriba: Grada baja, Grada alta.

## Zonas

- [[10 Recintos/Estadio Manuel Martínez Valero/Zonas/Tribuna|Tribuna]] — Grada principal, a lo largo del campo.
- [[10 Recintos/Estadio Manuel Martínez Valero/Zonas/Preferencia|Preferencia]] — Grada lateral enfrente de la principal, a lo largo del campo.
- [[10 Recintos/Estadio Manuel Martínez Valero/Zonas/Fondo Norte|Fondo Norte]] — Grada detrás de una de las porterías.
- [[10 Recintos/Estadio Manuel Martínez Valero/Zonas/Fondo Sur|Fondo Sur]] — Grada detrás de una de las porterías.

> [!info] Plano orientativo
> Gradas, niveles y zonas para coordinar la compra y enseñar al cliente dónde irá. Sectores, filas y asientos exactos: en el plano oficial de cada venta.

Fuente: LaLiga 2026-27: club, estadio y aforo según es.wikipedia.org/wiki/Primera_División_de_España_2026-27 (consultado el 29-09-2026). Gradas y niveles: estructura orientativa con los nombres habituales del estadio; sectores, filas y asientos exactos: en el plano oficial de cada venta.

## Secciones

```base
filters:
  and:
    - 'note.type == "section"'
    - 'file.inFolder("10 Recintos/Estadio Manuel Martínez Valero")'
views:
  - type: table
    name: Secciones
    order:
      - file.name
      - note.zone
      - note.level
      - note.kind
```
