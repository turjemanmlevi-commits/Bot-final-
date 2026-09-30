---
tags:
  - operaciones
  - alertas
---

# Qué hacer con cada alerta

| Alerta | Qué significa | Qué hacer |
|---|---|---|
| **Reto de sesión** | El proveedor pide CAPTCHA / SMS / 2FA | Entra con esa cuenta, resuélvelo y pulsa *Sesión lista* |
| **Sesión caducada** | El proveedor cerró la sesión | En el simulador, el sistema intenta reabrir; si pide reto, resuélvelo. En asistencia manual, vuelve a iniciar sesión en la web oficial y pulsa *Sesión lista* |
| **Sesión no lista** | La web bloqueó la cuenta o dice que ya alcanzó su límite | Esa cuenta deja de participar. Revísala en la web oficial (¿compras previas?) |
| **Problema de cola** | La cola caducó o se bloqueó para esa cuenta | Vuelve a entrar en la cola con esa cuenta si procede |
| **Carrito confirmado** | Entradas en un carrito | En asistencia manual, **paga ya** en la web oficial (los carritos caducan en minutos) y pulsa *Ya lo he pagado* |
| **Carrito asegurado** | Toda la cantidad está en carritos | **Paga cada carrito ya**. Si luego se libera un carrito y la ventana sigue abierta, la operación vuelve a *En ejecución* y reparte lo que falta |
| **Carrito a punto de caducar** («el carrito caduca a las…») | Queda poco del tiempo indicado (solo si se indicaron los minutos del carrito; avisos a 5, 2 y 1 min por defecto) | Paga y pulsa *Ya lo he pagado*. Si la web te da más tiempo, **⏱ Quedan N min** en Telegram o *Minutos que quedan* en *Carritos*. Si no lo quieres, libéralo |
| **Carrito a punto de caducar** («…: se acabó el tiempo del carrito, ¿lo has pagado?») | Se agotó el tiempo que indicó una persona. Es una estimación: el carrito **no** caduca solo y sigue contando | **Ya lo he pagado** si se pagó; **⏱ Quedan N min** / *Minutos que quedan* si la web aún da tiempo; **Liberar** en *Carritos* si se perdió (esas entradas se vuelven a repartir) |
| **Carrito caducado** | Solo en el simulador: el proveedor lo liberó y se perdieron esas entradas | Si la operación sigue viva, esa cantidad se vuelve a repartir. Si en realidad lo pagaste a tiempo, *Ya lo he pagado* en *Carritos* («Lo pagué a tiempo») y vuelve a contar |
| **Carrito a revisar** | Precio o cantidad no cuadran con lo pedido | Ábrelo y decide antes de pagar |
| **Resultado ambiguo** | No se sabe si entró (timeout, «No sé» o tarea caducada) | En el simulador se reconcilia solo leyendo el carrito. En asistencia manual llega la tarea «¿Están las N entradas de … en el carrito?» |
| **Reconciliación manual** | No se pudo confirmar automáticamente | Mira el carrito en la web oficial y responde la tarea *Verificar carrito* («¿Están las N entradas…?») |
| **Circuito abierto** | El proveedor falla repetidamente | Se reintenta solo; si pide reinicio manual, revisa y reinicia en Seguridad |
| **Cambio de esquema** | El proveedor cambió el formato de sus respuestas | La operación se pausa. Revisa el adapter antes de continuar |
| **Limitado por el proveedor** | Rate limit | Se espera y se reintenta solo |
| **Readiness fallido / con avisos** | Algo no está listo antes de T0 | Arregla lo que indique cada comprobación |
| **Kill switch** | Alguien activó una parada | Global, de proveedor o de operación: suéltalo en *Seguridad* cuando proceda, mejor antes de T0: con uno de estos activo en T0 la operación queda en pausa sin arrancar hasta que lo sueltes y pulses *Reanudar*. De una cuenta («Parar cuenta»): solo esa cuenta deja de recibir tareas; la operación arranca y sigue con las demás. Se suelta en *Cuentas* |
| **Journal degradado** | No se está guardando la auditoría | La automatización se pausa hasta que se recupere |
| **Sin progreso** | Un rato sin nuevas entradas (en asistencia manual, el plazo de una tarea: 30 min por defecto) | ¿Precio máximo demasiado bajo? ¿Zonas agotadas? ¿Cuentas en cola? |
| **Operación finalizada** | Terminó la ventana, se paró o se cerraron todos los carritos | Paga los carritos que quieras conservar y pulsa *Cerrar* |
| **Recuperación necesaria** | El servidor se reinició con la operación en marcha | Responde las tareas de compra que estaban abiertas (y las verificaciones que aparezcan): después la operación vuelve sola a *En ejecución* |
| **Tarea humana** | Hace falta una persona | Ve a *Tareas humanas* (en Telegram la tarea llega con sus botones, sin alerta aparte) |

Las alertas se **agrupan**: el mismo problema no se repite, se actualiza (y sube de gravedad si empeora).
