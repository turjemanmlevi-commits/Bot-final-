---
type: provider
id: manual
name: Asistencia manual
mode: MANUAL_ASSIST
authorizedCapabilities: []
source: "Modo sin automatización contra el proveedor"
verifiedAt: 2026-09-28
tags:
  - proveedor
---

# Asistencia manual

Modo para cualquier ticketera real **sin API autorizada**. El sistema no se conecta al proveedor: cada acción la hace una persona desde su propia cuenta y el sistema coordina.

- Abre **tareas humanas** por cuenta: abrir sesión, añadir X entradas de una sección con precio máximo, verificar el carrito.
- Cada persona responde desde el dashboard (o Telegram): *en carrito*, *falló* o *no sé*.
- El sistema lleva la cuenta de límites, presupuesto y caducidad de carritos, y decide cuál es la siguiente mejor sección para cada cuenta.

Ninguna capability está autorizada para automatización (`authorizedCapabilities: []`). Ver [[Uso legítimo y guardarraíles]].
