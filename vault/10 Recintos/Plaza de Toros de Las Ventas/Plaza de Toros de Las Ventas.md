---
type: "venue"
id: "plaza-de-toros-de-las-ventas"
name: "Plaza de Toros de Las Ventas"
city: "Madrid"
aliases:
  - "Las Ventas"
  - "Monumental de Las Ventas"
source: "Plaza de toros de Madrid. Ruedo y tendidos: estructura orientativa de una plaza de toros en formato concierto; sectores, filas y asientos exactos: en el plano oficial de cada venta."
verifiedAt: "2026-09-29"
verifiedBy: "asistente"
confidence: 0.7
tags:
  - "recinto"
  - "real"
  - "plaza-de-toros"
  - "conciertos"
---

# Plaza de Toros de Las Ventas

**Madrid**. Plaza de toros que acoge grandes conciertos. Plaza de toros que acoge grandes conciertos (aforo de casi 24.000 localidades en toros).

## Cómo leer el plano

- **Ruedo**: de pie delante del escenario (*Front Stage* y *General*).
- **Tendido** (abajo), **Grada** (medio) y **Andanada** (arriba): sentado.
- **Izquierda / Central / Derecha**: según se mira al escenario.

## Zonas

- [[10 Recintos/Plaza de Toros de Las Ventas/Zonas/Ruedo|Ruedo]] — Pista de pie en el ruedo, delante del escenario.
- [[10 Recintos/Plaza de Toros de Las Ventas/Zonas/Tendido|Tendido]] — Primeros asientos, junto al ruedo.
- [[10 Recintos/Plaza de Toros de Las Ventas/Zonas/Grada|Grada]] — Nivel intermedio.
- [[10 Recintos/Plaza de Toros de Las Ventas/Zonas/Andanada|Andanada]] — Nivel más alto.

> [!info] Plano orientativo
> Gradas, niveles y zonas para coordinar la compra y enseñar al cliente dónde irá. Sectores, filas y asientos exactos: en el plano oficial de cada venta.

Fuente: Plaza de toros de Madrid. Ruedo y tendidos: estructura orientativa de una plaza de toros en formato concierto; sectores, filas y asientos exactos: en el plano oficial de cada venta.

## Secciones

```base
filters:
  and:
    - 'note.type == "section"'
    - 'file.inFolder("10 Recintos/Plaza de Toros de Las Ventas")'
views:
  - type: table
    name: Secciones
    order:
      - file.name
      - note.zone
      - note.level
      - note.kind
```
