---
type: "venue"
id: "etihad-stadium"
name: "Etihad Stadium"
city: "Mánchester"
club:
  - "Manchester City FC"
  - "Manchester City"
aliases:
  - "City of Manchester Stadium"
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

# Etihad Stadium

**Mánchester**. Estadio del **Manchester City FC** (Inglaterra). Champions League: las entradas del equipo local las vende su club en su web oficial; si vais con el equipo visitante (p. ej. el Real Madrid o el Atlético), la afición visitante compra a través de su propio club.

## Cómo leer el plano

- **Colin Bell Stand y East Stand**: gradas laterales, a lo largo del campo (la mejor vista del partido).
- **North Stand y South Stand**: detrás de las porterías.
- **Niveles**, del campo hacia arriba: Grada baja, Grada alta.

## Zonas

- [[10 Recintos/Etihad Stadium/Zonas/Colin Bell Stand|Colin Bell Stand]] — Grada principal, a lo largo del campo.
- [[10 Recintos/Etihad Stadium/Zonas/East Stand|East Stand]] — Grada lateral enfrente de la principal, a lo largo del campo.
- [[10 Recintos/Etihad Stadium/Zonas/North Stand|North Stand]] — Grada detrás de una de las porterías.
- [[10 Recintos/Etihad Stadium/Zonas/South Stand|South Stand]] — Grada detrás de una de las porterías.

> [!info] Plano orientativo
> Gradas, niveles y zonas para coordinar la compra y enseñar al cliente dónde irá. Sectores, filas y asientos exactos: en el plano oficial de cada venta.

Fuente: Estadios de los clubes habituales de la UEFA Champions League: aforo aproximado y nombres habituales de sus gradas (datos de referencia). Gradas y niveles: estructura orientativa con los nombres habituales del estadio; sectores, filas y asientos exactos: en el plano oficial de cada venta.

## Secciones

```base
filters:
  and:
    - 'note.type == "section"'
    - 'file.inFolder("10 Recintos/Etihad Stadium")'
views:
  - type: table
    name: Secciones
    order:
      - file.name
      - note.zone
      - note.level
      - note.kind
```
