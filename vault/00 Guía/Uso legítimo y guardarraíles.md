---
tags:
  - guia
  - seguridad
---

# Uso legítimo y guardarraíles

El sistema coordina **cuentas legítimas de personas reales** (hasta 10 por operación) para conseguir entradas **para ese grupo**, respetando las reglas de cada venta. Su alcance automático termina en **carrito asegurado**: **pagar lo hace siempre una persona**.

## Lo que el sistema no puede hacer (por diseño)

| Capability | Por qué no existe |
|---|---|
| `checkout.pay` | El pago es humano. El sistema solo marca un carrito como pagado cuando una persona dice que ha pagado. |
| `challenge.solve` | CAPTCHA, SMS, 2FA y verificaciones de identidad los resuelve una persona. |
| `queue.bypass` | La cola virtual se respeta: el sistema solo consulta su estado. |
| `limit.override` | Los límites de compra del evento son un tope duro de la asignación. |
| `identity.spoof` | Nada de cuentas falsas ni suplantación: cada cuenta es de su titular. |

El registro de proveedores **rechaza** cualquier adapter que declare estas capabilities o que tenga métodos como `pay()` o `solveCaptcha()`, y el compilador del vault **rechaza** cualquier nota de proveedor que intente autorizarlas. Lo comprueba el gate [[Production gates|G0]].

## Fail-closed

- Un evento con `limitsVerified: false` o `limitSemantics: UNKNOWN` **no se puede armar**.
- Una cuenta sin verificar (`UNVERIFIED`) no se puede usar.
- Si el límite es por hogar o por medio de pago y falta esa referencia, la cuenta no se puede usar.
- Si el journal no guarda, la automatización se pausa.
- Si el proveedor cambia el formato de sus respuestas, el circuito se abre y exige revisión humana.

## Límites por grupo

Con semántica **por titular**, dos cuentas del mismo titular comparten el cupo. Igual con **por hogar** y **por medio de pago**. Ver [[Asignación y límites]].

## Plazas accesibles

Las plazas PMR están **reservadas** salvo que la operación active `allowAccessible` porque alguien del grupo las necesita.

## Modos de proveedor

- **Simulado**: el simulador interno, para ensayar y para los gates.
- **Asistencia manual**: para cualquier ticketera real sin API autorizada. El sistema **no se conecta** al proveedor: reparte tareas a las personas del grupo y lleva la cuenta de límites, presupuesto y caducidades.
- **API autorizada**: solo con permiso escrito del proveedor, capability a capability, anotado en su nota de `30 Proveedores`.

Respeta siempre los términos de uso de cada ticketera y la normativa aplicable.
