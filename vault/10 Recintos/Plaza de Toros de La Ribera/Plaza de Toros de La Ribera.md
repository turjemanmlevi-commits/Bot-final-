---
type: "venue"
id: "plaza-de-toros-de-la-ribera"
name: "Plaza de Toros de La Ribera"
city: "Logroño"
capacity: 11000
aliases:
  - "La Ribera"
  - "Plaza de toros de Logroño"
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

# Plaza de Toros de La Ribera

**Logroño** · 11.000 localidades. Plaza de toros cubierta que acoge conciertos.

## Cómo leer el plano

- **Ruedo**: de pie delante del escenario (*Front Stage* y *General*).
- **Tendido** (abajo), **Grada** (medio) y **Andanada** (arriba): sentado.
- **Izquierda / Central / Derecha**: según se mira al escenario.

## Zonas

- [[10 Recintos/Plaza de Toros de La Ribera/Zonas/Ruedo|Ruedo]] — Pista de pie en el ruedo, delante del escenario.
- [[10 Recintos/Plaza de Toros de La Ribera/Zonas/Tendido|Tendido]] — Primeros asientos, junto al ruedo.
- [[10 Recintos/Plaza de Toros de La Ribera/Zonas/Grada|Grada]] — Nivel intermedio.
- [[10 Recintos/Plaza de Toros de La Ribera/Zonas/Andanada|Andanada]] — Nivel más alto.

> [!info] Plano orientativo
> Gradas, niveles y zonas para coordinar la compra y enseñar al cliente dónde irá. Sectores, filas y asientos exactos: en el plano oficial de cada venta.

Fuente: Aforo según en.wikipedia.org/wiki/List_of_indoor_arenas_in_Spain (consultado el 29-09-2026). Ruedo y tendidos: estructura orientativa de una plaza de toros en formato concierto; sectores, filas y asientos exactos: en el plano oficial de cada venta.

## Secciones

```base
filters:
  and:
    - 'note.type == "section"'
    - 'file.inFolder("10 Recintos/Plaza de Toros de La Ribera")'
views:
  - type: table
    name: Secciones
    order:
      - file.name
      - note.zone
      - note.level
      - note.kind
```
