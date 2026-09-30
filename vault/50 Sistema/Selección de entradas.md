---
tags:
  - sistema
---

# Selección de entradas

Código: `server/src/domain/decision.ts` (función **pura**).

## 1. Normalización del inventario

Cada oferta del proveedor se convierte en un **candidato**: la etiqueta cruda se resuelve a una sección del vault (ver [[Cómo funciona el vault#Aliases: la pieza clave]]), se calculan contigüidad, visión reducida, accesibilidad y **ambigüedad**, y se descartan duplicados.

## 2. Filtro de política (en este orden, el primer motivo cuenta)

| Motivo | Cuándo |
|---|---|
| Datos inválidos | cantidades o precio imposibles |
| Moneda distinta | no coincide con la operación |
| Sección no resuelta | la etiqueta no está en el vault |
| Sección cerrada | override del evento |
| Sección excluida | la operación la excluye |
| Fuera de objetivos | no está entre las zonas/secciones pedidas |
| Demasiado ambiguo | ambigüedad > máxima de la operación |
| De pie no permitido | si la operación no admite pie |
| Visión reducida | si no se admite |
| Plaza accesible reservada | salvo `allowAccessible` |
| No contiguos | si se exigen juntos y no lo son (o no se sabe) |
| Precio por encima del máximo | precio con gastos > máximo vigente |

## 3. Por cuenta

Se descartan los candidatos **en vuelo** (otra cuenta ya los está pidiendo) y los que el proveedor rechazó hace poco. La cantidad se ajusta a: cupo de la cuenta, cupo de su grupo, lo que queda de la operación y el presupuesto. Si no llega al **grupo mínimo**, se descarta.

## 4. Ranking lexicográfico (menor es mejor)

1. **Déficit de cobertura** — cuánto se queda sin cubrir de lo que la cuenta puede pedir.
2. **Rango objetivo** — posición de la sección en las preferencias.
3. **Penalización de agrupación** — 0 juntos o de pie, 1 desconocido, 2 separados.
4. **Precio** unitario.
5. **Ambigüedad**.
6. **Id del candidato** — desempate determinista.

Se registra la elegida, las 3 mejores alternativas y el recuento de descartes por motivo: cada decisión es **explicable** (dashboard → Decisiones del motor) y **reproducible** ([[Replay y auditoría]]).

## Rendimiento

El filtro de política se calcula una vez por snapshot y se reutiliza para todas las cuentas. Si ni el inventario, ni la asignación, ni el overlay han cambiado, no se vuelve a decidir (el resultado sería idéntico). Ver [[Métricas y SLO]].
