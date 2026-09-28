---
tags:
  - operaciones
  - runbook
---

# Runbook de una operación

De «queremos 8 entradas para este concierto» a «carritos pagados».

## Días antes

1. **Recinto en el vault.** Comprueba que existe en `10 Recintos` con sus secciones y aliases. Si no, créalo con las plantillas (ver [[Cómo funciona el vault]]).
2. **Evento en el vault.** Crea la nota en `20 Eventos` con la plantilla «Evento». Lee las **condiciones oficiales** y rellena los límites: `limitPerAccount`, `limitPerGroup`, `limitPerOperation`, `limitSemantics` y `limitsSource`. Marca `limitsVerified: true` solo cuando lo hayas comprobado.
3. **Cuentas.** En el dashboard (Cuentas) da de alta las cuentas del grupo: alias del titular, hogar y medio de pago. Márcalas como verificadas.
4. **Operación.** Dashboard → Nueva operación: evento, T0, cantidad, precio máximo (con gastos), presupuesto, zonas en orden de preferencia y cuentas. **Crear y validar**.
5. Revisa la validación (pestaña Preparación): capacidad legal, avisos de presupuesto, objetivos resueltos.

## El día de la venta

| Momento | Qué hace el sistema | Qué haces tú |
|---|---|---|
| Al **armar** | Congela todo en un snapshot, reserva las cuentas, abre sesiones | Resolver los retos de sesión (Tareas humanas) |
| T−12 h, T−1 h, T−5 min | [[Readiness]] automático | Arreglar lo que salga en rojo o ámbar |
| T0 − congelado | Pasa a *Congelada*; sincroniza reloj con el proveedor | Tener el dashboard delante |
| **T0** | Readiness final → *En marcha*: cola, inventario, decisiones, carritos | Vigilar alertas; nada más |
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
