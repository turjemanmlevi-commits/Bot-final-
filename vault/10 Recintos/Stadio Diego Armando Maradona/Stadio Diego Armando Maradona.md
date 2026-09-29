---
type: "venue"
id: "stadio-diego-armando-maradona"
name: "Stadio Diego Armando Maradona"
city: "Nápoles"
club:
  - "SSC Napoli"
  - "Napoli"
  - "Nápoles"
capacity: 54726
aliases:
  - "Stadio San Paolo"
  - "Maradona"
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

# Stadio Diego Armando Maradona

**Nápoles** · 54.726 localidades. Estadio del **SSC Napoli** (Italia). Champions League: las entradas del equipo local las vende su club en su web oficial; si vais con el equipo visitante (p. ej. el Real Madrid o el Atlético), la afición visitante compra a través de su propio club.

## Cómo leer el plano

- **Tribuna Posillipo y Tribuna Nisida**: gradas laterales, a lo largo del campo (la mejor vista del partido).
- **Curva A y Curva B**: detrás de las porterías.
- **Niveles**, del campo hacia arriba: Grada baja, Grada alta.

## Zonas

- [[10 Recintos/Stadio Diego Armando Maradona/Zonas/Tribuna Posillipo|Tribuna Posillipo]] — Grada principal, a lo largo del campo.
- [[10 Recintos/Stadio Diego Armando Maradona/Zonas/Tribuna Nisida|Tribuna Nisida]] — Grada lateral enfrente de la principal, a lo largo del campo.
- [[10 Recintos/Stadio Diego Armando Maradona/Zonas/Curva A|Curva A]] — Grada detrás de una de las porterías.
- [[10 Recintos/Stadio Diego Armando Maradona/Zonas/Curva B|Curva B]] — Grada detrás de una de las porterías.

> [!info] Plano orientativo
> Gradas, niveles y zonas para coordinar la compra y enseñar al cliente dónde irá. Sectores, filas y asientos exactos: en el plano oficial de cada venta.

Fuente: Estadios de los clubes habituales de la UEFA Champions League: aforo aproximado y nombres habituales de sus gradas (datos de referencia). Gradas y niveles: estructura orientativa con los nombres habituales del estadio; sectores, filas y asientos exactos: en el plano oficial de cada venta.

## Secciones

```base
filters:
  and:
    - 'note.type == "section"'
    - 'file.inFolder("10 Recintos/Stadio Diego Armando Maradona")'
views:
  - type: table
    name: Secciones
    order:
      - file.name
      - note.zone
      - note.level
      - note.kind
```
