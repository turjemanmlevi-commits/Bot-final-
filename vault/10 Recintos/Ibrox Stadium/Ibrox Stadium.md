---
type: "venue"
id: "ibrox-stadium"
name: "Ibrox Stadium"
city: "Glasgow"
club:
  - "Rangers FC"
  - "Rangers"
capacity: 50817
aliases:
  - "Ibrox"
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

# Ibrox Stadium

**Glasgow** · 50.817 localidades. Estadio del **Rangers FC** (Escocia). Champions League: las entradas del equipo local las vende su club en su web oficial; si vais con el equipo visitante (p. ej. el Real Madrid o el Atlético), la afición visitante compra a través de su propio club.

## Cómo leer el plano

- **Bill Struth Main Stand y Govan Stand**: gradas laterales, a lo largo del campo (la mejor vista del partido).
- **Broomloan Road Stand y Sandy Jardine Stand**: detrás de las porterías.
- **Niveles**, del campo hacia arriba: Grada baja, Grada media, Grada alta.

## Zonas

- [[10 Recintos/Ibrox Stadium/Zonas/Bill Struth Main Stand|Bill Struth Main Stand]] — Grada principal, a lo largo del campo.
- [[10 Recintos/Ibrox Stadium/Zonas/Govan Stand|Govan Stand]] — Grada lateral enfrente de la principal, a lo largo del campo.
- [[10 Recintos/Ibrox Stadium/Zonas/Broomloan Road Stand|Broomloan Road Stand]] — Grada detrás de una de las porterías.
- [[10 Recintos/Ibrox Stadium/Zonas/Sandy Jardine Stand|Sandy Jardine Stand]] — Grada detrás de una de las porterías.

> [!info] Plano orientativo
> Gradas, niveles y zonas para coordinar la compra y enseñar al cliente dónde irá. Sectores, filas y asientos exactos: en el plano oficial de cada venta.

Fuente: Estadios de los clubes habituales de la UEFA Champions League: aforo aproximado y nombres habituales de sus gradas (datos de referencia). Gradas y niveles: estructura orientativa con los nombres habituales del estadio; sectores, filas y asientos exactos: en el plano oficial de cada venta.

## Secciones

```base
filters:
  and:
    - 'note.type == "section"'
    - 'file.inFolder("10 Recintos/Ibrox Stadium")'
views:
  - type: table
    name: Secciones
    order:
      - file.name
      - note.zone
      - note.level
      - note.kind
```
