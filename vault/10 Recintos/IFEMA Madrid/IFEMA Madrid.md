---
type: "venue"
id: "ifema-madrid"
name: "IFEMA Madrid"
city: "Madrid"
aliases:
  - "Feria de Madrid"
  - "IFEMA"
  - "Recinto Ferial Juan Carlos I"
source: "ifema.es. Zonas típicas de un festival (pista general, front stage y VIP según la venta); sectores, filas y asientos exactos: en el plano oficial de cada venta."
verifiedAt: "2026-09-29"
verifiedBy: "asistente"
confidence: 0.7
tags:
  - "recinto"
  - "real"
  - "festival"
  - "conciertos"
---

# IFEMA Madrid

**Madrid**. Recinto de grandes festivales y fiestas. Recinto ferial de Madrid: grandes fiestas, festivales y conciertos en sus pabellones y exteriores.

## Cómo leer el plano

- **Pista**: de pie. *Front Stage* = delante del escenario principal (si la venta lo ofrece); *General* = el resto del recinto.
- **VIP**: entrada VIP de pie (si la venta la ofrece).
- **Zona PMR**: plataforma accesible, solo para quien la necesite.

## Zonas

- [[10 Recintos/IFEMA Madrid/Zonas/Pista|Pista]] — Recinto de pie delante de los escenarios.
- [[10 Recintos/IFEMA Madrid/Zonas/VIP|VIP]] — Zona VIP (según la venta: acceso preferente, barra y aseos propios).
- [[10 Recintos/IFEMA Madrid/Zonas/Zona PMR|Zona PMR]] — Plataforma para personas con movilidad reducida.

> [!info] Plano orientativo
> Gradas, niveles y zonas para coordinar la compra y enseñar al cliente dónde irá. Sectores, filas y asientos exactos: en el plano oficial de cada venta.

Fuente: ifema.es. Zonas típicas de un festival (pista general, front stage y VIP según la venta); sectores, filas y asientos exactos: en el plano oficial de cada venta.

## Secciones

```base
filters:
  and:
    - 'note.type == "section"'
    - 'file.inFolder("10 Recintos/IFEMA Madrid")'
views:
  - type: table
    name: Secciones
    order:
      - file.name
      - note.zone
      - note.level
      - note.kind
```
