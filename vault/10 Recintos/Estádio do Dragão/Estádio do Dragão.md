---
type: "venue"
id: "estadio-do-dragao"
name: "Estádio do Dragão"
city: "Oporto"
club:
  - "FC Porto"
  - "Oporto"
  - "Porto"
capacity: 50033
aliases:
  - "Estadio del Dragón"
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

# Estádio do Dragão

**Oporto** · 50.033 localidades. Estadio del **FC Porto** (Portugal). Champions League: las entradas del equipo local las vende su club en su web oficial; si vais con el equipo visitante (p. ej. el Real Madrid o el Atlético), la afición visitante compra a través de su propio club.

## Cómo leer el plano

- **Bancada Poente y Bancada Nascente**: gradas laterales, a lo largo del campo (la mejor vista del partido).
- **Topo Norte y Topo Sul**: detrás de las porterías.
- **Niveles**, del campo hacia arriba: Grada baja, Grada alta.

## Zonas

- [[10 Recintos/Estádio do Dragão/Zonas/Bancada Poente|Bancada Poente]] — Grada principal, a lo largo del campo.
- [[10 Recintos/Estádio do Dragão/Zonas/Bancada Nascente|Bancada Nascente]] — Grada lateral enfrente de la principal, a lo largo del campo.
- [[10 Recintos/Estádio do Dragão/Zonas/Topo Norte|Topo Norte]] — Grada detrás de una de las porterías.
- [[10 Recintos/Estádio do Dragão/Zonas/Topo Sul|Topo Sul]] — Grada detrás de una de las porterías.

> [!info] Plano orientativo
> Gradas, niveles y zonas para coordinar la compra y enseñar al cliente dónde irá. Sectores, filas y asientos exactos: en el plano oficial de cada venta.

Fuente: Estadios de los clubes habituales de la UEFA Champions League: aforo aproximado y nombres habituales de sus gradas (datos de referencia). Gradas y niveles: estructura orientativa con los nombres habituales del estadio; sectores, filas y asientos exactos: en el plano oficial de cada venta.

## Secciones

```base
filters:
  and:
    - 'note.type == "section"'
    - 'file.inFolder("10 Recintos/Estádio do Dragão")'
views:
  - type: table
    name: Secciones
    order:
      - file.name
      - note.zone
      - note.level
      - note.kind
```
