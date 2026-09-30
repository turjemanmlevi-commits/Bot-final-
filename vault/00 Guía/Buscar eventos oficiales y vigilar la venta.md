---
tags:
  - guia
  - eventos
---

# Crear un evento sin escribirlo (y vigilar la venta)

Al crear un evento ya no se escribe nada a mano: **primero eliges dónde se vende** y **después el evento**. El resto se rellena solo: el **recinto** (el de la sala o uno nuevo, con sus zonas), el **nombre**, el **enlace oficial**, la **fecha y hora**, la **apertura de la venta** (o de la fase o preventa que elijas), **cuántas entradas se pueden comprar por persona** (con la frase de las condiciones) y la **vigilancia** desde 2 días antes. Y antes de guardar, **tocas en el plano del recinto dónde queréis las entradas** (1ª, 2ª y 3ª preferencia, cada una con su color).

> [!important] Nada entra en las webs de venta
> La sala **no visita** ticketmaster.es, entradas.com ni realmadrid.com por su cuenta, no inicia sesión y no compra. Esas webs bloquean los programas automáticos (Ticketmaster responde «403 prohibido» y entradas.com corta la conexión) y sus condiciones lo prohíben: intentarlo podría hacer que bloquearan **tu** conexión justo el día de la venta. Claude lee páginas **públicas** con sus herramientas, desde los servidores de Anthropic, como lo haría una persona que busca información. La cola virtual no se salta: cada persona compra y paga en la web oficial con su cuenta. Ver [[Uso legítimo y guardarraíles]].

## Paso a paso

**Eventos → Nuevo evento**:

1. **Dónde se vende**: Ticketmaster, entradas.com, Real Madrid u «Otra web oficial».
2. **Elige el evento**: con **Claude** (lo más cómodo) o con una de las otras dos maneras (A y B, más abajo).
3. Revisa los datos y elige **qué venta es la vuestra** (socios, preventa, general…): su hora es la **apertura (T0)**.
4. **Dónde queréis las entradas**: toca en el plano hasta 3 sitios.
5. **Guardar evento**.

### 🤖 Con Claude (recomendado)

Se pone una vez: **Ajustes → Claude (IA)** → pega tu clave de la API (platform.claude.com → *API keys* → *Create key*; empieza por `sk-ant-`) y **Conectar**. Se guarda en el archivo `.env` de la carpeta del proyecto (si esa carpeta está en OneDrive, OneDrive también lo sube a tu nube: mejor instalar fuera de OneDrive). Se paga por consulta a Anthropic (unos céntimos cada una; la misma búsqueda repetida en 30 minutos es gratis).

Cada vez:

1. Al elegir **dónde se vende**, Claude mira esa web y las oficiales de sus eventos y enseña la lista de los próximos (el mes, 2 meses o 4 meses). Tarda 1–2 minutos: se ve el tiempo que lleva.
2. Pulsa **Elegir** en el evento: Claude **analiza el evento entero** (1–2 minutos más) y se rellena todo. El recuadro «🤖» dice qué ha encontrado y qué falta.
3. **Enlace oficial de compra**: el enlace **directo** a la página donde se compran las entradas de ese evento en la web oficial, y **quién vende** (el club, la ticketera, la UEFA…). Nunca una reventa: si Claude solo encuentra una (Viagogo, StubHub…), la descarta y lo avisa. Es el botón «Abrir la web oficial» de cada tarea y de Telegram.
4. **Cuántas entradas se pueden comprar**: por persona y **en cada fase de venta** (socios, preventa, general…, cada una con su «máx. N»). Si Claude cita la frase de la **web de venta oficial**, queda puesto y **verificado**; si solo lo encuentra en otra web (una noticia), lo pone pero **sin verificar**: compruébalo en la web oficial y marca la casilla. Al elegir una fase se pone su límite; si pones otro número a mano no se toca, y si es mayor que el de la fase sale un aviso. Debajo, la sala calcula **cuántas podéis comprar en total** con vuestras cuentas.
5. **Recinto**: si ya está en la sala se elige solo; si no, se **crea al momento** con las zonas que usa la web de venta (o una estructura orientativa).
6. **Cómo está estructurada la venta**: en el paso 5, una tabla con las zonas **tal y como las vende la web** (gradas, sectores, pista…), sus secciones, su precio y a qué zona de vuestro plano corresponde cada una. Si la web vende zonas que vuestro plano no tiene, **«➕ Añadir al recinto las zonas que faltan»** las crea (con sus secciones) y guarda los nombres de la web como **alias** de vuestras zonas, sin duplicar nada. Se guarda en la nota del evento (`saleZones`).
7. **Plano**: si Claude encuentra la **imagen del plano oficial** (tal cual se ve al comprar), sale en el paso 5 con un **«+» en cada zona** (Claude las sitúa mirando la imagen). Si no hay imagen, o la web no deja verla desde aquí, sale el **plano de la sala**.

**Venga de donde venga el evento, Claude lo analiza**: al traerlo con el botón «📥 Enviar a la sala» o de la lista oficial (A y B, más abajo) se pone a analizarlo solo y **completa lo que falte** sin pisar lo que ya es oficial o está comprobado. En un evento ya guardado, **Editar → 🤖 Analizar con Claude**.

Claude no interviene en la compra: el día de la venta, el bot avisa **al segundo** con lo que ya está preparado.

### Dónde queréis las entradas (1ª, 2ª y 3ª)

En el paso **5** toca hasta **3 sitios** del plano, en orden: 🟢 **1ª preferencia**, 🟠 **2ª**, 🔵 **3ª**. Otra vez para quitarlo; las flechas cambian el orden. Debajo están todas las zonas en botones (por si alguna no sale en la imagen). Se guarda en la nota del evento (`preferredTargets`) y la **operación empieza con esas zonas**: al abrir la venta, el bot manda a cada persona a la 1ª; si no hay entradas, a la 2ª y después a la 3ª, al instante.

### 📱 Desde Telegram: /evento

En el **chat principal** del bot escribe **/evento**: eliges la web de venta con un botón → Claude busca y enseña los próximos eventos → tocas uno → Claude lo analiza (fecha, fases de venta con su límite, límite por persona, precios, recinto, **cómo está estructurada la venta** y el **enlace oficial de compra**) → **✅ Crear · abre Venta general…** (o la fase que sea) → llega la **imagen del plano oficial** y tocas hasta 3 zonas (🟢 1ª, 🟠 2ª, 🔵 3ª) → **Listo**. Si la web vende zonas que vuestro plano no tiene, sale **➕ Añadir al recinto** para poder elegirlas. Es lo mismo que en el dashboard: el evento queda creado con su recinto, su vigilancia y dónde queréis las entradas. Mientras Claude busca, el bot sigue respondiendo a todo lo demás.

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

Para ponerlas: **Ticketmaster** → *Crear la clave gratis* (developer.ticketmaster.com) → *My Apps* → copia la **Consumer Key**. **Partidos** → *Pedir el token gratis* (football-data.org → Register, plan Free) → te llega por email. Pégalas y **Conectar**. Se guardan en el archivo `.env` de la carpeta del proyecto (si esa carpeta está en OneDrive, también se sube a tu nube).

> [!tip] Lo mejor de los dos
> Si tienes la clave y traes un evento con el botón (de Ticketmaster o un partido del Real Madrid), la sala lo busca también en la lista oficial y lo **vincula**: así la vigilancia avisa de los **cambios** oficiales, no solo de los recordatorios.

## Recinto automático

- Si el recinto ya está en la sala (los estadios de LaLiga, los grandes pabellones, las plazas de toros y los recintos de festivales), se elige solo, aunque la web lo llame distinto (por ejemplo, **WiZink Center** → *Movistar Arena*).
- Con **Claude**, si no está se crea **al momento** con las zonas y secciones que usa la web de venta, para poder elegir dónde antes de guardar.
- Con el botón o la lista, sale **➕ «nombre» — recinto nuevo, se crea al guardar**: se crea con una estructura orientativa (estadio: Tribuna, Preferencia y Fondos; pabellón: Pista y gradas; teatro: Patio de butacas y Anfiteatro; festival: General). En el paso 5, **Crear el recinto ahora para elegir dónde** lo crea ya. Revísalo después en **Recintos** con el plano oficial.

> [!note] El plano oficial en la nota
> La imagen del plano se guarda en la nota del evento (`planImage`) y dónde está cada zona en ella (`planPoints`, una línea por zona: `Fondo Sur @ 50,92`, en % del ancho y del alto). Se puede corregir a mano en Obsidian.

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
