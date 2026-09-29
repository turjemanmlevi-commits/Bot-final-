---
tags:
  - guia
  - compra
---

# Comprar entradas reales (paso a paso)

> [!important] Qué hace el sistema y qué no
> - **Coordina al grupo**: quién compra qué zona, cuántas entradas y a qué precio máximo; lleva la cuenta de los límites por persona, del presupuesto y de la caducidad de cada carrito, y avisa por el dashboard y por Telegram.
> - **No entra** en Ticketmaster, entradas.com ni realmadrid.com: no inicia sesión, no mira el inventario, no añade al carrito y **no paga**. Cada persona hace todo eso en la **web oficial**, con **su propia cuenta**.
> - Nunca se usa nada para saltarse colas virtuales, CAPTCHA, verificaciones ni límites de compra. **El pago lo hace siempre una persona.**
> - En la UE, la Directiva (UE) 2019/2161 (Directiva «Ómnibus»), incorporada al derecho español en 2021, considera práctica desleal revender a consumidores entradas compradas con medios automatizados para eludir los límites de compra u otras normas de la venta. Comprad solo para el grupo y respetad las condiciones de cada web. Ver [[Uso legítimo y guardarraíles]].

> [!tip] En resumen
> **La víspera:** arrancar, Telegram, cuentas, evento y operación (tocando en el plano las zonas en orden), y **armarla**. Cada persona recibe su **plan**.
> **El día:** cada persona inicia sesión en la web oficial y pulsa **Sesión lista**. A la hora de apertura (T0) cada una recibe «🚦 ¡Abre la venta!» y su tarea («Añade 2 entradas · Lateral Este · Primer anfiteatro, máx. 120 €») con el plano y su zona resaltada, compra en la web oficial, responde aquí y **paga**.
>
> La misma explicación, en 9 pasos y con el plano, está en el dashboard: **Cómo se compra** (menú de la izquierda, apartado *Preparar*).

Particularidades de cada web: [[Real Madrid]] · [[Ticketmaster]] · [[Entradas.com]].

## La víspera (30–45 min)

### 1. Arrancar

- Doble clic en **Sala de control** (acceso directo del Escritorio) o en **`INICIAR.bat`** (carpeta `bot final`). Comprueba Node.js (lo instala si falta), instala lo demás, compila y abre el dashboard en <http://localhost:8787>.
- Deja **abierta la ventana negra** mientras uses el sistema. Si la cierras, se para. Hacer clic dentro ya no la pausa (`INICIAR.bat` desactiva la «Edición rápida»); si aun así su título empieza por «Seleccionar», pulsa `Esc`.
- Si Windows muestra «Windows protegió su PC»: **Más información → Ejecutar de todas formas** (pasa con archivos descargados de Internet).
- ¿Primera vez? En PowerShell pega `irm https://raw.githubusercontent.com/turjemanmlevi-commits/Bot-final-/claude/confident-bell-yb79l7/instalar.ps1 | iex` y sigue [[Bajar el proyecto a tu ordenador]].

### 2. Telegram

En **Ajustes · Telegram** (unos 5 minutos, sin tocar archivos): pega el token de tu bot → **Conectar**, abre el bot y pulsa **Iniciar**, **Usar como chat principal** y **Enviar mensaje de prueba**; comprueba que llega al móvil. Detalle: [[Configurar Telegram]]. Es opcional, pero con Telegram cada persona recibe sus tareas con botones y el aviso de apertura de la venta.

### 3. Cuentas: una por persona que va a ir

**Cuentas → Nueva cuenta**:

| Campo | Qué poner |
|---|---|
| Nombre visible | Cómo la reconocéis: `Ana` |
| Proveedor | **Real Madrid**, **Ticketmaster** o **entradas.com**: donde tiene su cuenta esa persona |
| Titular (alias) | Un alias de la persona: `ana` |
| Hogar / Medio de pago (alias) | `casa-ana`, `tarjeta-ana`. Obligatorios si el evento cuenta el límite por hogar o por medio de pago |
| Verificación | **Verificada (legítima)** |
| Elegible para | `*` (cualquier evento) |
| Chat de Telegram | Opcional: esa persona pulsa **Iniciar** en el bot y su chat se elige en la lista del campo (o en *Ajustes · Telegram* → **Asignar a una cuenta**); recibe solo sus tareas y una bienvenida con cómo responder rápido |

Pulsa **Crear cuenta**. Solo **alias**: nunca emails, teléfonos, DNI ni números de socio (el formulario rechaza lo que parece un email, un teléfono o un documento). El sistema no pide ni guarda contraseñas.

### 4. Recinto

- El [[Estadio Santiago Bernabéu]] ya está creado: zonas Lateral Oeste, Lateral Este, Fondo Norte y Fondo Sur, y en cada una Nivel inferior y del primer al cuarto anfiteatro (por ejemplo, `Lateral Este · Primer anfiteatro`).
- **Ver el plano:** *Recintos · vault* → pulsa el nombre del recinto. El campo está en el centro con el **norte arriba**: Fondo Norte arriba, Fondo Sur abajo, Lateral Oeste a la izquierda y Lateral Este a la derecha. Cada grada tiene sus niveles como **anillos**: el de dentro es el más cercano al campo (Nivel inferior, que la leyenda llama «Grada / Tribuna») y el de fuera el más alto (Cuarto anfiteatro). Toca o pasa el ratón por un anillo para ver su nombre y cómo lo llama la web. En pabellones y teatros el **escenario** está arriba y las gradas forman una «U» alrededor. Es orientativo: los sectores exactos, en el plano oficial de la venta.
- Para otro recinto: **Recintos · vault → Nuevo recinto**. Escribe el nombre, la ciudad, de dónde sale el plano (el enlace al plano oficial) y las zonas: **una zona por línea**, con sus secciones después de «:» separadas por comas. «(de pie)» marca una zona sin asiento:

```text
Pista (de pie)
Grada Baja: 101, 102, 103
Grada Alta: 201, 202, 203
```

Pulsa **Crear recinto**: el sistema escribe las notas en `10 Recintos/<recinto>/` y lo abre. Si una sección se repite en varias zonas, se le antepone la zona (`Lateral Este · Grada baja`).

### 5. Evento

**Eventos → Nuevo evento**:

> [!tip] Sin escribir nada: primero dónde se vende, después el evento
> Elige **Dónde se vende** y trae el evento: con **Claude** conectado (Ajustes → Claude), Claude busca los eventos de esa web y, al elegir uno, lee su fecha, la apertura, **cuántas entradas se pueden comprar por persona** y el recinto con su **plano oficial**, donde tocas hasta 3 sitios (🟢 1ª, 🟠 2ª, 🔵 3ª preferencia; la operación empieza con ellos). También desde Telegram con **/evento**. Sin Claude: ábrelo en la web oficial y pulsa el marcador **📥 Enviar a la sala** (sin claves, cualquier web), o elígelo de la **lista oficial** (con la clave gratuita de Ticketmaster o de los partidos). Se rellenan solos el **recinto**, el nombre, el enlace, la fecha, la **apertura de la venta** (elige tu fase) y el **límite** si la web lo publica, y con **Vigilar desde: 2 días antes** la sala te avisa por Telegram. Ver [[Buscar eventos oficiales y vigilar la venta]]. Lo que la página no diga, se completa a mano:

1. **Nombre del evento**, **Recinto** y **Dónde se vende** (Real Madrid, Ticketmaster o entradas.com).
2. **Enlace oficial del evento**: la página del evento en la web oficial. Es el botón «Abrir la web oficial» de cada tarea (el sistema nunca la visita).
3. **Fecha y hora del evento** y **Apertura de la venta (T0)**, en **hora de Madrid**. En el Real Madrid, la apertura de **tu** fase (socios, Madridistas, público general…).
4. **Límites de compra**, copiados de las condiciones oficiales:

| Campo | Qué poner |
|---|---|
| Por cuenta | El máximo por cuenta que indica la venta |
| Por grupo | El máximo por titular, hogar o tarjeta, sumando todas sus cuentas |
| Por operación | El total máximo entre todos (por ejemplo, personas × límite por persona) |
| Cómo cuenta el límite | **Por titular** en Ticketmaster y en el Real Madrid casi siempre («máximo X por cliente / por socio»). **Por cuenta** solo si cada cuenta tiene de verdad su propio cupo. **Por hogar** o **Por medio de pago** si las condiciones lo dicen así |
| De dónde salen los límites | Enlace o texto de las condiciones oficiales |

5. **Vigilar desde** (apartado *Fechas*): **2 días antes** de la venta viene puesto. Manda recordatorios por Telegram (al empezar, el día antes y una hora antes) y, si el evento se eligió de la lista oficial, avisa y lo actualiza si cambia la hora de la venta.

Marca **«He comprobado estos límites en las condiciones oficiales»** solo cuando lo hayas leído en la web oficial y pulsa **Guardar evento**. Sin esa casilla, o si no se sabe cómo cuenta el límite, **no se puede armar** la operación: el sistema falla cerrado.

> [!example] Ejemplo
> Ticketmaster dice «máximo 4 entradas por cliente» y sois 3 personas: Por cuenta **4** · Por grupo **4** · Por operación **12** · Cómo cuenta: **Por titular**.

### 6. Operación

**Operaciones → Nueva operación**, o el botón **Operación** junto al evento en *Eventos*:

| Apartado | Qué poner |
|---|---|
| Evento | El que acabas de crear |
| T0 (apertura de venta, hora local) | Se rellena con la apertura del evento: compruébalo |
| Ventana (minutos) | **60** en ventas reales con cola (el formulario lo pone solo al elegir un evento de Real Madrid, Ticketmaster o entradas.com; más si esperas una cola muy larga). Cuando acaba la ventana, la operación termina y se cancelan sus tareas abiertas |
| Entradas | Cuántas queréis en total |
| Máximo por entrada (con gastos) | Lo máximo que pagaríais por entrada, **gastos de gestión incluidos** |
| Presupuesto total | Lo máximo que gastaréis entre todos |
| Grupo mínimo por carrito | Mínimo de entradas por tarea y carrito. Viene en **2**: pon **1** si cada persona compra solo la suya o si aceptáis entradas sueltas. Con 2, si alguien consigue solo 1 de 2, la que falta **no** se le vuelve a pedir. El reparto lo respeta para que varias personas compren a la vez: con 4 entradas, límite 3 por persona y grupo mínimo 2, salen dos tareas de **2 + 2** al mismo tiempo (no 3 + 1) |
| Dónde (en orden de preferencia) | **Toca en el plano** cada zona en el orden en que queréis intentarlo: cada toque añade ese anillo (grada + nivel, por ejemplo `Lateral Este · Primer anfiteatro`) y el plano lo numera 1, 2, 3… Para una grada entera (cualquier nivel) pulsa su botón en «Añadir desde el vault» (`+ Fondo Sur`, marcado *zona*). Reordena con las flechas y quita con ✕. Sin objetivos = cualquier zona del recinto |
| Asientos juntos | Viene **marcado**: la tarea pide las entradas «juntas (misma fila)». Desmárcalo si os da igual |
| Con qué cuentas | Las del grupo |
| Avisar antes de que caduque un carrito (s) | `300, 120, 60` (avisos a 5, 2 y 1 minuto, en el dashboard y en Telegram) |

Pulsa **Crear y validar**, corrige lo que salga en rojo en la pestaña *Preparación* y pulsa **Armar**. Se puede armar la víspera.

En la página de la operación, la tarjeta **«Plan de compra · dónde y en qué orden»** muestra el plano con las zonas numeradas, la lista en orden y, durante la venta, quién está intentando qué zona y qué hay ya en carrito.

Al armar, cada cuenta vuelve a *Sin sesión* (aunque alguien pulsara «Sesión lista» en un ensayo) y recibe una tarea **«Inicia sesión»** nueva con su **plan**, en *Tareas humanas* y en Telegram:

> Plan: la venta abre a las 18:05. Irás a por 1) Lateral Este · Primer anfiteatro, 2) Fondo Sur; hasta 2 entradas, máximo 120,00 € por entrada con gastos. Cuando llegue la hora te avisaremos y te diremos exactamente qué zona intentar.

Que cada persona lo lea ya, pero **«Sesión lista» se pulsa el día de la venta**, cuando tenga la sesión iniciada de verdad en la web oficial.

> [!tip] Tiempo para responder cada tarea de compra
> Cada tarea de compra se puede responder durante **30 minutos** (`MANUAL_TASK_MINUTES`, 30 por defecto): da tiempo a pasar una cola larga. Si vuestro `.env` se creó con una versión anterior, puede tener `MANUAL_TASK_MINUTES=10`, y actualizar no lo cambia: ábrelo con el Bloc de notas, pon `MANUAL_TASK_MINUTES=30` (o borra la línea), guarda y reinicia (cierra la ventana negra y vuelve a abrir **Sala de control**). Si una tarea caduca no se pierde nada: la reserva se mantiene, pasa a «¿Están las N entradas de … en el carrito?» y se responde igual.

## El día de la venta

| Cuándo | Qué pasa | Qué hacéis |
|---|---|---|
| **T−60 min** | — | Doble clic en **Sala de control** (o `INICIAR.bat`). En **Resumen**, repasa «Compra real · lista de comprobación» y comprueba que el evento y la operación que nombra son **los vuestros** (el evento de demostración «Noche Flamenca Demo» también cuenta como evento verificado). En **Ajustes · Telegram**, **Enviar mensaje de prueba**. La operación debe estar *Armada* (el botón **Comprobación previa** la comprueba) |
| **T−30 / T−15 min** | El sistema espera a cada cuenta | Cada persona **inicia sesión en la web oficial** (navegador o móvil), abre la página del evento y pulsa **Sesión lista** en *Tareas humanas* o en Telegram (en la tarea «Inicia sesión» de **esta** operación: cada compra lo pide de nuevo) |
| **T−30 s** | La operación pasa a *Congelada*: ya no se puede editar | Página del evento abierta, sesión iniciada y medio de pago a mano |
| **T0** | Pasa a *En ejecución*. Telegram envía **«🚦 ¡Abre la venta!»** con el botón a la web oficial (al chat principal y a los chats de las cuentas). Cada cuenta con «Sesión lista» recibe **«Añade N entradas · <zona>»**, en Telegram y en *Tareas humanas*, donde la tarea muestra el plano con **su zona resaltada** («Dónde está <zona> en el recinto») | Pulsa **Abrir la web oficial** y entra en la venta; si hay **cola virtual**, espera tu turno como cualquier comprador |
| **Pasada la cola** | — | Elige asientos de **esa zona**, a **ese precio máximo o menos** (con gastos), y añádelos al carrito. Después responde la tarea |
| **Entradas en el carrito** | Aparecen en *Carritos* con su cuenta atrás | **Paga ya en la web oficial** y pulsa **Ya lo he pagado** |
| **Todo cubierto** | La operación pasa a *Carrito asegurado* y se cancelan las tareas que sobran | Pagad lo que falte y, al final, **Cerrar** |

> [!note] ¿Nadie tiene «Sesión lista» en T0?
> La operación arranca igual. Quien inicie sesión después y pulse **Sesión lista** recibe su tarea al momento: el reparto reacciona a cada respuesta (y además se revisa cada 250 ms). Pero cuanto antes, mejor.

### Cómo responder a la tarea de compra

- **Están en el carrito** (dashboard): escribe **cuántas** quedaron, el **precio por entrada con gastos** y los **minutos que le quedan al carrito** (los muestra la web; el campo está vacío, «p. ej. 10») y pulsa **Están en el carrito**. Si dejas los minutos vacíos, ponlos después en *Carritos → Minutos que quedan*.
- **En Telegram**: la tarea trae **un botón por cantidad**, de la cantidad pedida a 1: `✅ 2 en carrito`, `✅ 1 en carrito`… (en filas de 5, hasta 20). Pulsa el número de entradas que tienes de verdad en el carrito. Enseguida el bot pregunta **«⏱ ¿Cuántos minutos le quedan al carrito en la web? Te avisaremos antes de que caduque. Cuando lo pagues, pulsa «Ya lo he pagado».»** con los botones `5 min`, `8 min`, `10 min`, `15 min`, `20 min` y **💳 Ya lo he pagado**: pulsa los minutos más cercanos **por debajo** de lo que diga la web (el mensaje se queda solo con **💳 Ya lo he pagado**, para cuando pagues). Así el carrito tiene cuenta atrás y os avisa antes de que se acabe el tiempo. **Si no pulsas los minutos, el carrito no tiene cuenta atrás ni avisos** (el mensaje se queda en el chat: puedes pulsarlo después, o ponerlos en *Carritos → Minutos que quedan*).
- **Si solo conseguiste algunas** (1 de 2): pulsa las que tengas. Te llega otra tarea con las que faltan en la misma zona, salvo que el «Grupo mínimo por carrito» de la operación sea mayor que las que faltan.
- **No pude**: no hay entradas en esa zona a ese precio, o la web no te deja. Te llega **la siguiente zona** de la lista al momento: el reparto reacciona a cada respuesta (en el ensayo, ~50 ms, más lo que tarde Telegram). Si ya no quedan zonas, esa cuenta no recibe más tareas.
- **No estoy seguro** (en Telegram, **❓ No sé**): la reserva se mantiene y llega «¿Están las N entradas de … en el carrito?». Mira el carrito en la web oficial y responde. Si contestas que no están (**No están** en el dashboard; en Telegram, **❌ No pude** en esa verificación), te llega al momento la siguiente zona. Si otra persona responde «en carrito» a la tarea original después de tu «No sé» (por ejemplo, desde el otro chat casi a la vez), esa respuesta se aplica a la verificación: no se pierde ni se cuenta dos veces.

Responde **en carrito** solo cuando las entradas estén de verdad en el carrito de la web oficial.

> [!note] «En carrito» desde Telegram
> Se anota la cantidad que pulsas **al precio máximo** (supuesto prudente: el presupuesto nunca se queda corto). Si quieres que conste el precio exacto, responde desde el dashboard (*Tareas humanas → Están en el carrito*) **en lugar de** Telegram: una vez respondida, la tarea ya no se puede corregir.

### Pagar

- Paga **en cuanto estén en el carrito**: los carritos de las ticketeras caducan en pocos minutos.
- *Carritos* muestra cada carrito con su cuenta atrás (si indicaste los minutos), el botón **Abrir la web oficial para pagar** y **Minutos que quedan** (`+5 min`, o escribe de 1 a 60 y pulsa **Guardar**) para poner o corregir la cuenta atrás. El dashboard y Telegram avisan antes de que se acabe (a 5, 2 y 1 minuto, si no cambiaste esos avisos). En Telegram esos avisos traen **💳 Ya lo he pagado** y **⏱ Quedan 5 / 10 / 15 min**. Sin minutos no hay cuenta atrás: vigila el reloj de la web oficial.
- Después de pagar, pulsa **Ya lo he pagado** (en *Carritos* o en Telegram). Si no lo quieres: quítalo del carrito en la web oficial y pulsa **Liberar** en *Carritos*: esas entradas se vuelven a repartir mientras la venta siga abierta.

> [!important] Si se acaba el tiempo del carrito
> Los minutos que indicáis son una **estimación**: un carrito confirmado por una persona **no caduca solo** ni se vuelve a repartir por su cuenta. Cuando se acaba el tiempo, sigue contando y llega una alerta crítica, **«<cuenta>: se acabó el tiempo del carrito, ¿lo has pagado?»** (en *Carritos* sale «Tiempo agotado: ¿lo has pagado?»). Responded:
> - **Ya lo he pagado** si se pagó.
> - **⏱ Quedan N min** en Telegram (o *Minutos que quedan* en *Carritos*) si la web aún os da tiempo: la cuenta atrás y sus avisos empiezan de nuevo.
> - **Liberar** en *Carritos* si se perdió: esas entradas se vuelven a repartir. Si la operación estaba en *Carrito asegurado* y su ventana sigue abierta, vuelve a *En ejecución* y lo que falta llega como tarea nueva.

### Terminar

- Con todas las entradas en carrito, la operación pasa a **Carrito asegurado**: se acaban las tareas de compra. Si después se libera un carrito y la ventana sigue abierta, vuelve a *En ejecución* y se reparte lo que falta.
- Si no se cubre todo, termina sola al acabar la ventana, o pulsa **Parar**.
- Cuando todos los carritos estén pagados o liberados, pulsa **Cerrar**: las cuentas quedan libres. Ver [[Pago y cierre]].

## Rapidez: qué tarda milisegundos y qué depende de vosotros

> [!info] El sistema no os hace esperar
> - A la hora exacta de T0 la operación arranca, reparte las tareas y envía el aviso «🚦 ¡Abre la venta!».
> - Reacciona a cada respuesta: tras **Sesión lista**, **No pude** o «no están» en una verificación, la tarea siguiente sale en ese mismo momento (ensayo: ~50 ms). Además revisa el reparto cada 250 ms. Telegram suele añadir menos de un segundo más.
> - Reparte **en paralelo**: si varias personas tienen «Sesión lista», cada una recibe su tarea a la vez, respetando el grupo mínimo (4 entradas, límite 3 por persona y grupo mínimo 2 → 2 + 2).
> - Lo que tarda **segundos** es la parte humana: ver el aviso, cambiar de pestaña, pasar la cola, elegir asientos y pulsar. Es lo que mide «Respuesta humana» en las métricas de la operación (desde que se crea la tarea hasta que alguien la responde).

Medido en el ensayo:

| Qué | Tiempo |
|---|---|
| De T0 a la tarea en Telegram | 10 ms |
| De T0 a la tarea en el dashboard | 26 ms |
| De T0 a «🚦 ¡Abre la venta!» | 12 ms |
| De «No pude» a la tarea con la siguiente zona | ~50 ms (el reparto reacciona a cada respuesta) |
| Simulador sin cola: primera entrada en carrito / 8 de 8 | 33–62 ms / 41–135 ms |
| Decisión del motor | ~0,04 ms |

En Telegram hay que sumar lo que tarde la red de Telegram. Las cifras del simulador son de ensayo: en una venta real **el sistema no añade nada al carrito**; lo hacéis vosotros en la web oficial, y ahí mandan la cola virtual y vuestros segundos.

Para ganar esos segundos:

1. Leed el **plan** antes de T0: ya sabéis la zona, la cantidad y el precio máximo.
2. Pulsad **Sesión lista** antes de T0, en la tarea «Inicia sesión» de esta operación (un «Sesión lista» de un ensayo no vale). Quien lo pulse después recibe su tarea en ese momento, no antes.
3. Tened abierta la página del evento en la web oficial, con la sesión iniciada y el medio de pago a mano.
4. Activad las notificaciones del bot en Telegram (y fijad su chat arriba).
5. Primero, las entradas al carrito en la web oficial. Después, un toque en **✅ N en carrito**, otro en los minutos, a pagar y **💳 Ya lo he pagado**.

## Si algo va mal

| Problema | Qué hacer |
|---|---|
| El dashboard no abre | ¿Está abierta la ventana negra? Si la cerraste, doble clic en **Sala de control** (o `INICIAR.bat`). Si dice que el puerto ya está en uso, ya hay otro servidor abierto: usa ese o ciérralo |
| Se cerró la ventana en plena venta | Vuelve a abrir **Sala de control** enseguida. El estado se guarda en la carpeta `data`: la operación aparece como *Recuperando* y vuelve a repartir en cuanto se resuelven las tareas de compra que estaban abiertas. Respondedlas cuanto antes (y las verificaciones «¿Están las N entradas…?» que aparezcan) |
| No llega nada a Telegram | Revisa **Ajustes · Telegram** (token, chat, estado). Cada persona tiene que haber pulsado **Iniciar** (`/start`) en el bot. Ver [[Configurar Telegram]]. Mientras tanto, usad *Tareas humanas* en el dashboard |
| A alguien no le llega su tarea de compra | ¿Ha pulsado **Sesión lista** en la tarea «Inicia sesión» de **esta** operación? Al armar, su cuenta volvió a *Sin sesión* y sin ese botón no recibe tareas. ¿Está su cuenta parada (*Cuentas*, etiqueta «parada»)? ¿Le quedan zonas? Tras «No pude» en la última zona no hay más |
| Una tarea caducó | No se pierde nada (cada tarea dura 30 minutos por defecto): aparece «¿Están las N entradas de … en el carrito?». Mirad el carrito en la web oficial y responded |
| Un carrito no tiene cuenta atrás | Se respondió «en carrito» sin indicar los minutos. En Telegram, busca el mensaje «⏱ ¿Cuántos minutos le quedan al carrito en la web?» y pulsa los minutos; o en *Carritos*, **Minutos que quedan**. Sin eso no hay avisos: pagad cuanto antes mirando el reloj de la web oficial |
| «Se acabó el tiempo del carrito, ¿lo has pagado?» | El carrito sigue contando hasta que alguien responda. **Ya lo he pagado** si se pagó; **⏱ Quedan N min** (Telegram) o **Minutos que quedan** (*Carritos*) si la web aún da tiempo; **Liberar** en *Carritos* si se perdió (esas entradas se vuelven a repartir) |
| La venta abrió antes de lo previsto | En la operación, **Empezar ya** |
| Alguien compró fuera del plan | Que avise a quien coordina. Los límites son **por titular**: esa compra cuenta para su cupo en la web oficial aunque el sistema no la conozca. Detén esa cuenta en *Cuentas* (**Parar cuenta**) y, si hace falta, **Reducir cantidad** en la operación |
| Una persona no va a participar | **Parar cuenta** en *Cuentas* (botón de apagado de su fila). Es seguro también **antes de T0**: la operación arranca igual con las demás; el [[Readiness]] solo avisa («Cuentas paradas (no participarán)») y esa cuenta no recibe tareas nuevas. Si ya tenía una tarea de compra abierta, esa sigue abierta con sus entradas reservadas: respondedla con **No pude** para que se repartan. Para que vuelva, pulsa el mismo botón (suelta la parada). Si prefieres quitarla de la operación: **Desarmar**, **Editar configuración**, quitarla de «Con qué cuentas», **Guardar y validar** y **Armar** de nuevo (ver el aviso de abajo) |
| El precio máximo se queda corto | En marcha solo se puede **bajar**. Para subirlo, antes de T0: **Desarmar**, **Editar configuración**, **Guardar y validar** y **Armar** de nuevo |
| Errores del vault | *Recintos · vault* muestra el error y la nota afectada. El sistema mantiene la última versión válida: corrige la nota y guarda |
| Hay que pausar | **Pausar** en la operación, o `/pausa` en el chat principal de Telegram. **Reanudar** mientras la ventana siga abierta |
| Parada de emergencia | **Seguridad → PARAR TODO** (kill switch global) o `/parar_todo` en el chat principal: pausa lo que esté en marcha. Suéltalo en *Seguridad* y pulsa **Reanudar** en la operación. **Antes de T0, suéltalo siempre**: si el kill switch global, el de un proveedor o el de la operación sigue activo a la hora de T0, la operación termina sin arrancar y habría que crear y armar otra (parar **una cuenta** no tiene ese efecto) |

> [!warning] Si desarmas y vuelves a armar
> Al **desarmar** se cancelan las tareas «Inicia sesión» de la operación (en Telegram desaparecen sus botones). Al **armar** de nuevo, las cuentas vuelven a *Sin sesión* y cada persona recibe una tarea «Inicia sesión» **nueva con el plan nuevo**: tiene que volver a pulsar **Sesión lista** en esa. Los mensajes antiguos siguen en el chat (sin botones): avisad al grupo de que vale el último y revisad la tarjeta **Plan de compra** de la operación.

Más detalle: [[Qué hacer con cada alerta]].

## Reglas

- **Una cuenta por persona real** que va a ir al evento. Cada persona compra con su cuenta.
- Respetad los **límites por persona** de cada venta. El sistema los aplica, pero manda lo que digan las condiciones oficiales.
- En el Real Madrid, las entradas de socio son **personales e intransferibles**.
- No compartáis cuentas ni contraseñas. El sistema no las pide ni las guarda.
- Si sobra alguna entrada, solo por los **canales oficiales** de reventa del organizador y en sus condiciones.

> [!example] Mensaje para el grupo (cópialo y cambia hora y evento)
> Mañana a las 18:05 abre la venta de «<evento>».
> 1. Entre 30 y 15 minutos antes, inicia sesión con **tu** cuenta en la web oficial y pulsa «Sesión lista» en la tarea «Inicia sesión» de esta compra (en Telegram o en el dashboard), aunque ya lo pulsaras en una prueba.
> 2. A la hora te llega tu tarea: pulsa «Abrir la web oficial», espera la cola si la hay y compra la zona, la cantidad y el precio máximo que te diga.
> 3. En cuanto estén en el carrito, pulsa el botón con las que tengas («✅ 2 en carrito», «✅ 1 en carrito»), después los minutos que le quedan al carrito, **paga ya en la web oficial** y pulsa «💳 Ya lo he pagado». Si no hay a ese precio, «❌ No pude» y te llega la siguiente zona.
> 4. Si el bot pregunta «se acabó el tiempo del carrito, ¿lo has pagado?», pulsa «💳 Ya lo he pagado» si lo pagaste o «⏱ Quedan N min» si la web aún te da tiempo; si se perdió, avisa a quien coordina (lo libera en el dashboard y esas entradas se vuelven a repartir).
> 5. Nunca pagues más del máximo y no compartas tu contraseña con nadie.
