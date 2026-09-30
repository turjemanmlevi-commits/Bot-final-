---
type: "venue"
id: "anfield"
name: "Anfield"
city: "Liverpool"
club:
  - "Liverpool FC"
  - "Liverpool"
capacity: 61276
aliases: []
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

# Anfield

**Liverpool** · 61.276 localidades. Estadio del **Liverpool FC** (Inglaterra). Champions League: las entradas del equipo local las vende su club en su web oficial; si vais con el equipo visitante (p. ej. el Real Madrid o el Atlético), la afición visitante compra a través de su propio club.

## Cómo leer el plano

- **Main Stand y Sir Kenny Dalglish Stand**: gradas laterales, a lo largo del campo (la mejor vista del partido).
- **The Kop y Anfield Road Stand**: detrás de las porterías.
- **Niveles**, del campo hacia arriba: Grada baja, Grada alta.

## Zonas

- [[10 Recintos/Anfield/Zonas/Main Stand|Main Stand]] — Grada principal, a lo largo del campo.
- [[10 Recintos/Anfield/Zonas/Sir Kenny Dalglish Stand|Sir Kenny Dalglish Stand]] — Grada lateral enfrente de la principal, a lo largo del campo.
- [[10 Recintos/Anfield/Zonas/The Kop|The Kop]] — Grada detrás de una de las porterías.
- [[10 Recintos/Anfield/Zonas/Anfield Road Stand|Anfield Road Stand]] — Grada detrás de una de las porterías.

> [!info] Plano orientativo
> Gradas, niveles y zonas para coordinar la compra y enseñar al cliente dónde irá. Sectores, filas y asientos exactos: en el plano oficial de cada venta.

Fuente: Estadios de los clubes habituales de la UEFA Champions League: aforo aproximado y nombres habituales de sus gradas (datos de referencia). Gradas y niveles: estructura orientativa con los nombres habituales del estadio; sectores, filas y asientos exactos: en el plano oficial de cada venta.

## Secciones

```base
filters:
  and:
    - 'note.type == "section"'
    - 'file.inFolder("10 Recintos/Anfield")'
views:
  - type: table
    name: Secciones
    order:
      - file.name
      - note.zone
      - note.level
      - note.kind
```
