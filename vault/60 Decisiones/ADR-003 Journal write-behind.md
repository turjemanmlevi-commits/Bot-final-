---
type: adr
status: aceptada
date: 2026-09-28
tags:
  - decision
---

# ADR-003 · Journal write-behind con PGlite por defecto

## Contexto

La auditoría es obligatoria, pero esperar a disco en cada paso del camino caliente añade milisegundos cuando más importan. Además el sistema tiene que funcionar en un Windows sin instalar una base de datos.

## Decisión

- Estado caliente en memoria; cada cambio se **encola** y se confirma en lotes cada 20 ms.
- Driver por defecto **PGlite** (Postgres compilado a WASM, en `data/pglite`); `JOURNAL_DRIVER=postgres` + `DATABASE_URL` para un Postgres real; `memory` para tests y gates.
- Si la persistencia falla: journal «degradado», alerta crítica y **pausa** de la automatización. Los cambios pendientes se reintentan.
- Al reiniciar, las operaciones que estaban en marcha pasan a *Recuperando* y sus claims en vuelo se reconcilian antes de seguir.

## Consecuencias

- La latencia interna no depende del disco (gate G3).
- Una única instancia del servidor por carpeta de datos (PGlite no admite dos procesos).
