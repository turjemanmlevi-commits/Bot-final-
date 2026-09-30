---
tags:
  - sistema
---

# Replay y auditoría

## Journal

Registro **append-only** con número de secuencia, hora, operación, tipo, quién y datos. Se escribe en segundo plano (write-behind, lotes cada 20 ms) en **PGlite** (Postgres embebido en `data/pglite`, sin instalar nada), en Postgres (`DATABASE_URL`) o en memoria. Ver [[ADR-003 Journal write-behind]].

Si no puede guardar, se marca como degradado y **la automatización se pausa**.

## Qué se guarda para reproducir

| Evento | Contenido |
|---|---|
| `operation.armed` | el snapshot completo (configuración, política, hash del recinto, límites, capabilities) |
| `inventory.snapshot` | los candidatos normalizados (solo los que se usaron para decidir) |
| `decision.recorded` | la decisión y su entrada exacta: snapshot, política (hash), hora, capacidad, overlay |
| `allocation.init` / `allocation.step` | estado inicial y cada paso con su hash |

## Replay

Vuelve a ejecutar cada decisión y cada paso de asignación y compara: mismo candidato, misma cantidad, mismas alternativas, mismos descartes, mismo hash. Dashboard → operación → **Replay**, o:

```powershell
npm run replay -- <id de la operación>
```

El gate [[Production gates|G4]] lo exige al 100 %.
