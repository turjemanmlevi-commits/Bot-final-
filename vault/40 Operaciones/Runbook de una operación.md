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

- El sistema **no entra** en la web del proveedor: cada persona inicia sesión, compra y paga en la web oficial con su cuenta; el sistema reparte zonas, cantidades y precio máximo y lleva límites, presupuesto y carritos.
- Al **armar**, cada cuenta recibe la tarea «Inicia sesión» con su **plan** (zonas en orden, cuántas entradas, precio máximo).
- **La operación arranca en T0 aunque ninguna sesión esté lista**: el [[Readiness]] solo avisa. Quien inicie sesión después de T0 y pulse «Sesión lista» recibe su tarea «Añade N entradas · <zona>» en menos de un segundo; tras «No pude», la siguiente zona llega igual de rápido.
- Cada tarea de compra tiene **10 minutos** por defecto para responderse (`MANUAL_TASK_MINUTES` en `.env`; reinicia tras cambiarlo). Si caduca, la reserva se mantiene y pasa a verificación («¿Están las N entradas de … en el carrito?»).

## Días antes

1. **Recinto en el vault.** Comprueba que existe en `10 Recintos` con sus secciones y aliases. Si no, créalo con las plantillas (ver [[Cómo funciona el vault]]).
2. **Evento en el vault.** Desde el dashboard (*Eventos → Nuevo evento*) o creando la nota en `20 Eventos` con la plantilla «Evento». Lee las **condiciones oficiales** y rellena los límites: `limitPerAccount`, `limitPerGroup`, `limitPerOperation`, `limitSemantics` y `limitsSource`. Marca `limitsVerified: true` solo cuando lo hayas comprobado.
3. **Cuentas.** En el dashboard (Cuentas) da de alta las cuentas del grupo: alias del titular, hogar y medio de pago. Márcalas como verificadas.
4. **Operación.** Dashboard → Nueva operación: evento, T0, cantidad, precio máximo (con gastos), presupuesto, zonas en orden de preferencia y cuentas. **Crear y validar**.
5. Revisa la validación (pestaña Preparación): capacidad legal, avisos de presupuesto, objetivos resueltos.

## El día de la venta

| Momento | Qué hace el sistema | Qué haces tú |
|---|---|---|
| Al **armar** | Congela todo en un snapshot, reserva las cuentas, abre sesiones (en asistencia manual, una tarea «Inicia sesión» por cuenta) | Resolver los retos de sesión; en asistencia manual, iniciar sesión en la web oficial y pulsar «Sesión lista» antes de T0 (Tareas humanas o Telegram) |
| T−12 h, T−1 h, T−5 min | [[Readiness]] automático | Arreglar lo que salga en rojo o ámbar |
| T0 − congelado | Pasa a *Congelada*; sincroniza reloj con el proveedor | Tener el dashboard delante |
| **T0** | Readiness final → *En marcha*: cola, inventario, decisiones, carritos. En asistencia manual: aviso «🚦 ¡Abre la venta!» y una tarea «Añade N entradas · <zona>» por cuenta lista | Vigilar alertas; en asistencia manual, hacer tu tarea en la web oficial y responderla |
| Carrito asegurado | Para la automatización y avisa | **Pagar cada carrito** antes de que caduque |

En modo **asistencia manual** el sistema te va dando tareas («añade 2 entradas de Platea Central, máx. 45 €»): hazlas en tu navegador y responde en el dashboard o en Telegram.

## Si algo va mal

- **Parar todo ya**: Seguridad → PARAR TODO (kill switch global). Nada automático sale del sistema.
- **Pausar una operación**: botón *Pausar*. Reanudar solo si la ventana sigue abierta.
- **Menos entradas / precio más bajo**: *Reducir cantidad* y *Bajar precio máx.* funcionan en caliente (nunca al revés).
- Ver [[Qué hacer con cada alerta]].

## Después

- [[Pago y cierre]].
- Si quieres comprobar que todo fue correcto: pestaña **Replay** de la operación.
