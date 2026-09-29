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
> **La víspera:** arrancar, Telegram, cuentas, evento y operación, y **armarla**.
> **El día:** cada persona inicia sesión en la web oficial y pulsa **Sesión lista**. A la hora de apertura (T0) cada una recibe su tarea («Añade 2 entradas · Lateral Este · Primer anfiteatro, máx. 120 €»), compra en la web oficial, responde aquí y **paga**.

Particularidades de cada web: [[Real Madrid]] · [[Ticketmaster]] · [[Entradas.com]].

## La víspera (30–45 min)

### 1. Arrancar

- Doble clic en **`INICIAR.bat`** (en la carpeta `bot final`). Comprueba Node.js, instala lo que falte, compila y abre el dashboard en <http://localhost:8787>.
- Deja **abierta la ventana negra** mientras uses el sistema. Si la cierras, se para.
- Si Windows muestra «Windows protegió su PC»: **Más información → Ejecutar de todas formas** (pasa con archivos descargados de Internet).
- ¿Primera vez? Sigue [[Bajar el proyecto a tu ordenador]].

### 2. Telegram

Sigue [[Configurar Telegram]] (unos 10 minutos). Al terminar, en **Ajustes · Telegram** pulsa **Enviar mensaje de prueba** y comprueba que llega al móvil. Es opcional, pero con Telegram cada persona recibe sus tareas con botones y el aviso de apertura de la venta.

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
| Chat de Telegram | Opcional: el chat ID de esa persona, para que reciba solo sus tareas (ver [[Configurar Telegram]]) |

Pulsa **Crear cuenta**. Solo **alias**: nunca emails, teléfonos, DNI ni números de socio (el formulario rechaza lo que parece un email, un teléfono o un documento). El sistema no pide ni guarda contraseñas.

### 4. Recinto

- El [[Estadio Santiago Bernabéu]] ya está creado: zonas Lateral Oeste, Lateral Este, Fondo Norte y Fondo Sur, y en cada una Nivel inferior y del primer al cuarto anfiteatro (por ejemplo, `Lateral Este · Primer anfiteatro`).
- Para otro recinto: **Recintos · vault → Nuevo recinto**. Escribe el nombre, la ciudad, de dónde sale el plano (el enlace al plano oficial) y las zonas: **una zona por línea**, con sus secciones después de «:» separadas por comas. «(de pie)» marca una zona sin asiento:

```text
Pista (de pie)
Grada Baja: 101, 102, 103
Grada Alta: 201, 202, 203
```

Pulsa **Crear recinto**: el sistema escribe las notas en `10 Recintos/<recinto>/` y lo abre. Si una sección se repite en varias zonas, se le antepone la zona (`Lateral Este · Grada baja`).

### 5. Evento

**Eventos → Nuevo evento**:

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

Marca **«He comprobado estos límites en las condiciones oficiales»** solo cuando lo hayas leído en la web oficial y pulsa **Guardar evento**. Sin esa casilla, o si no se sabe cómo cuenta el límite, **no se puede armar** la operación: el sistema falla cerrado.

> [!example] Ejemplo
> Ticketmaster dice «máximo 4 entradas por cliente» y sois 3 personas: Por cuenta **4** · Por grupo **4** · Por operación **12** · Cómo cuenta: **Por titular**.

### 6. Operación

**Operaciones → Nueva operación**, o el botón **Operación** junto al evento en *Eventos*:

| Apartado | Qué poner |
|---|---|
| Evento | El que acabas de crear |
| T0 (apertura de venta, hora local) | Se rellena con la apertura del evento: compruébalo |
| Ventana (minutos) | **60** en ventas reales con cola (más si esperas una cola muy larga). Cuando acaba la ventana, la operación termina y se cancelan sus tareas abiertas |
| Entradas | Cuántas queréis en total |
| Máximo por entrada (con gastos) | Lo máximo que pagaríais por entrada, **gastos de gestión incluidos** |
| Presupuesto total | Lo máximo que gastaréis entre todos |
| Grupo mínimo por carrito | Mínimo de entradas juntas en un carrito. Pon **1** si cada persona compra solo la suya |
| Dónde (en orden de preferencia) | Pulsa las sugerencias del vault y ordénalas con las flechas. Por ejemplo: 1) `Lateral Este · Primer anfiteatro`, 2) `Fondo Sur` |
| Asientos juntos | Si lo marcas, la tarea pide las entradas «juntas (misma fila)» |
| Con qué cuentas | Las del grupo |
| Avisar antes de que caduque un carrito (s) | `300, 120, 60` (avisos a 5, 2 y 1 minuto) |

Pulsa **Crear y validar**, corrige lo que salga en rojo en la pestaña *Preparación* y pulsa **Armar**. Se puede armar la víspera.

Al armar, cada cuenta recibe su tarea **«Inicia sesión»** con su **plan**, en el dashboard y en Telegram:

> Plan: la venta abre a las 18:05. Irás a por 1) Lateral Este · Primer anfiteatro, 2) Fondo Sur; hasta 2 entradas, máximo 120,00 € por entrada con gastos…

Que cada persona lo lea ya, pero **«Sesión lista» se pulsa el día de la venta**, cuando tenga la sesión iniciada de verdad en la web oficial.

> [!tip] Colas largas
> Cada tarea de compra se puede responder durante **10 minutos**. Si esperáis una cola larga (un partido grande), añade la línea `MANUAL_TASK_MINUTES=30` al archivo `.env` y reinicia (cierra la ventana negra y vuelve a abrir `INICIAR.bat`). Si una tarea caduca no se pierde nada: pasa a «¿Están las N entradas de … en el carrito?» y se responde igual.

## El día de la venta

| Cuándo | Qué pasa | Qué hacéis |
|---|---|---|
| **T−60 min** | — | Doble clic en `INICIAR.bat`. En **Resumen**, repasa «Compra real · lista de comprobación». En **Ajustes · Telegram**, **Enviar mensaje de prueba**. La operación debe estar *Armada* (el botón **Readiness** la comprueba) |
| **T−30 / T−15 min** | El sistema espera a cada cuenta | Cada persona **inicia sesión en la web oficial** (navegador o móvil), abre la página del evento y pulsa **Sesión lista** en *Tareas humanas* o en Telegram |
| **T−30 s** | La operación pasa a *Congelada*: ya no se puede editar | Página del evento abierta, sesión iniciada y medio de pago a mano |
| **T0** | Pasa a *En ejecución*. Telegram envía **«🚦 ¡Abre la venta!»** con el botón a la web oficial. Cada cuenta con «Sesión lista» recibe **«Añade N entradas · <zona>»** | Pulsa **Abrir la web oficial** y entra en la venta; si hay **cola virtual**, espera tu turno como cualquier comprador |
| **Pasada la cola** | — | Elige asientos de **esa zona**, a **ese precio máximo o menos** (con gastos), y añádelos al carrito. Después responde la tarea |
| **Entradas en el carrito** | Aparecen en *Carritos* con su cuenta atrás | **Paga ya en la web oficial** y pulsa **Ya lo he pagado** |
| **Todo cubierto** | La operación pasa a *Carrito asegurado* y se cancelan las tareas que sobran | Pagad lo que falte y, al final, **Cerrar** |

> [!note] ¿Nadie tiene «Sesión lista» en T0?
> La operación arranca igual. Quien inicie sesión después y pulse **Sesión lista** recibe su tarea en menos de un segundo. Pero cuanto antes, mejor.

### Cómo responder a la tarea de compra

- **Están en el carrito**: indica **cuántas** quedaron, el **precio por entrada con gastos** y los **minutos que le quedan al carrito** (los muestra la web). En Telegram: pulsa **✅ N en carrito** y después los minutos.
- **No pude**: no hay entradas en esa zona a ese precio, o la web no te deja. Te llega **la siguiente zona** de la lista en menos de un segundo. Si ya no quedan zonas, esa cuenta no recibe más tareas.
- **No estoy seguro** (en Telegram, **❓ No sé**): la reserva se mantiene y llega «¿Están las N entradas de … en el carrito?». Mira el carrito en la web oficial y responde.

Responde **Están en el carrito** solo cuando las entradas estén de verdad en el carrito de la web oficial.

> [!note] «En carrito» desde Telegram
> Se anota la cantidad que pulsas **al precio máximo** (supuesto prudente: el presupuesto nunca se queda corto). Si quieres que conste el precio exacto, responde desde el dashboard (*Tareas humanas → Están en el carrito*).

### Pagar

- Paga **en cuanto estén en el carrito**: los carritos de las ticketeras caducan en pocos minutos.
- *Carritos* muestra cada carrito con su cuenta atrás (si indicaste los minutos) y el botón **Abrir la web oficial para pagar**. El dashboard y Telegram avisan antes de que caduque.
- Después de pagar, pulsa **Ya lo he pagado**. Si no lo quieres: quítalo del carrito en la web oficial y pulsa **Liberar** (mientras la operación siga en marcha, ese cupo vuelve a quedar libre).

### Terminar

- Con todas las entradas en carrito, la operación pasa a **Carrito asegurado**: se acaban las tareas de compra.
- Si no se cubre todo, termina sola al acabar la ventana, o pulsa **Parar**.
- Cuando todos los carritos estén pagados o liberados, pulsa **Cerrar**: las cuentas quedan libres. Ver [[Pago y cierre]].

## Rapidez: qué tarda milisegundos y qué depende de vosotros

> [!info] El sistema no os hace esperar
> - A la hora exacta de T0 la operación arranca, reparte las tareas y envía el aviso «🚦 ¡Abre la venta!».
> - Comprueba cada 250 ms: tras **Sesión lista** o **No pude**, la tarea siguiente aparece en el dashboard en **menos de un segundo**. Telegram suele añadir menos de un segundo más.
> - Lo que tarda **segundos** es la parte humana: ver el aviso, cambiar de pestaña, elegir asientos y pulsar. Es lo que mide «Respuesta humana» en las métricas de la operación (desde que se crea la tarea hasta que alguien la responde).

Para ganar esos segundos:

1. Leed el **plan** antes de T0: ya sabéis la zona, la cantidad y el precio máximo.
2. Pulsad **Sesión lista** antes de T0. Quien lo pulse después recibe su tarea en ese momento, no antes.
3. Tened abierta la página del evento en la web oficial, con la sesión iniciada y el medio de pago a mano.
4. Activad las notificaciones del bot en Telegram (y fijad su chat arriba).
5. Primero, las entradas al carrito en la web oficial. Después, un toque en **✅ N en carrito** y a pagar.

## Si algo va mal

| Problema | Qué hacer |
|---|---|
| El dashboard no abre | ¿Está abierta la ventana negra? Si la cerraste, doble clic en `INICIAR.bat`. Si dice que el puerto ya está en uso, ya hay otro servidor abierto: usa ese o ciérralo |
| Se cerró la ventana en plena venta | Vuelve a abrir `INICIAR.bat` enseguida. El estado se guarda en la carpeta `data`: la operación aparece como *Recuperando* y sigue cuando se responden las tareas que estaban abiertas |
| No llega nada a Telegram | Revisa **Ajustes · Telegram** (token, chat, estado). Cada persona tiene que haber pulsado **Iniciar** (`/start`) en el bot. Ver [[Configurar Telegram]]. Mientras tanto, usad *Tareas humanas* en el dashboard |
| A alguien no le llega su tarea de compra | ¿Ha pulsado **Sesión lista**? Sin eso no recibe tareas. ¿Le quedan zonas? Tras «No pude» en la última zona no hay más |
| Una tarea caducó | No se pierde nada: aparece «¿Están las N entradas de … en el carrito?». Mirad el carrito en la web oficial y responded |
| La venta abrió antes de lo previsto | En la operación, **Empezar ya** |
| Alguien compró fuera del plan | Que avise a quien coordina. Los límites son **por titular**: esa compra cuenta para su cupo en la web oficial aunque el sistema no la conozca. Detén esa cuenta en *Cuentas* (**Parar cuenta**) y, si hace falta, **Reducir cantidad** en la operación |
| El precio máximo se queda corto | En marcha solo se puede **bajar**. Para subirlo, antes de T0: **Desarmar**, editar y **Armar** de nuevo |
| Errores del vault | *Recintos · vault* muestra el error y la nota afectada. El sistema mantiene la última versión válida: corrige la nota y guarda |
| Hay que pausar | **Pausar** en la operación, o `/pausa` en el chat principal de Telegram. **Reanudar** mientras la ventana siga abierta |
| Parada de emergencia | **Seguridad → PARAR TODO** (kill switch global) o `/parar_todo` en el chat principal. Suéltalo en *Seguridad* antes de T0: con un kill switch activo la operación no arranca |

Más detalle: [[Qué hacer con cada alerta]].

## Reglas

- **Una cuenta por persona real** que va a ir al evento. Cada persona compra con su cuenta.
- Respetad los **límites por persona** de cada venta. El sistema los aplica, pero manda lo que digan las condiciones oficiales.
- En el Real Madrid, las entradas de socio son **personales e intransferibles**.
- No compartáis cuentas ni contraseñas. El sistema no las pide ni las guarda.
- Si sobra alguna entrada, solo por los **canales oficiales** de reventa del organizador y en sus condiciones.

> [!example] Mensaje para el grupo (cópialo y cambia hora y evento)
> Mañana a las 18:05 abre la venta de «<evento>».
> 1. Entre 30 y 15 minutos antes, inicia sesión con **tu** cuenta en la web oficial y pulsa «Sesión lista» (en Telegram o en el dashboard).
> 2. A la hora te llega tu tarea: pulsa «Abrir la web oficial», espera la cola si la hay y compra la zona, la cantidad y el precio máximo que te diga.
> 3. En cuanto estén en el carrito, pulsa «✅ N en carrito» y **paga ya**. Si no hay a ese precio, «No pude» y te llega la siguiente zona.
> 4. Nunca pagues más del máximo y no compartas tu contraseña con nadie.
