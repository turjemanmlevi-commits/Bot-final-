---
type: adr
status: aceptada
date: 2026-09-28
tags:
  - decision
---

# ADR-002 · Motor de decisión puro, determinista y reproducible

## Contexto

En T0 todo pasa en segundos. Después hay que poder explicar por qué se compró lo que se compró (o por qué no), y verificar que el sistema no se saltó ninguna regla.

## Decisión

- La decisión es una **función pura** de: snapshot de inventario normalizado, política compilada, capacidad, precio máximo vigente y overlay.
- Las preferencias humanas se compilan a IDs **antes** de T0; durante la ejecución no hay interpretación libre.
- Ranking lexicográfico con desempate por id: el orden del inventario no influye.
- Todo lo que alimenta cada decisión se guarda en el journal; el replay lo re-ejecuta y compara.
- El reloj es inyectable: los gates simulan operaciones completas con reloj virtual.

## Consecuencias

- Replay 100 % (gate G4) y corrección frente a un oráculo (gate G1).
- Como el resultado es puro, si nada cambia no se vuelve a decidir: menos ruido en el journal.
