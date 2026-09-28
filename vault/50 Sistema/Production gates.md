---
tags:
  - sistema
  - calidad
---

# Production gates

```powershell
npm run gates            # rápido
npm run gates -- --full  # más semillas
```

También en el dashboard (Calidad). Corren con **reloj virtual** y un **vault de pruebas propio** (no dependen de lo que escribas en este vault). Informe en `reports/gates-latest.json`.

| Gate | Nombre | Qué comprueba |
|---|---|---|
| G0 | Guardarraíles de diseño | Se rechazan adapters con capabilities o métodos prohibidos; límites sin verificar bloquean el armado; el vault no puede autorizar capabilities prohibidas |
| G1 | Corrección de la selección | Cientos de casos aleatorios: la decisión coincide con un oráculo por fuerza bruta, es determinista aunque cambie el orden del inventario y nunca elige algo que viole la política o la capacidad |
| G2 | Seguridad de la asignación | Operaciones completas en los 4 escenarios del simulador: **cero** sobreasignación, **cero** violaciones de precio, y los escenarios normales terminan asegurados |
| G3 | Latencia (SLO) | Decisión p99 ≤ 5 ms con 2.000 candidatos; asignación p99 ≤ 1 ms |
| G4 | Replay determinista | Todas las decisiones y pasos de asignación de G2 se reproducen idénticos |
| G5 | Manual-assist y pago humano | Tareas humanas → carritos confirmados por personas; ningún pago automático |
| G6 | Resiliencia | Kill switch corta las llamadas y pausa; journal degradado pausa y se recupera; caos (ambiguos, rate limits, cambio de esquema) sin sobreasignar y con el circuito exigiendo reinicio manual |

## Definition of done

Todas en verde → el sistema cumple: guardarraíles, fail-closed, selección correcta y determinista, cero sobreasignación y violaciones de precio, latencia en SLO, replay 100 %, manual-assist con pago humano, y resiliencia.
