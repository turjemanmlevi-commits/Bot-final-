---
tags:
  - sistema
---

# Readiness

Se evalúa al armar (a los 3 s, cuando las sesiones han empezado a abrirse), automáticamente en **T−12 h, T−1 h y T−5 min**, en **T0** y cuando lo pides (botón *Readiness*).

| Comprobación | FAIL si… | WARN si… |
|---|---|---|
| Límites del evento | sin verificar o semántica desconocida | — |
| Recinto compilado | no hay artefacto | confianza < 0,6 |
| Proveedor | no hay adapter o no se puede añadir al carrito | — |
| Circuitos | alguno abierto | alguno probando |
| Kill switches | alguno aplicable activo | — |
| Journal | no guarda | está en memoria (sin persistencia) |
| Telegram | — | configurado pero sin conexión |
| Reloj del proveedor | desfase > 2 s | desfase > 250 ms (se compensa) |
| Sesión de cada cuenta | — | no está lista (acción: abrir sesión) |
| Cuentas listas | ninguna lista en la última fase | alguna sin lista |

El resultado global es el peor. **En T0, si es FAIL, la operación termina** (`READINESS_FAILED`): mejor no comprar que comprar mal. Ver [[Checklist de readiness]].
