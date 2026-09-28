---
tags:
  - operaciones
  - alertas
---

# Qué hacer con cada alerta

| Alerta | Qué significa | Qué hacer |
|---|---|---|
| **Reto de sesión** | El proveedor pide CAPTCHA / SMS / 2FA | Entra con esa cuenta, resuélvelo y pulsa *Sesión lista* |
| **Sesión caducada** | El proveedor cerró la sesión | El sistema intenta reabrir; si pide reto, resuélvelo |
| **Problema de cola** | La cola caducó o se bloqueó para esa cuenta | Vuelve a entrar en la cola con esa cuenta si procede |
| **Carrito confirmado** | Entradas en un carrito | Nada todavía (o pagar si ya quieres) |
| **Carrito asegurado** | Toda la cantidad está en carritos | **Paga cada carrito ya** |
| **Carrito a punto de caducar** | Queda poco para que el proveedor lo libere | Paga o libéralo |
| **Carrito caducado** | Se perdieron esas entradas | Si la operación sigue viva, el cupo vuelve a estar disponible |
| **Carrito a revisar** | Precio o cantidad no cuadran con lo pedido | Ábrelo y decide antes de pagar |
| **Resultado ambiguo** | Timeout: no se sabe si entró | Espera: se reconcilia solo leyendo el carrito |
| **Reconciliación manual** | No se pudo confirmar automáticamente | Mira el carrito y responde la tarea *Verificar carrito* |
| **Circuito abierto** | El proveedor falla repetidamente | Se reintenta solo; si pide reinicio manual, revisa y reinicia en Seguridad |
| **Cambio de esquema** | El proveedor cambió el formato de sus respuestas | La operación se pausa. Revisa el adapter antes de continuar |
| **Limitado por el proveedor** | Rate limit | Se espera y se reintenta solo |
| **Readiness fallido / con avisos** | Algo no está listo antes de T0 | Arregla lo que indique cada comprobación |
| **Kill switch** | Alguien activó una parada | Suéltalo en Seguridad cuando proceda |
| **Journal degradado** | No se está guardando la auditoría | La automatización se pausa hasta que se recupere |
| **Sin progreso** | Un rato sin nuevas entradas | ¿Precio máximo demasiado bajo? ¿Zonas agotadas? ¿Cuentas en cola? |
| **Tarea humana** | Hace falta una persona | Ve a *Tareas humanas* |

Las alertas se **agrupan**: el mismo problema no se repite, se actualiza (y sube de gravedad si empeora).
