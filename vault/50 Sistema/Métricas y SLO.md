---
tags:
  - sistema
---

# Métricas y SLO

Cada operación mide latencia por etapa (p50, p95, p99, p99,9, máximo) y contadores.

| Etapa | Tipo | Qué mide |
|---|---|---|
| Normalización | interna | inventario → candidatos |
| Decisión | interna | filtro + ranking para una cuenta |
| Asignación | interna | reservar / confirmar / liberar |
| Journal | interna | confirmar un lote en disco |
| Leer inventario, Añadir al carrito, Leer carrito, Sesión, Cola | externa | llamadas al proveedor |
| Espera en cola | externa | de entrar en la cola a pasar |
| Respuesta humana | externa | de crear una tarea a responderla |

## SLO internos (gate [[Production gates|G3]])

- Decisión **p99 ≤ 5 ms** con 2.000 candidatos (medido: ~0,3 ms).
- Asignación **p99 ≤ 1 ms** (medido: ~0,05 ms).

Lo externo no depende del sistema; se mide para saber dónde se va el tiempo.

```powershell
npm run bench    # latencia con 100–10.000 candidatos y operaciones completas simuladas
```
