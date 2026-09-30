---
type: "venue"
id: "la-cubierta-de-leganes"
name: "La Cubierta de Leganés"
city: "Leganés"
capacity: 10000
aliases:
  - "La Cubierta"
  - "Plaza de toros La Cubierta"
source: "Aforo según en.wikipedia.org/wiki/List_of_indoor_arenas_in_Spain (consultado el 29-09-2026). Ruedo y tendidos: estructura orientativa de una plaza de toros en formato concierto; sectores, filas y asientos exactos: en el plano oficial de cada venta."
verifiedAt: "2026-09-29"
verifiedBy: "asistente"
confidence: 0.7
tags:
  - "recinto"
  - "real"
  - "plaza-de-toros"
  - "conciertos"
---

# La Cubierta de Leganés

**Leganés** · 10.000 localidades. Plaza de toros cubierta que acoge conciertos.

## Cómo leer el plano

- **Ruedo**: de pie delante del escenario (*Front Stage* y *General*).
- **Tendido** (abajo), **Grada** (medio) y **Andanada** (arriba): sentado.
- **Izquierda / Central / Derecha**: según se mira al escenario.

## Zonas

- [[10 Recintos/La Cubierta de Leganés/Zonas/Ruedo|Ruedo]] — Pista de pie en el ruedo, delante del escenario.
- [[10 Recintos/La Cubierta de Leganés/Zonas/Tendido|Tendido]] — Primeros asientos, junto al ruedo.
- [[10 Recintos/La Cubierta de Leganés/Zonas/Grada|Grada]] — Nivel intermedio.
- [[10 Recintos/La Cubierta de Leganés/Zonas/Andanada|Andanada]] — Nivel más alto.

> [!info] Plano orientativo
> Gradas, niveles y zonas para coordinar la compra y enseñar al cliente dónde irá. Sectores, filas y asientos exactos: en el plano oficial de cada venta.

Fuente: Aforo según en.wikipedia.org/wiki/List_of_indoor_arenas_in_Spain (consultado el 29-09-2026). Ruedo y tendidos: estructura orientativa de una plaza de toros en formato concierto; sectores, filas y asientos exactos: en el plano oficial de cada venta.

## Secciones

```base
filters:
  and:
    - 'note.type == "section"'
    - 'file.inFolder("10 Recintos/La Cubierta de Leganés")'
views:
  - type: table
    name: Secciones
    order:
      - file.name
      - note.zone
      - note.level
      - note.kind
```
