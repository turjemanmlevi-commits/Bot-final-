---
tags:
  - sistema
---

# Asignación y límites

Código: `server/src/domain/allocation.ts` y `limits.ts`.

## Invariantes (nunca se rompen)

- en carrito + en vuelo ≤ cantidad pedida
- usado por la cuenta ≤ límite por cuenta
- usado por el grupo ≤ límite por grupo
- comprometido + reservado ≤ presupuesto
- precio reservado ≤ precio máximo vigente

El gate [[Production gates|G2]] lo comprueba en cada paso de decenas de simulaciones.

## Grupo de límite según el evento

| Semántica | El grupo es | Si falta el dato |
|---|---|---|
| `PER_ACCOUNT` | la propia cuenta | — |
| `PER_HOLDER` | el titular (`holderRef`) | la cuenta no se puede usar |
| `PER_HOUSEHOLD` | el hogar (`householdRef`) | la cuenta no se puede usar |
| `PER_PAYMENT_METHOD` | el medio de pago (`paymentRef`) | la cuenta no se puede usar |
| `UNKNOWN` | — | **no se puede armar** |

Ejemplo del evento de demo: 4 por titular. «Ana · principal» y «Ana · segunda» comparten esos 4.

**Capacidad legal** = min(pedida, tope por operación, Σ grupos min(límite de grupo, Σ límites de sus cuentas)). Se muestra al validar.

## El cupo es del evento

Los límites por cuenta y por grupo son del **evento**, no de cada operación: dos operaciones del mismo evento nunca dan a una cuenta o a un titular más que su límite. Al validar y al armar se suma lo que ya tienen las demás operaciones de ese evento:

- carritos activos, en revisión o pagados, y claims en vuelo o dudosos («No sé» sin comprobar);
- si la otra operación aún puede comprar (armada, en marcha, en pausa o en *Carrito asegurado*), también lo que su asignación le deja comprar, aunque todavía no haya comprado nada. La primera que se arma se queda con ese cupo.

La asignación arranca con lo que queda. Si a una cuenta no le queda cupo (o le queda menos que el grupo mínimo), al validar sale un aviso y al armar un error `EVENT_QUOTA_USED` con el nombre de la operación que lo tiene. Lo liberado, caducado o rechazado no cuenta. Para recuperar ese cupo: cierra o cancela la otra operación, o libera en *Carritos* lo que no se vaya a pagar.

## Operaciones sobre la asignación

| Paso | Cuándo |
|---|---|
| `RESERVE` | antes de enviar un claim |
| `CONFIRM` | claim confirmado (cantidad y precio reales) |
| `RELEASE` | claim rechazado |
| `FREEZE` / `UNFREEZE` | claim ambiguo mientras se reconcilia |
| `COMMIT_EXTERNAL` | una persona marca como pagado un carrito que ya había caducado («Lo pagué a tiempo»): vuelve a contar |
| `UNCOMMIT` | carrito caducado o liberado con la operación aún viva (si estaba en *Carrito asegurado* y la ventana sigue abierta, vuelve a *En ejecución*; si la ventana ya terminó y no queda nada en carrito, queda *Finalizada*) |
| `SET_REQUESTED` / `SET_MAX_PRICE` | enmiendas (solo a la baja) |

Cada paso incrementa la versión, se guarda con su hash en el journal y el replay los vuelve a aplicar uno a uno.

## Reparto en asistencia manual

En cada ciclo, y en cuanto llega una respuesta, cada cuenta con «Sesión lista», sin kill switch y sin tarea abierta recibe una tarea de su zona actual con `min(lo que le cabe a la cuenta y a su grupo, lo que falta, lo que permite el presupuesto al precio máximo)`. Si con esa cantidad lo que queda sin asignar fuera mayor que 0 pero menor que el grupo mínimo, la tarea se reduce para dejar un grupo mínimo completo a otra cuenta, siempre que ella misma siga llegando al grupo mínimo. Así varias personas compran a la vez: 4 entradas, límite 3 por persona y grupo mínimo 2 → **2 + 2**, no 3 + 1. Una tarea por debajo del grupo mínimo no se crea.

La zona actual de cada cuenta sale de su último claim en la operación: si acabó rechazado («No pude» o «no está» al verificar) pasa a la siguiente zona; si no, sigue en la misma. Así una pausa, un kill switch, un carrito perdido o un reinicio del servidor no devuelven a nadie a una zona que ya descartó.

Si se baja el precio máximo o la cantidad, se avisa a todas las personas de la operación con el plan nuevo («plan cambiado»).
