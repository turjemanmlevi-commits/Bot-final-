---
tags:
  - operaciones
  - checklist
---

# Checklist de readiness

El sistema la evalúa sola (ver [[Readiness]]), pero conviene repasarla a mano la víspera.

- [ ] El evento tiene **límites verificados** y anotada la fuente.
- [ ] El recinto está compilado sin errores y con **confianza ≥ 0,6**.
- [ ] Las **zonas objetivo** se resuelven a secciones (pestaña Preparación → Política compilada).
- [ ] **Precio máximo** realista (con gastos) y **presupuesto** suficiente para la cantidad.
- [ ] Todas las cuentas **verificadas**, **activas** y **elegibles** para el evento.
- [ ] Ninguna cuenta está en otra operación armada.
- [ ] Sesiones abiertas y retos resueltos antes de T−5 min. En asistencia manual, cada persona ha pulsado «Sesión lista» en la tarea «Inicia sesión» de **esta** operación (al armar, las cuentas vuelven a *Sin sesión*).
- [ ] Telegram configurado si no vas a estar mirando el dashboard (opcional): *Ajustes · Telegram → Enviar mensaje de prueba* llega al móvil, y cada persona con chat propio ha pulsado **Iniciar** en el bot.
- [ ] Cada persona ha recibido y leído su **plan** (tarea «Inicia sesión»).
- [ ] El **Plan de compra** de la operación muestra las zonas en el orden correcto sobre el plano.
- [ ] «Grupo mínimo por carrito» en **1** si cada persona compra solo la suya (viene en 2) y «Asientos juntos» solo si hace falta.
- [ ] En *Resumen*, la «Compra real · lista de comprobación» nombra **vuestro** evento y **vuestra** operación (no la demo).
- [ ] Kill switches global, de proveedor y de operación sueltos, y circuitos cerrados: uno de ellos activo en T0 hace que la operación termine sin arrancar. Una cuenta parada («Parar cuenta» en *Cuentas*) no la bloquea: solo queda fuera. Comprueba que las cuentas paradas son las que queréis dejar fuera.
- [ ] `MANUAL_TASK_MINUTES` en `.env` es `30` (o no está): un `.env` de una versión anterior puede tener `10`.
- [ ] Journal persistiendo (no en memoria).
- [ ] Sabes quién paga cada carrito y con qué medio de pago.
