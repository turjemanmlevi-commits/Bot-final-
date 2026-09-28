---
type: adr
status: aceptada
date: 2026-09-28
tags:
  - decision
---

# ADR-001 · El vault de Obsidian es la fuente de Venue Intelligence

## Contexto

La información de recintos (zonas, secciones, cómo las etiqueta cada ticketera, visión, accesibilidad) la mantienen personas, cambia poco y necesita contexto (fuente, fecha, confianza). Además queremos poder leerla y editarla cómodamente.

## Decisión

Los recintos, eventos y proveedores viven como notas de Obsidian con frontmatter. Un compilador las convierte en artefactos con **hash de contenido** que el servidor usa. El servidor vigila el vault y recompila al guardar; si una nota queda inválida, mantiene la última compilación válida.

## Consecuencias

- Editar datos = editar notas; Obsidian da enlaces, vistas (Bases), grafo y plantillas gratis.
- Cada operación armada congela el hash: la edición posterior no la afecta y el replay sigue siendo exacto.
- Los errores de escritura se ven en el dashboard con el fichero y el motivo.
- Las cuentas **no** están en el vault (no deben ir a git): viven en el servidor y solo como alias.
