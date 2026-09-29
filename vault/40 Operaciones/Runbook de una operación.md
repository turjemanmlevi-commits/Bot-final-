---
tags:
  - operaciones
  - runbook
---

# Runbook de una operación

De «queremos 8 entradas para este concierto» a «carritos pagados».

> [!important] ¿Compra real en Ticketmaster, entradas.com o el Real Madrid?
> Sigue [[Comprar entradas reales (paso a paso)]]: es este runbook aplicado a una venta real, con los botones exactos del dashboard y qué hace cada persona en cada momento.

## En asistencia manual (ticketeras reales)

- El sistema **no entra** en la web del proveedor y **no compra nada**: cada persona inicia sesión, compra y paga en la web oficial con su cuenta; el sistema reparte zonas, cantidades y precio máximo y lleva límites, presupuesto y carritos.
- Las zonas se eligen **tocando el plano** en *Nueva operación* (salen numeradas en orden). La página de la operación muestra el **Plan de compra · dónde y en qué orden** y, durante la venta, quién intenta qué zona.
- Al **armar**, cada cuenta vuelve a *Sin sesión* (un «Sesión lista» de un ensayo no vale para esta compra) y recibe una tarea «Inicia sesión» nueva con su **plan** (hora de apertura, zonas en orden, cuántas entradas, precio máximo), en *Tareas humanas* y en Telegram. Desarmar cancela esas tareas; al volver a armar llegan otras con el plan nuevo.
- En **T0**: «🚦 ¡Abre la venta!» al chat principal y a los de las cuentas, y una tarea «Añade N entradas · <zona>» por cuenta con «Sesión lista», con el plano y su zona resaltada (ensayo: 10 ms en Telegram, 26 ms en el dashboard, 12 ms el aviso). El reparto es **en paralelo** y respeta el grupo mínimo: 4 entradas, límite 3 por persona y grupo mínimo 2 → 2 + 2 a dos personas a la vez.
- **La operación arranca en T0 aunque ninguna sesión esté lista**: el [[Readiness]] solo avisa. El reparto reacciona a cada respuesta (y además se revisa cada 250 ms): quien pulse «Sesión lista» después de T0 recibe su tarea al momento, y tras «No pude» (o «no está» en una verificación) la siguiente zona llega igual (ensayo: ~50 ms).
- En Telegram, «en carrito» tiene un botón por cantidad (de N a 1, hasta 20) y después pregunta los minutos que le quedan al carrito (5, 8, 10, 15 o 20) junto a «💳 Ya lo he pagado»; se anota al precio máximo. Ver [[Configurar Telegram]].
- Cada tarea de compra tiene **30 minutos** por defecto para responderse (`MANUAL_TASK_MINUTES` en `.env`; reinicia tras cambiarlo; un `.env` de una versión anterior puede tener `10`). Si caduca, la reserva se mantiene y pasa a verificación («¿Están las N entradas de … en el carrito?»).
- Los minutos del carrito son una estimación: un carrito confirmado por una persona **no caduca solo**. Al agotarse llega «…: se acabó el tiempo del carrito, ¿lo has pagado?»: **Ya lo he pagado** o **Liberar** (se pierde y esa cantidad se vuelve a repartir). Ver [[Pago y cierre]].

## Días antes

1. **Recinto en el vault.** Comprueba que existe en `10 Recintos` con sus secciones y aliases. Si no, créalo con las plantillas (ver [[Cómo funciona el vault]]).
2. **Evento en el vault.** Desde el dashboard (*Eventos → Nuevo evento*) o creando la nota en `20 Eventos` con la plantilla «Evento». Lee las **condiciones oficiales** y rellena los límites: `limitPerAccount`, `limitPerGroup`, `limitPerOperation`, `limitSemantics` y `limitsSource`. Marca `limitsVerified: true` solo cuando lo hayas comprobado.
3. **Cuentas.** En el dashboard (Cuentas) da de alta las cuentas del grupo: alias del titular, hogar y medio de pago. Márcalas como verificadas.
4. **Operación.** Dashboard → Nueva operación: evento, T0, cantidad, precio máximo (con gastos), presupuesto, zonas en orden de preferencia (tocando el plano o con los botones del vault) y cuentas. **Crear y validar**.
5. Revisa la validación (pestaña Preparación): capacidad legal, avisos de presupuesto, objetivos resueltos.

## El día de la venta

| Momento | Qué hace el sistema | Qué haces tú |
|---|---|---|
| Al **armar** | Congela todo en un snapshot, reserva las cuentas, abre sesiones (en asistencia manual, las cuentas vuelven a *Sin sesión* y reciben una tarea «Inicia sesión» nueva con el plan) | Resolver los retos de sesión; en asistencia manual, iniciar sesión en la web oficial y pulsar «Sesión lista» antes de T0 (Tareas humanas o Telegram) |
| T−12 h, T−1 h, T−5 min | [[Readiness]] automático | Arreglar lo que salga en rojo o ámbar |
| T0 − congelado | Pasa a *Congelada*; sincroniza reloj con el proveedor | Tener el dashboard delante |
| **T0** | Readiness final → *En marcha* (si da **rojo** —kill switch global, de proveedor o de la operación activo, o el journal sin guardar— la operación **termina sin arrancar**; una cuenta parada solo da ámbar y no participa): cola, inventario, decisiones, carritos. En asistencia manual: aviso «🚦 ¡Abre la venta!» y una tarea «Añade N entradas · <zona>» por cuenta lista | Vigilar alertas; en asistencia manual, hacer tu tarea en la web oficial y responderla |
| Carrito asegurado | Para la automatización y avisa. Si se libera un carrito y la ventana sigue abierta, vuelve a *En marcha* y reparte lo que falta | **Pagar cada carrito** antes de que caduque |

En modo **asistencia manual** el sistema te va dando tareas («añade 2 entradas de Platea Central, máx. 45 €»): hazlas en tu navegador y responde en el dashboard o en Telegram.

## Si algo va mal

- **Parar todo ya**: Seguridad → PARAR TODO (kill switch global). Nada automático sale del sistema y lo que esté en marcha se pausa.
- **Antes de T0, ningún kill switch global, de proveedor ni de operación activo**: en T0 el [[Readiness]] final da rojo y la operación **termina sin arrancar**.
- **Quitar a una persona** (antes o durante la venta): «Parar cuenta» en *Cuentas* es **seguro**. Solo excluye esa cuenta: el [[Readiness]] da un aviso («Cuentas paradas (no participarán)») y la operación arranca y sigue con las demás. Si esa cuenta ya tenía una tarea de compra abierta, respóndela con «No pude» para liberar sus entradas. Alternativa antes de T0: *Desarmar*, *Editar configuración* (quitar la cuenta), *Guardar y validar* y *Armar*; al volver a armar, cada persona recibe una tarea «Inicia sesión» nueva con el plan nuevo y tiene que pulsar otra vez «Sesión lista».
- **Pausar una operación**: botón *Pausar*. Reanudar solo si la ventana sigue abierta.
- **Menos entradas / precio más bajo**: *Reducir cantidad* y *Bajar precio máx.* funcionan en caliente (nunca al revés).
- Ver [[Qué hacer con cada alerta]].

## Después

- [[Pago y cierre]].
- Si quieres comprobar que todo fue correcto: pestaña **Replay** de la operación.
