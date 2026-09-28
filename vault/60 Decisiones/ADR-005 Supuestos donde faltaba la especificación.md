---
type: adr
status: propuesta
date: 2026-09-28
tags:
  - decision
---

# ADR-005 · Supuestos tomados donde la especificación v4 no estaba disponible

La implementación parte del modelo de dominio de `shared/src/domain.ts` (que cita la spec v4). Donde el texto de la spec no estaba a mano, se tomaron estas decisiones. **Revísalas** y, si alguna no coincide con la spec, se cambia.

| Tema | Supuesto |
|---|---|
| Orden del ranking | El de `RankKey`: cobertura → rango → agrupación → precio → ambigüedad → id |
| Asientos «juntos» | Si se exigen y la contigüidad es desconocida, se descarta (fail-closed). De pie cuenta como juntos |
| Grupo mínimo | Nunca se compran menos entradas que el grupo mínimo, aunque sean las últimas |
| Readiness en T0 | FAIL en T0 → la operación termina (`READINESS_FAILED`) |
| Fases de readiness | T−12 h, T−1 h, T−5 min; si se arma tarde, solo la más reciente |
| Congelado | `freezeLeadSeconds` antes de T0 (por defecto 30 s) |
| Circuitos | 5 fallos seguidos, 5 s de enfriamiento; cambio de esquema = reinicio manual |
| Reconciliación | 4 intentos (0,4 → 3,2 s) y luego tarea humana |
| Tarea manual | Caduca a los 3 min; sin respuesta = ambiguo → verificación |
| Reparto manual | Cada tarea pide a una cuenta todo lo que le cabe (hasta su cupo y lo que quede) |
| Caducidad de carritos | Avisos a 300/120/60 s por defecto; si caduca con la operación viva, el cupo vuelve |
| SLO | Decisión p99 ≤ 5 ms (2.000 candidatos); asignación p99 ≤ 1 ms |
| Gates G0–G6 | Definidos en [[Production gates]] |
| Máximo de cuentas | 10 por operación |
