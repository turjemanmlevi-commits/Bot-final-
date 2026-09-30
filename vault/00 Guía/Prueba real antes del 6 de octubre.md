---
tags:
  - guia
  - compra
  - real-madrid
---

# Prueba real antes del 6 de octubre

Un ensayo de verdad, con **vuestras cuentas, vuestros móviles y Telegram**, comprando (o solo añadiendo al carrito) entradas del Real Madrid que **ya están a la venta**. Así el martes 6 no hay sorpresas. Guía del partido: [[Real Madrid - Villarreal (paso a paso)]].

> [!important] Qué se prueba (y qué no)
> - La sala **no mete entradas en el carrito de realmadrid.com**: lo hace cada persona en la web oficial, con su cuenta. Lo que la sala hace en milisegundos es **avisar**: de la apertura a la tarea en el móvil de cada persona (medido en el ensayo: 10–13 ms, más lo que tarde Telegram).
> - Lo que tarda en llegar al carrito depende de realmadrid.com (su cola) y de vosotros. Esta prueba sirve para medirlo y para practicarlo.
> - Se prueba: Telegram de cada persona, el plan, «Sesión lista», la tarea a la hora, «en carrito» / «No pude» (y la siguiente zona), el pago, la cuenta de límites y cerrar la operación.

## Qué partido usar

Uno que esté a la venta ahora en la web del Real Madrid y sea barato. Por ejemplo (mira antes que queden entradas):

- **Real Madrid Femenino - Espanyol**, sábado 17 de octubre, 20:30, Estadio Alfredo Di Stéfano: <https://www.realmadrid.com/entradas/femenino>. El recinto no está en la sala: Claude lo crea con las zonas que lea en la web.
- **Baloncesto: Real Madrid - Partizán** (Euroliga), jueves 8 de octubre, Movistar Arena. El Movistar Arena ya está en la sala, con su plano.

Las entradas de socio y de Madridista son personales: en la prueba, que cada persona compre **con su propia cuenta**.

## Antes (10 minutos)

1. **Sala actualizada**: cierra la ventana negra y pega el comando de siempre (el de [[Bajar el proyecto a tu ordenador]]).
2. **Telegram, un solo bot** para todo: en *Ajustes · Telegram* pega el token de tu bot y elige tu chat como principal. Cada persona abre **el mismo bot** y pulsa *Iniciar*; en *Ajustes · Telegram → Asignar a una cuenta* le das su chat, y pulsas **Probar** (le debe llegar un mensaje). No hace falta un bot por cuenta.
3. **Cuentas** (*Cuentas → Nueva cuenta*): una por persona que participa, con un alias. Para la prueba bastan 2 o 3.

## Paso a paso

1. **El evento**: *Eventos → Nuevo evento* → web **Real Madrid** → Claude busca sus eventos → elige el partido. Debajo sale lo que ha costado la consulta.
2. **Límites** (4 · Límites de compra): **1 por cuenta y 1 por grupo** y marca «He comprobado estos límites en las condiciones oficiales». Sin límites comprobados no se puede armar.
3. **Dónde** (5 · Dónde queréis las entradas): toca 2 o 3 zonas en orden (🟢 1ª, 🟠 2ª, 🔵 3ª). Pon primero una zona barata. Guarda.
4. **La operación**: *Operaciones → Nueva operación* desde el partido. Marca las cuentas, **1 entrada por cuenta**, un **precio máximo** bajo, y en **T0** pon la hora de dentro de 10 minutos (la venta ya está abierta: T0 es la hora de la prueba). Deja la ventana en 60 minutos. **Crear y validar** → corrige lo que salga en rojo → **Armar**. Cada persona recibe su **plan** por Telegram.
5. **Cada persona**: entra en realmadrid.com **con su cuenta, desde el móvil**, abre la página del partido y pulsa **✅ Sesión lista** en Telegram.
6. **A la hora (o antes, con «Empezar ya» en la operación)**: a cada persona le llega «🚦 ¡Abre la venta!» con **su** zona, el precio máximo y el botón a la web oficial.
7. **Cada persona** añade 1 entrada de su zona al carrito en la web oficial y pulsa **✅ 1 en carrito** (y los minutos que le quedan). Si no hay por ese precio: **❌ No pude**, y le llega al momento la siguiente zona.
8. **Pagar o no**:
   - Si os quedáis la entrada: pagad en la web oficial (sin cambios ni devoluciones) y pulsad **💳 Ya lo he pagado**.
   - Si no: no paguéis y, en *Carritos*, pulsa **Liberar** en ese carrito.
9. **Terminar**: en la operación, **Parar** (si sigue en marcha) y luego **Cerrar**.

## Qué mirar después

- En la operación: lo que tardó la tarea en llegar y lo que tardó cada persona en responder.
- Que cada persona recibió **solo su** tarea y que nadie pasó de 1 entrada.
- Lo que tardasteis de «¡Abre la venta!» a tener la entrada en el carrito: eso es lo que hay que acortar para el día 6 (sesión iniciada antes, zona clara, tarjeta con 3D Secure a mano).
- El gasto de Claude: *Ajustes · Claude (IA)* («Gastado desde que se abrió la sala») y, en la ventana negra, las líneas `Claude: consulta`.

> [!tip] Solo la velocidad del bot, sin web real
> **Nueva demo** en el dashboard: cuentas de mentira contra el simulador, arranca en 60 segundos y lo hace todo solo (ahí sí se añade al carrito, porque es un simulador).
