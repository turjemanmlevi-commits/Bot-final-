---
type: "venue"
id: "parc-des-princes"
name: "Parc des Princes"
city: "París"
club:
  - "Paris Saint-Germain FC"
  - "Paris Saint-Germain"
  - "PSG"
capacity: 47929
aliases:
  - "Parque de los Príncipes"
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

# Parc des Princes

**París** · 47.929 localidades. Estadio del **Paris Saint-Germain FC** (Francia). Champions League: las entradas del equipo local las vende su club en su web oficial; si vais con el equipo visitante (p. ej. el Real Madrid o el Atlético), la afición visitante compra a través de su propio club.

## Cómo leer el plano

- **Tribune Présidentielle y Tribune Paris**: gradas laterales, a lo largo del campo (la mejor vista del partido).
- **Tribune Auteuil y Tribune Boulogne**: detrás de las porterías.
- **Niveles**, del campo hacia arriba: Grada baja, Grada alta.

## Zonas

- [[10 Recintos/Parc des Princes/Zonas/Tribune Présidentielle|Tribune Présidentielle]] — Grada principal, a lo largo del campo.
- [[10 Recintos/Parc des Princes/Zonas/Tribune Paris|Tribune Paris]] — Grada lateral enfrente de la principal, a lo largo del campo.
- [[10 Recintos/Parc des Princes/Zonas/Tribune Auteuil|Tribune Auteuil]] — Grada detrás de una de las porterías.
- [[10 Recintos/Parc des Princes/Zonas/Tribune Boulogne|Tribune Boulogne]] — Grada detrás de una de las porterías.

> [!info] Plano orientativo
> Gradas, niveles y zonas para coordinar la compra y enseñar al cliente dónde irá. Sectores, filas y asientos exactos: en el plano oficial de cada venta.

Fuente: Estadios de los clubes habituales de la UEFA Champions League: aforo aproximado y nombres habituales de sus gradas (datos de referencia). Gradas y niveles: estructura orientativa con los nombres habituales del estadio; sectores, filas y asientos exactos: en el plano oficial de cada venta.

## Secciones

```base
filters:
  and:
    - 'note.type == "section"'
    - 'file.inFolder("10 Recintos/Parc des Princes")'
views:
  - type: table
    name: Secciones
    order:
      - file.name
      - note.zone
      - note.level
      - note.kind
```
