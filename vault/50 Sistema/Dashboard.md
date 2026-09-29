---
tags:
  - sistema
---

# Dashboard

Sala de control en <http://localhost:8787> (o <http://localhost:5173> con `npm run dev:dashboard`). Se actualiza en tiempo real por SSE.

| Sección | Para qué |
|---|---|
| **Resumen** | Operación en foco con el tablero de cuenta atrás a T0, la línea de estados, progreso y presupuesto; carritos por pagar; alertas; lista **Compra real · lista de comprobación** (cuentas, evento con enlace y límites, recinto, operación armada, Telegram) |
| **Operaciones** | Lista, alta/edición y detalle: en directo (cuentas, colas, inventario, descartes, latencias, decisiones, claims), preparación (validación, readiness, política, snapshot), carritos, historial y replay |
| **Tareas humanas** | Lo que te toca hacer a ti, con formularios de respuesta y el botón **Abrir la web oficial** cuando la tarea tiene enlace |
| **Carritos** | Cuenta atrás de caducidad, abrir carrito, marcar pagado o liberar |
| **Alertas** | Todas, con sus acciones |
| **Cuentas** | Alta de cuentas (solo alias), sesiones, colas, kill switch por cuenta |
| **Eventos** | Catálogo del vault con sus límites. **Nuevo evento** y **Editar** escriben la nota en `20 Eventos/` (enlace oficial, fechas en hora de Madrid, límites y su fuente) |
| **Recintos · vault** | Estado de la compilación, secciones con aliases y probador de etiquetas. **Nuevo recinto** crea `10 Recintos/<nombre>/` con zonas y secciones (formato abajo) |
| **Seguridad** | Kill switches, circuitos y guardarraíles |
| **Calidad · gates** | Ejecutar G0–G6 y ver el informe |
| **Auditoría** | El journal filtrable |
| **Ajustes · Telegram** | Estado del bot, **Enviar mensaje de prueba**, chats que han escrito al bot (con su chat ID), proveedores y datos del sistema |

Formato de **Nuevo recinto**: una zona por línea, con sus secciones tras «:» separadas por comas; «(de pie)» marca la zona como de pie; una zona sin secciones tiene una única sección con su nombre; si una sección se repite en varias zonas se le antepone la zona.

```
Lateral Este: Grada baja, Primer anfiteatro, Segundo anfiteatro
Pista (de pie)
Grada Alta: 201, 202, 203
```

Arriba a la derecha: **quién opera** (se guarda en la auditoría de cada acción) y el tema claro/oscuro.

Diseño: monocromo; el color solo aparece cuando significa algo (estado o dato). El tablero de salidas marca la cuenta atrás a T0 y la línea de metro, el estado de la operación.
