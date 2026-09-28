---
tags:
  - guia
---

# Glosario

- **T0** — instante de apertura de la venta. Todo se organiza alrededor de él.
- **Operación** — un intento de compra para un evento: cuántas entradas, dónde, a qué precio máximo, con qué cuentas. Ver [[Máquina de estados]].
- **Armar** — congelar la configuración en un **snapshot** con hash, reservar las cuentas y preparar sesiones.
- **Congelar (FROZEN)** — los segundos antes de T0; ya no se edita nada.
- **Candidato** — una oferta del proveedor normalizada: sección canónica, fila, asientos, cantidad, precio, ambigüedad.
- **Decisión** — elección del mejor candidato para una cuenta, pura y reproducible. Ver [[Selección de entradas]].
- **Claim** — reserva de capacidad enviada al proveedor (o a una persona). Ver [[Claims, carritos y confirmación]].
- **Asignación** — contabilidad de cantidad, presupuesto y cupos por cuenta y grupo. Ver [[Asignación y límites]].
- **Grupo de límite** — cuenta, titular, hogar o medio de pago, según la semántica del evento.
- **Readback** — confirmar leyendo el carrito del proveedor, no solo fiándose de su respuesta.
- **Ambiguo** — no se sabe si la acción funcionó (timeout). La reserva se mantiene hasta reconciliar.
- **Reconciliación** — leer el carrito para resolver un claim ambiguo; si no se puede, lo verifica una persona.
- **Carrito asegurado (CART_SECURED)** — todas las entradas pedidas están en carritos confirmados. Final de la automatización.
- **Kill switch** — parada inmediata (global, proveedor, operación o cuenta). Ver [[Kill switches y circuitos]].
- **Circuit breaker** — corta las llamadas a un proveedor que falla, y reintenta tras un enfriamiento.
- **Readiness** — lista de comprobaciones antes de T0. Ver [[Readiness]].
- **Journal** — registro append-only de todo lo que pasa. Base del [[Replay y auditoría|replay]].
- **Gate** — prueba de producción G0–G6. Ver [[Production gates]].
- **Manual-assist** — modo en el que las personas hacen cada acción y el sistema coordina.
