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
| Kill switches | global, de proveedor o de la operación activo | solo hay cuentas paradas («Cuentas paradas (no participarán)»): esas cuentas no reciben tareas y el resto sigue |
| Journal | no guarda | está en memoria (sin persistencia) |
| Telegram | — | configurado pero sin conexión |
| Reloj del proveedor | desfase > 2 s (solo si el reloj se mide automáticamente) | desfase > 250 ms (se compensa) |
| Sesión de cada cuenta | — | no está lista (acción: abrir sesión) o bloqueada por el proveedor |
| Cuentas listas | la operación no tiene cuentas; o, con proveedor automatizado (simulador), ninguna lista en la última fase (T−5 min, T0 o una comprobación a mano a menos de 5 min de T0) | alguna sin lista. **En asistencia manual solo avisa**, aunque no haya ninguna lista: quien pulse «Sesión lista» después de T0 recibe su tarea al momento |

El resultado global es el peor. **En T0, si es FAIL, la operación termina** (`READINESS_FAILED`): mejor no comprar que comprar mal. Si el FAIL viene de un kill switch global, de proveedor o de la operación, en cambio, queda **en pausa sin arrancar**: al soltarlo, *Reanudar* repite el readiness y arranca. En asistencia manual, ni las sesiones sin «Sesión lista» ni una cuenta parada («Parar cuenta») dan FAIL: la operación arranca con las cuentas que haya. Ver [[Checklist de readiness]].
