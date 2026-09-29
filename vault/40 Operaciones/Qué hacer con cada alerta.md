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
| **Carrito asegurado** | Toda la cantidad está en carritos | **Paga cada carrito ya** |
| **Carrito a punto de caducar** | Queda poco para que el proveedor lo libere (solo si se indicaron los minutos del carrito) | Paga o libéralo |
| **Carrito caducado** | Se perdieron esas entradas | Si la operación sigue viva, el cupo vuelve a estar disponible |
| **Carrito a revisar** | Precio o cantidad no cuadran con lo pedido | Ábrelo y decide antes de pagar |
| **Resultado ambiguo** | No se sabe si entró (timeout, «No sé» o tarea caducada) | En el simulador se reconcilia solo leyendo el carrito. En asistencia manual llega la tarea «¿Están las N entradas de … en el carrito?» |
| **Reconciliación manual** | No se pudo confirmar automáticamente | Mira el carrito en la web oficial y responde la tarea *Verificar carrito* («¿Están las N entradas…?») |
| **Circuito abierto** | El proveedor falla repetidamente | Se reintenta solo; si pide reinicio manual, revisa y reinicia en Seguridad |
| **Cambio de esquema** | El proveedor cambió el formato de sus respuestas | La operación se pausa. Revisa el adapter antes de continuar |
| **Limitado por el proveedor** | Rate limit | Se espera y se reintenta solo |
| **Readiness fallido / con avisos** | Algo no está listo antes de T0 | Arregla lo que indique cada comprobación |
| **Kill switch** | Alguien activó una parada | Suéltalo en Seguridad (o en *Cuentas* si es de una cuenta) cuando proceda, y **siempre antes de T0**: con uno activo en T0 la operación termina sin arrancar |
| **Journal degradado** | No se está guardando la auditoría | La automatización se pausa hasta que se recupere |
| **Sin progreso** | Un rato sin nuevas entradas | ¿Precio máximo demasiado bajo? ¿Zonas agotadas? ¿Cuentas en cola? |
| **Operación finalizada** | Terminó la ventana, se paró o se cerraron todos los carritos | Paga los carritos que quieras conservar y pulsa *Cerrar* |
| **Recuperación necesaria** | El servidor se reinició con la operación en marcha | Responde las tareas que estaban abiertas: la operación sigue sola después |
| **Tarea humana** | Hace falta una persona | Ve a *Tareas humanas* (en Telegram la tarea llega con sus botones, sin alerta aparte) |

Las alertas se **agrupan**: el mismo problema no se repite, se actualiza (y sube de gravedad si empeora).
