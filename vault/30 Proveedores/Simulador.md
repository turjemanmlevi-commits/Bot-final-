---
type: provider
id: sim
name: Simulador
mode: SIMULATED
authorizedCapabilities:
  - session.open
  - session.status
  - queue.status
  - inventory.read
  - cart.add
  - cart.read
  - clock.server_time
source: "Simulador interno del proyecto (server/src/providers/simulated.ts)"
verifiedAt: 2026-09-28
tags:
  - proveedor
---

# Simulador

Proveedor **ficticio** que vive dentro del servidor. Genera inventario a partir del recinto compilado del vault, simula colas, retos de sesión (CAPTCHA que resuelve una persona), latencias, respuestas ambiguas, rate limits y otros compradores que se llevan entradas.

Sirve para ensayar operaciones y para los [[Production gates]]. Escenarios disponibles:

| Escenario | Qué prueba |
|---|---|
| `demo` | Operación normal: cola corta, algún reto, algo de competencia. |
| `alta-demanda` | Inventario que se agota en segundos. |
| `caos` | Respuestas ambiguas, rate limits, cambios de precio y un cambio de esquema. |
| `tranquilo` | Sin competencia ni fallos: para aprender a usar el dashboard. |

Todas las capabilities están autorizadas porque el proveedor es nuestro. El carrito se "paga" marcándolo como pagado en el dashboard: **el sistema nunca paga**.
