---
type: "venue"
id: "kobetamendi"
name: "Kobetamendi"
city: "Bilbao"
aliases:
  - "Monte Kobetas"
  - "Kobeta"
source: "tourism.euskadi.eus y kulturklik.euskadi.eus (BBK Live 2026). Zonas típicas de un festival (pista general, front stage y VIP según la venta); sectores, filas y asientos exactos: en el plano oficial de cada venta."
verifiedAt: "2026-09-29"
verifiedBy: "asistente"
confidence: 0.7
tags:
  - "recinto"
  - "real"
  - "festival"
  - "conciertos"
---

# Kobetamendi

**Bilbao**. Recinto de grandes festivales y fiestas. Bilbao BBK Live 2026 (9 a 11 de julio).

## Cómo leer el plano

- **Pista**: de pie. *Front Stage* = delante del escenario principal (si la venta lo ofrece); *General* = el resto del recinto.
- **VIP**: entrada VIP de pie (si la venta la ofrece).
- **Zona PMR**: plataforma accesible, solo para quien la necesite.

## Zonas

- [[10 Recintos/Kobetamendi/Zonas/Pista|Pista]] — Recinto de pie delante de los escenarios.
- [[10 Recintos/Kobetamendi/Zonas/VIP|VIP]] — Zona VIP (según la venta: acceso preferente, barra y aseos propios).
- [[10 Recintos/Kobetamendi/Zonas/Zona PMR|Zona PMR]] — Plataforma para personas con movilidad reducida.

> [!info] Plano orientativo
> Gradas, niveles y zonas para coordinar la compra y enseñar al cliente dónde irá. Sectores, filas y asientos exactos: en el plano oficial de cada venta.

Fuente: tourism.euskadi.eus y kulturklik.euskadi.eus (BBK Live 2026). Zonas típicas de un festival (pista general, front stage y VIP según la venta); sectores, filas y asientos exactos: en el plano oficial de cada venta.

## Secciones

```base
filters:
  and:
    - 'note.type == "section"'
    - 'file.inFolder("10 Recintos/Kobetamendi")'
views:
  - type: table
    name: Secciones
    order:
      - file.name
      - note.zone
      - note.level
      - note.kind
```
