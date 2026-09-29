---
type: "venue"
id: "caja-magica"
name: "Caja Mágica"
city: "Madrid"
capacity: 12427
aliases:
  - "Estadio Manolo Santana"
source: "Aforo según en.wikipedia.org/wiki/List_of_indoor_arenas_in_Spain (consultado el 29-09-2026). Pista y gradas: estructura orientativa de un pabellón en formato concierto; sectores, filas y asientos exactos: en el plano oficial de cada venta."
verifiedAt: "2026-09-29"
verifiedBy: "asistente"
confidence: 0.7
tags:
  - "recinto"
  - "real"
  - "pabellon"
  - "conciertos"
---

# Caja Mágica

**Madrid** · 12.427 localidades. Pabellón multiusos para grandes conciertos.

## Cómo leer el plano

- **Pista**: de pie. *Front Stage* = delante del escenario; *General* = detrás.
- **Grada baja** (nivel 1) y **Grada alta** (nivel 2): sentado, alrededor de la pista.
- **Izquierda / Central / Derecha**: según se mira al escenario; *Central* = enfrente del escenario.

## Zonas

- [[10 Recintos/Caja Mágica/Zonas/Pista|Pista]] — De pie, delante del escenario.
- [[10 Recintos/Caja Mágica/Zonas/Grada baja|Grada baja]] — Primer anillo de asientos, alrededor de la pista.
- [[10 Recintos/Caja Mágica/Zonas/Grada alta|Grada alta]] — Anillo superior: más lejos y normalmente más barato.

> [!info] Plano orientativo
> Gradas, niveles y zonas para coordinar la compra y enseñar al cliente dónde irá. Sectores, filas y asientos exactos: en el plano oficial de cada venta.

Fuente: Aforo según en.wikipedia.org/wiki/List_of_indoor_arenas_in_Spain (consultado el 29-09-2026). Pista y gradas: estructura orientativa de un pabellón en formato concierto; sectores, filas y asientos exactos: en el plano oficial de cada venta.

## Secciones

```base
filters:
  and:
    - 'note.type == "section"'
    - 'file.inFolder("10 Recintos/Caja Mágica")'
views:
  - type: table
    name: Secciones
    order:
      - file.name
      - note.zone
      - note.level
      - note.kind
```
