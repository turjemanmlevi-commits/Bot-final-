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
- **Carrito asegurado (CART_SECURED)** — todas las entradas pedidas están en carritos confirmados. Ahí termina el trabajo del sistema; el pago es siempre humano. En asistencia manual, las entradas las ha puesto en el carrito cada persona en la web oficial. Si luego se libera un carrito y la ventana sigue abierta, la operación vuelve a *En ejecución* y reparte lo que falta.
- **Tiempo del carrito** — minutos que le quedan al carrito según la web oficial, que indica una persona. Es una estimación: un carrito confirmado por una persona no caduca solo; al agotarse, el sistema pregunta «¿lo has pagado?» (**Ya lo he pagado** o **Liberar**).
- **Liberar** — decir que un carrito se perdió o no se va a pagar. Esas entradas se vuelven a repartir mientras la venta siga abierta.
- **Kill switch** — parada inmediata (global, proveedor, operación o cuenta). La de una cuenta («Parar cuenta») solo deja fuera esa cuenta y no impide arrancar en T0. Ver [[Kill switches y circuitos]].
- **Circuit breaker** — corta las llamadas a un proveedor que falla, y reintenta tras un enfriamiento.
- **Readiness** — lista de comprobaciones antes de T0. Ver [[Readiness]].
- **Journal** — registro append-only de todo lo que pasa. Base del [[Replay y auditoría|replay]].
- **Gate** — prueba de producción G0–G6. Ver [[Production gates]].
- **Manual-assist (asistencia manual)** — modo de Ticketmaster, entradas.com y Real Madrid: las personas hacen cada acción en la web oficial (iniciar sesión, añadir al carrito, pagar) y el sistema coordina, reparte y avisa. Ver [[Asistencia manual]].
- **Plan** — lo que recibe cada cuenta al armar, en la tarea «Inicia sesión»: hora de apertura, zonas en orden, cuántas entradas como mucho y precio máximo.
- **Sesión lista** — botón con el que una persona dice que ya ha iniciado sesión en la web oficial. Sin él no recibe tareas de compra. Se pide en cada compra: al armar una operación, las cuentas vuelven a *Sin sesión*.
- **Plano** — dibujo orientativo del recinto que el dashboard genera desde el vault (estadio con el norte arriba y niveles en anillos; pabellón o teatro con el escenario arriba). Ver [[Dashboard]].
