---
tags:
  - sistema
  - seguridad
---

# Kill switches y circuitos

## Kill switches

Parada inmediata por ámbito: **global**, **proveedor**, **operación** o **cuenta**.

- El gateway los comprueba **antes de cada llamada** al proveedor: aunque un runner tuviera un fallo, la llamada no sale.
- Global, proveedor u operación: las operaciones afectadas en marcha pasan a *Pausada* al instante. No se puede armar ni reanudar con uno activo, y si sigue activo en T0 el [[Readiness]] da FAIL y la operación termina sin arrancar.
- Cuenta («Parar cuenta» en *Cuentas*): solo esa cuenta deja de actuar; el resto sigue. No impide armar ni reanudar, y en T0 el [[Readiness]] solo avisa («Cuentas paradas (no participarán)»): la operación arranca con las demás. En asistencia manual esa cuenta no recibe tareas nuevas; una tarea que ya tuviera abierta sigue abierta con su reserva hasta que se responda o caduque.
- Dashboard → Seguridad (y *Cuentas* para las de cuenta); Telegram `/parar_todo`.

## Circuit breakers

Uno por proveedor y capability (`sim:cart.add`, `sim:inventory.read`…).

| Estado | Cuándo |
|---|---|
| Cerrado | normal |
| Abierto | tras **5 fallos seguidos** (timeouts, rate limits); se deja enfriar **5 s** |
| Probando | tras el enfriamiento pasa **una** llamada de prueba: si va bien se cierra, si falla se reabre |
| Abierto con reinicio manual | **cambio de esquema** en las respuestas: no se reabre solo, lo revisa una persona |

«No has pasado la cola» o «sesión caducada» no cuentan como fallos del proveedor: son estados que se respetan.
