---
tags:
  - inicio
---

# Ticket Orchestrator · vault

> [!abstract] Qué es esto
> Este vault es a la vez **la fuente de datos** del sistema (recintos, eventos, límites y proveedores) y **su documentación viva**. El servidor lee estas notas, las compila y el dashboard se actualiza solo cada vez que guardas algo aquí.

## Empezar

> [!tip] ¿Compras entradas reales mañana?
> Arranca con doble clic en **Sala de control** (Escritorio) o en `INICIAR.bat` (carpeta `bot final`). En el dashboard, la página **Cómo se compra** lo resume en 9 pasos con el plano; aquí, el detalle en [[Comprar entradas reales (paso a paso)]].
>
> ¿Aún no está instalado? En PowerShell, una sola línea: `irm https://raw.githubusercontent.com/turjemanmlevi-commits/Bot-final-/claude/confident-bell-yb79l7/instalar.ps1 | iex` (ver [[Bajar el proyecto a tu ordenador]]).

> [!important] El sistema no compra por ti
> En Ticketmaster, entradas.com y Real Madrid **cada persona compra y paga en la web oficial con su cuenta**. El sistema coordina: quién va a por qué zona, cuántas, hasta qué precio, límites, presupuesto, carritos y avisos. Ver [[Uso legítimo y guardarraíles]].

1. [[Comprar entradas reales (paso a paso)]] — la víspera y el día de la venta, con los botones exactos del dashboard.
2. [[Configurar Telegram]] — tareas con botones y avisos en el móvil de cada persona.
3. [[Bajar el proyecto a tu ordenador]] — instalarlo con un solo comando en `C:\Users\Leviç\OneDrive\Desktop\bot final`, arrancarlo con «Sala de control» o `INICIAR.bat` y abrir este vault.
4. [[Cómo funciona el vault]] — qué notas lee el sistema y con qué propiedades.
5. [[Runbook de una operación]] — de «quiero entradas» a «carrito pagado».
6. [[Uso legítimo y guardarraíles]] — lo que el sistema **nunca** hace.

## Datos (los lee el servidor)

| Carpeta | Qué contiene | Vista |
|---|---|---|
| `10 Recintos` | Un recinto por carpeta: su nota, sus **zonas** y sus **secciones**. El dashboard dibuja con ellas el **plano** de cada recinto | [[Estadio Santiago Bernabéu]] · [[Recintos.base]] · [[Secciones.base]] |
| `20 Eventos` | Fecha, proveedor, apertura de venta y **límites de compra** | [[Eventos.base]] |
| `30 Proveedores` | Dónde se vende: web oficial y modo de cada ticketera (las reales, en **asistencia manual**) | [[Ticketmaster]] · [[Entradas.com]] · [[Real Madrid]] · [[Asistencia manual]] · [[Simulador]] |
| `_plantillas` | Plantillas para crear notas nuevas (Ctrl/Cmd+P → «Insertar plantilla») | — |

## Operar

- [[Comprar entradas reales (paso a paso)]]
- [[Runbook de una operación]]
- [[Checklist de readiness]]
- [[Qué hacer con cada alerta]]
- [[Pago y cierre]]

## Cómo está hecho

- [[Arquitectura]] · [[Mapa del sistema.canvas|Mapa del sistema]]
- [[Máquina de estados]]
- [[Selección de entradas]] · [[Asignación y límites]]
- [[Claims, carritos y confirmación]]
- [[Alertas y Telegram]] · [[Kill switches y circuitos]] · [[Readiness]]
- [[Métricas y SLO]] · [[Replay y auditoría]] · [[Production gates]]
- [[Dashboard]] · [[API]]
- Decisiones: [[ADR-001 Vault como fuente de Venue Intelligence]] · [[ADR-002 Motor determinista y replay]] · [[ADR-003 Journal write-behind]] · [[ADR-004 Simulador y asistencia manual]] · [[ADR-005 Supuestos donde faltaba la especificación]]

## Glosario

Ver [[Glosario]].
