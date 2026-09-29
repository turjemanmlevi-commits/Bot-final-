---
tags:
  - guia
  - eventos
---

# Crear un evento sin escribirlo (y vigilar la venta)

Al crear un evento ya no se escribe nada a mano: **primero eliges dónde se vende** y **después el evento**. El resto se rellena solo: el **recinto** (el de la sala o uno nuevo que se crea al guardar), el **nombre**, el **enlace oficial**, la **fecha y hora**, la **apertura de la venta** (o de la fase o preventa que elijas), el **límite de compra** si la web lo publica, y la **vigilancia** desde 2 días antes.

> [!important] Nada entra en las webs de venta
> La sala **no visita** ticketmaster.es, entradas.com ni realmadrid.com por su cuenta, no inicia sesión y no compra. Esas webs bloquean los programas automáticos (Ticketmaster responde «403 prohibido» y entradas.com corta la conexión) y sus condiciones lo prohíben: intentarlo podría hacer que bloquearan **tu** conexión justo el día de la venta. Por eso hay dos caminos legítimos. Ver [[Uso legítimo y guardarraíles]].

## Paso a paso

**Eventos → Nuevo evento**:

1. **Dónde se vende**: Ticketmaster, entradas.com, Real Madrid u «Otra web oficial».
2. **Elige el evento**, de una de estas dos maneras:

### A · Sin claves: botón «📥 Enviar a la sala» (cualquier web oficial)

Se instala una vez (1 minuto):

1. En la sala, *Nuevo evento* (o *Ajustes · Fuentes de eventos*) → **¿No tienes el botón «📥 Enviar a la sala»? Instálalo**.
2. Si no ves la barra de marcadores del navegador, pulsa **Ctrl + Mayús + B** (Chrome y Edge).
3. **Arrastra** el botón **📥 Enviar a la sala** hasta esa barra y suéltalo. Si no se deja arrastrar: **Copiar el código del marcador**, crea un marcador (Ctrl + D), cambia su dirección por lo copiado y llámalo «Enviar a la sala».

Cada vez:

1. Pulsa **Abrir Ticketmaster** (o la web que sea) y abre la página **del evento** (la del partido, del concierto…).
2. Pulsa el marcador **📥 Enviar a la sala** en la barra: se abre la sala con el evento relleno y un recuadro «📥 Recibido de…» que dice qué ha encontrado y qué falta.
3. Si la página tiene varias fases de venta (preventa, socios, venta general…), pulsa **la vuestra**: su hora será la **apertura (T0)**. Si tiene varias fechas (una gira), elige la fecha.
4. Revisa y pulsa **Guardar evento**.

Lee **solo lo que la página enseña** y **solo cuando tú lo pulsas**: los datos del evento que la web publica para los buscadores (nombre, fecha, recinto, precios, apertura) y las líneas visibles que hablan de la venta o del límite («Venta general: miércoles 7 de octubre a las 10:00», «Máximo 4 entradas por socio»). Si la página no lo dice (por ejemplo, la apertura aún no está anunciada), el recuadro lo avisa y lo completas tú. Si ya existe un evento con ese enlace, se abre ese para **actualizarlo** (útil cuando anuncian la hora de venta).

### B · Con clave gratuita: la lista dentro de la sala (opcional)

Con las claves de **Ajustes · Fuentes de eventos** sale aquí mismo la lista, sin salir de la sala:

| Dónde se vende | Qué lista sale |
|---|---|
| **Ticketmaster** | Sus próximos eventos en **toda España**: de las próximas 2 semanas, del mes, de 3 meses, o **«Ventas que abren en las próximas 2 semanas»**. Filtros por ciudad, tipo y texto, y «Solo los recintos grandes» (los que ya están en la sala) |
| **Real Madrid** | Los próximos partidos del Real Madrid **en casa** (LaLiga y Champions), en el Bernabéu |
| **Otra web oficial** | Los próximos partidos de LaLiga y Champions en España, de cualquier club (cada uno en su estadio) |
| **entradas.com** | — (no tiene API pública: usa el botón) |

Cada evento enseña fecha y hora, estado, recinto (**«recinto de la sala»** o **«recinto nuevo, se crea al guardar»**), cuándo abre cada venta, el límite con la frase oficial y el precio. **Usar este evento** (o **Usar · Preventa…**) lo rellena todo.

Para ponerlas: **Ticketmaster** → *Crear la clave gratis* (developer.ticketmaster.com) → *My Apps* → copia la **Consumer Key**. **Partidos** → *Pedir el token gratis* (football-data.org → Register, plan Free) → te llega por email. Pégalas y **Conectar**. Se guardan solo en este ordenador (archivo `.env`).

> [!tip] Lo mejor de los dos
> Si tienes la clave y traes un evento con el botón (de Ticketmaster o un partido del Real Madrid), la sala lo busca también en la lista oficial y lo **vincula**: así la vigilancia avisa de los **cambios** oficiales, no solo de los recordatorios.

## Recinto automático

- Si el recinto ya está en la sala (los estadios de LaLiga, los grandes pabellones, las plazas de toros y los recintos de festivales), se elige solo, aunque la web lo llame distinto (por ejemplo, **WiZink Center** → *Movistar Arena*).
- Si no está, sale **➕ «nombre» — recinto nuevo, se crea al guardar**: se crea con una estructura orientativa (estadio: Tribuna, Preferencia y Fondos; pabellón: Pista y gradas; teatro: Patio de butacas y Anfiteatro; festival: General). Revísala después en **Recintos** con el plano oficial.

## Límite de compra

Si la web publica el límite («Hay un límite de 6 entradas por cliente», «Máximo 4 entradas por socio»), se pone solo: **por cuenta** = ese número y **cómo cuenta** = **por titular** (las ticketeras cuentan por cliente: mismo nombre, cuenta o tarjeta), con la frase citada en «De dónde salen los límites». Si no lo publica, se avisa: míralo en las condiciones de la venta y escríbelo.

## Vigilar la venta

Apartado **Fechas → Vigilar desde**: **2 días antes** viene puesto (también 1, 3, 7 o 14 días). Desde ese momento:

- Llega por Telegram **«👀 Vigilando…»** con la hora de apertura.
- Recordatorios: **el día antes** y **una hora antes** (dice si todavía no hay operación armada); y, si llega la hora sin operación armada, **«🔔 Abre la venta…»**.
- Si el evento está **vinculado** a la lista oficial, consulta la fuente **cada 10 minutos** (cada 2 en las 3 horas finales) y avisa si cambia la hora de la venta, sale una preventa, cambia el límite o se cancela o aplaza. Las **fechas** se corrigen solas en el evento; el **límite nunca** (lo revisas tú).
- Si aún no hay hora de apertura (por ejemplo, un partido cuya venta no se ha anunciado), vigila respecto a la fecha del partido y te recuerda ponerla: cuando salga, vuelve a pulsar **📥 Enviar a la sala** en la página del partido y se actualiza.

> [!note] Si ya hay una operación armada
> La vigilancia actualiza el **evento**, no el T0 de una operación ya armada. Si cambia la hora de la venta: **Desarmar → Editar configuración → T0 → Armar** en la operación.

## Si algo no sale

| Qué pasa | Qué hacer |
|---|---|
| Al pulsar el marcador no pasa nada | ¿Está abierta la sala (ventana negra)? El marcador abre `http://localhost:8787`. Si el navegador bloquea la ventana nueva, permite las ventanas emergentes de esa web |
| «No aparece en la página: …» | Esa web no lo enseña (o aún no está anunciado): complétalo a mano |
| El recinto sale como nuevo pero ya existe | Elígelo en la lista de *Recinto*; si quieres que lo reconozca solo, añade el nombre que usa la web como alias en la nota del recinto |
| La lista dice «Falta la clave» | Es opcional: pon la clave en *Ajustes · Fuentes de eventos* o usa el botón |
| «No encuentro…» / «Hay más eventos de los que caben» | Escribe el artista, el equipo o la ciudad en el buscador |

Relacionado: [[Comprar entradas reales (paso a paso)]] · [[Ticketmaster]] · [[Real Madrid]] · [[Entradas.com]] · [[Configurar Telegram]].
