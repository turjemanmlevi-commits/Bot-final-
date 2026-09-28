---
tags:
  - sistema
  - seguridad
---

# Kill switches y circuitos

## Kill switches

Parada inmediata por ámbito: **global**, **proveedor**, **operación** o **cuenta**.

- El gateway los comprueba **antes de cada llamada** al proveedor: aunque un runner tuviera un fallo, la llamada no sale.
- Global, proveedor u operación: las operaciones afectadas pasan a *Pausada* en el siguiente tick (≤ 50 ms).
- Cuenta: solo esa cuenta deja de actuar; el resto sigue.
- No se puede armar ni reanudar con un kill switch aplicable activo.
- Dashboard → Seguridad; Telegram `/parar_todo`.

## Circuit breakers

Uno por proveedor y capability (`sim:cart.add`, `sim:inventory.read`…).

| Estado | Cuándo |
|---|---|
| Cerrado | normal |
| Abierto | tras **5 fallos seguidos** (timeouts, rate limits); se deja enfriar **5 s** |
| Probando | tras el enfriamiento pasa **una** llamada de prueba: si va bien se cierra, si falla se reabre |
| Abierto con reinicio manual | **cambio de esquema** en las respuestas: no se reabre solo, lo revisa una persona |

«No has pasado la cola» o «sesión caducada» no cuentan como fallos del proveedor: son estados que se respetan.
