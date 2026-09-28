---
tags:
  - inicio
---

# Ticket Orchestrator · vault

> [!abstract] Qué es esto
> Este vault es a la vez **la fuente de datos** del sistema (recintos, eventos, límites y proveedores) y **su documentación viva**. El servidor lee estas notas, las compila y el dashboard se actualiza solo cada vez que guardas algo aquí.

## Empezar

1. [[Bajar el proyecto a tu ordenador]] — instalarlo en `C:\Users\Leviç\OneDrive\Desktop\bot final` y abrir este vault.
2. [[Cómo funciona el vault]] — qué notas lee el sistema y con qué propiedades.
3. [[Runbook de una operación]] — de «quiero entradas» a «carrito pagado».
4. [[Uso legítimo y guardarraíles]] — lo que el sistema **nunca** hace.

## Datos (los lee el servidor)

| Carpeta | Qué contiene | Vista |
|---|---|---|
| `10 Recintos` | Un recinto por carpeta: su nota, sus **zonas** y sus **secciones** | [[Recintos.base]] · [[Secciones.base]] |
| `20 Eventos` | Fecha, proveedor, apertura de venta y **límites de compra** | [[Eventos.base]] |
| `30 Proveedores` | Qué capabilities están **autorizadas** para automatizar | [[Simulador]] · [[Asistencia manual]] |
| `_plantillas` | Plantillas para crear notas nuevas (Ctrl/Cmd+P → «Insertar plantilla») | — |

## Operar

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
