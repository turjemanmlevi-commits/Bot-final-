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

## Operaciones sobre la asignación

| Paso | Cuándo |
|---|---|
| `RESERVE` | antes de enviar un claim |
| `CONFIRM` | claim confirmado (cantidad y precio reales) |
| `RELEASE` | claim rechazado |
| `FREEZE` / `UNFREEZE` | claim ambiguo mientras se reconcilia |
| `COMMIT_EXTERNAL` | entradas registradas por una persona |
| `UNCOMMIT` | carrito caducado o liberado con la operación aún viva |
| `SET_REQUESTED` / `SET_MAX_PRICE` | enmiendas (solo a la baja) |

Cada paso incrementa la versión, se guarda con su hash en el journal y el replay los vuelve a aplicar uno a uno.
