---
tags:
  - sistema
---

# Dashboard

Sala de control en <http://localhost:8787> (o <http://localhost:5173> con `npm run dev:dashboard`). Se actualiza en tiempo real por SSE.

| Sección | Para qué |
|---|---|
| **Resumen** | Operación en foco con el tablero de cuenta atrás a T0, la línea de estados, progreso y presupuesto; carritos por pagar; alertas |
| **Operaciones** | Lista, alta/edición y detalle: en directo (cuentas, colas, inventario, descartes, latencias, decisiones, claims), preparación (validación, readiness, política, snapshot), carritos, historial y replay |
| **Tareas humanas** | Lo que te toca hacer a ti, con formularios de respuesta |
| **Carritos** | Cuenta atrás de caducidad, abrir carrito, marcar pagado o liberar |
| **Alertas** | Todas, con sus acciones |
| **Cuentas** | Alta de cuentas (solo alias), sesiones, colas, kill switch por cuenta |
| **Eventos** | Catálogo del vault con sus límites |
| **Recintos · vault** | Estado de la compilación, secciones con aliases y probador de etiquetas |
| **Seguridad** | Kill switches, circuitos y guardarraíles |
| **Calidad · gates** | Ejecutar G0–G6 y ver el informe |
| **Auditoría** | El journal filtrable |

Arriba a la derecha: **quién opera** (se guarda en la auditoría de cada acción) y el tema claro/oscuro.

Diseño: monocromo; el color solo aparece cuando significa algo (estado o dato). El tablero de salidas marca la cuenta atrás a T0 y la línea de metro, el estado de la operación.
