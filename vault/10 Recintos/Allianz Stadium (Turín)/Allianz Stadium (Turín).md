---
type: "venue"
id: "allianz-stadium-turin"
name: "Allianz Stadium (Turín)"
city: "Turín"
club:
  - "Juventus FC"
  - "Juventus"
capacity: 41507
aliases:
  - "Juventus Stadium"
  - "Allianz Stadium Torino"
source: "Estadios de los clubes habituales de la UEFA Champions League: aforo aproximado y nombres habituales de sus gradas (datos de referencia). Gradas y niveles: estructura orientativa con los nombres habituales del estadio; sectores, filas y asientos exactos: en el plano oficial de cada venta."
verifiedAt: "2026-09-29"
verifiedBy: "asistente"
confidence: 0.7
tags:
  - "recinto"
  - "real"
  - "estadio"
  - "champions"
---

# Allianz Stadium (Turín)

**Turín** · 41.507 localidades. Estadio del **Juventus FC** (Italia). Champions League: las entradas del equipo local las vende su club en su web oficial; si vais con el equipo visitante (p. ej. el Real Madrid o el Atlético), la afición visitante compra a través de su propio club.

## Cómo leer el plano

- **Tribuna Ovest y Tribuna Est**: gradas laterales, a lo largo del campo (la mejor vista del partido).
- **Curva Nord y Curva Sud**: detrás de las porterías.
- **Niveles**, del campo hacia arriba: Grada baja, Grada alta.

## Zonas

- [[10 Recintos/Allianz Stadium (Turín)/Zonas/Tribuna Ovest|Tribuna Ovest]] — Grada principal, a lo largo del campo.
- [[10 Recintos/Allianz Stadium (Turín)/Zonas/Tribuna Est|Tribuna Est]] — Grada lateral enfrente de la principal, a lo largo del campo.
- [[10 Recintos/Allianz Stadium (Turín)/Zonas/Curva Nord|Curva Nord]] — Grada detrás de una de las porterías.
- [[10 Recintos/Allianz Stadium (Turín)/Zonas/Curva Sud|Curva Sud]] — Grada detrás de una de las porterías.

> [!info] Plano orientativo
> Gradas, niveles y zonas para coordinar la compra y enseñar al cliente dónde irá. Sectores, filas y asientos exactos: en el plano oficial de cada venta.

Fuente: Estadios de los clubes habituales de la UEFA Champions League: aforo aproximado y nombres habituales de sus gradas (datos de referencia). Gradas y niveles: estructura orientativa con los nombres habituales del estadio; sectores, filas y asientos exactos: en el plano oficial de cada venta.

## Secciones

```base
filters:
  and:
    - 'note.type == "section"'
    - 'file.inFolder("10 Recintos/Allianz Stadium (Turín)")'
views:
  - type: table
    name: Secciones
    order:
      - file.name
      - note.zone
      - note.level
      - note.kind
```
