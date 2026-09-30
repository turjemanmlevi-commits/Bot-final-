---
type: "venue"
id: "estadi-olimpic-lluis-companys"
name: "Estadi Olímpic Lluís Companys"
city: "Barcelona"
aliases:
  - "Estadi Olímpic"
  - "Estadio Olímpico de Barcelona"
  - "Olímpic de Montjuïc"
  - "Montjuïc"
source: "Estadio de conciertos de Barcelona (nombres habituales de sus gradas). Gradas y niveles: estructura orientativa con los nombres habituales del estadio; sectores, filas y asientos exactos: en el plano oficial de cada venta."
verifiedAt: "2026-09-29"
verifiedBy: "asistente"
confidence: 0.7
tags:
  - "recinto"
  - "real"
  - "estadio"
  - "conciertos"
---

# Estadi Olímpic Lluís Companys

**Barcelona**. Estadio de Montjuïc (Barcelona). El FC Barcelona jugó aquí de 2023 a 2025; hoy se usa sobre todo para grandes conciertos.

## Cómo leer el plano

- **Tribuna y Lateral**: gradas laterales, a lo largo del campo (la mejor vista del partido).
- **Gol Norte y Gol Sur**: detrás de las porterías. En conciertos el escenario suele ir en un fondo.
- **Niveles**, del campo hacia arriba: Grada baja, Grada alta.
- **Pista (conciertos)**: de pie sobre el césped. *Front Stage* = delante del escenario; *General* = detrás.

## Zonas

- [[10 Recintos/Estadi Olímpic Lluís Companys/Zonas/Pista (conciertos)|Pista (conciertos)]] — Solo en conciertos: de pie sobre el césped.
- [[10 Recintos/Estadi Olímpic Lluís Companys/Zonas/Tribuna|Tribuna]] — Grada principal, a lo largo del campo.
- [[10 Recintos/Estadi Olímpic Lluís Companys/Zonas/Lateral|Lateral]] — Grada lateral enfrente de la principal, a lo largo del campo.
- [[10 Recintos/Estadi Olímpic Lluís Companys/Zonas/Gol Norte|Gol Norte]] — Grada detrás de una de las porterías.
- [[10 Recintos/Estadi Olímpic Lluís Companys/Zonas/Gol Sur|Gol Sur]] — Grada detrás de una de las porterías.

> [!info] Plano orientativo
> Gradas, niveles y zonas para coordinar la compra y enseñar al cliente dónde irá. Sectores, filas y asientos exactos: en el plano oficial de cada venta.

Fuente: Estadio de conciertos de Barcelona (nombres habituales de sus gradas). Gradas y niveles: estructura orientativa con los nombres habituales del estadio; sectores, filas y asientos exactos: en el plano oficial de cada venta.

## Secciones

```base
filters:
  and:
    - 'note.type == "section"'
    - 'file.inFolder("10 Recintos/Estadi Olímpic Lluís Companys")'
views:
  - type: table
    name: Secciones
    order:
      - file.name
      - note.zone
      - note.level
      - note.kind
```
