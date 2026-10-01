---
type: "venue"
id: "parc-del-forum"
name: "Parc del Fòrum"
city: "Barcelona"
aliases:
  - "Fòrum"
  - "Recinte Fòrum"
source: "primaverasound / en.wikipedia.org/wiki/Primavera_Sound_2026. Zonas típicas de un festival (pista general, front stage y VIP según la venta); sectores, filas y asientos exactos: en el plano oficial de cada venta."
verifiedAt: "2026-09-29"
verifiedBy: "asistente"
confidence: 0.7
tags:
  - "recinto"
  - "real"
  - "festival"
  - "conciertos"
---

# Parc del Fòrum

**Barcelona**. Recinto de grandes festivales y fiestas. Primavera Sound 2026 (junio) y otros grandes festivales.

## Cómo leer el plano

- **Pista**: de pie. *Front Stage* = delante del escenario principal (si la venta lo ofrece); *General* = el resto del recinto.
- **VIP**: entrada VIP de pie (si la venta la ofrece).
- **Zona PMR**: plataforma accesible, solo para quien la necesite.

## Zonas

- [[10 Recintos/Parc del Fòrum/Zonas/Pista|Pista]] — Recinto de pie delante de los escenarios.
- [[10 Recintos/Parc del Fòrum/Zonas/VIP|VIP]] — Zona VIP (según la venta: acceso preferente, barra y aseos propios).
- [[10 Recintos/Parc del Fòrum/Zonas/Zona PMR|Zona PMR]] — Plataforma para personas con movilidad reducida.

> [!info] Plano orientativo
> Gradas, niveles y zonas para coordinar la compra y enseñar al cliente dónde irá. Sectores, filas y asientos exactos: en el plano oficial de cada venta.

Fuente: primaverasound / en.wikipedia.org/wiki/Primavera_Sound_2026. Zonas típicas de un festival (pista general, front stage y VIP según la venta); sectores, filas y asientos exactos: en el plano oficial de cada venta.

## Secciones

```base
filters:
  and:
    - 'note.type == "section"'
    - 'file.inFolder("10 Recintos/Parc del Fòrum")'
views:
  - type: table
    name: Secciones
    order:
      - file.name
      - note.zone
      - note.level
      - note.kind
```
