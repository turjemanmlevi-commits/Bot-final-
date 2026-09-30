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
| Tarea manual | Caduca a los 30 min por defecto (`MANUAL_TASK_MINUTES`); sin respuesta = ambiguo → verificación |
| Reparto manual | En paralelo: cada tarea pide a una cuenta lo que le cabe (hasta su cupo, lo que quede y el presupuesto), pero deja lo que falta en 0 o en al menos un grupo mínimo para otra cuenta (4, límite 3, grupo 2 → 2 + 2). Tras cada respuesta se reparte al momento |
| Sesión en asistencia manual | Cada compra exige «Sesión lista»: al armar, las cuentas vuelven a *Sin sesión* y reciben una tarea «Inicia sesión» nueva con el plan |
| Cuenta parada | Solo avisa en el readiness; la operación arranca en T0 con el resto. Los kill switches global, de proveedor y de operación sí la bloquean |
| Caducidad de carritos | Avisos a 300/120/60 s por defecto. Un carrito confirmado por una persona no caduca solo: al agotarse el tiempo se pregunta «¿lo has pagado?» (pagado o liberado). Si se libera (o caduca, en el simulador) con la operación viva, esa cantidad se vuelve a repartir; en *Carrito asegurado* con la ventana abierta, la operación vuelve a *En ejecución* |
| SLO | Decisión p99 ≤ 5 ms (2.000 candidatos); asignación p99 ≤ 1 ms |
| Gates G0–G6 | Definidos en [[Production gates]] |
| Máximo de cuentas | 10 por operación |
