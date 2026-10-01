---
tags:
  - guia
  - telegram
---

# Configurar Telegram

Con Telegram, cada persona recibe en el móvil **sus tareas con botones**, el aviso **«🚦 ¡Abre la venta!»** a la hora exacta y las alertas importantes (por ejemplo, un carrito a punto de caducar). Es opcional, pero muy recomendable para una compra real. Se configura **desde el dashboard en 5 minutos, sin tocar archivos ni reiniciar**: *Ajustes · Telegram* tiene los mismos pasos.

## Paso a paso

1. **Crea el bot.** En Telegram abre **@BotFather**, envía `/newbot`, ponle un nombre (p. ej. «Entradas Amir») y un usuario que termine en `bot`. Te contesta con el **token**: la línea larga debajo de «Use this token to access the HTTP API» (parece `123456789:AA…`).
2. **Pégalo en el dashboard.** *Ajustes · Telegram* → **1 · Conecta tu bot** → pega el token → **Conectar**. Se comprueba con Telegram, se guarda en el archivo `.env` de tu PC y el bot queda conectado al momento. Además el bot **se configura solo**: menú de comandos (`/tareas`, `/estado`, `/ayuda`…) y la descripción que ve quien lo abre. Si pegas el mensaje entero de @BotFather, se queda solo con el token.
3. **Abre el bot y pulsa «Iniciar».** Botón **Abrir @tu_bot** del paso 2. El bot te contesta con el número de tu chat y tu nombre aparece en el dashboard al momento.
4. **Elige tu chat principal.** Paso **3** → **Usar como chat principal** junto a tu nombre. Se guarda y te llega la bienvenida con cómo responder rápido.
5. **Prueba.** Paso **4** → **Enviar mensaje de prueba**. Debe llegarte «✅ Prueba de la sala de control».

Al reiniciar el servidor (o el ordenador), el bot se conecta solo con lo guardado. Actualizar con el comando de instalación no toca tu `.env`: el token y el chat se conservan.

> [!tip] Si prefieres el archivo `.env`
> Son dos líneas: `TELEGRAM_BOT_TOKEN=` (el token) y `TELEGRAM_CHAT_ID=` (el número del chat). Editadas a mano solo se leen al arrancar: cierra la ventana negra y vuelve a abrir **Sala de control**. Desde el dashboard no hace falta reiniciar.

## Grupo (opcional)

Si queréis verlo todo en un chat de grupo:

1. Crea un grupo de Telegram con las personas del grupo de compra y añade el bot.
2. Escribe `/id` en el grupo (si no contesta, `/id@usuario_de_tu_bot`). El bot contesta con el chat ID del grupo, que **empieza por «-»** (a menudo `-100…`).
3. Ponlo como chat principal: *Ajustes · Telegram* → paso **3** → «O escribe el chat ID» → **Usar este chat**.

> [!warning] Quien está en el chat principal puede con todo
> Cualquiera del chat principal puede pulsar los botones de **cualquier** tarea y usar `/pausa` y `/parar_todo`. Mete solo a personas del grupo y acordad que cada una responde **solo sus tareas**. Si Telegram convierte el grupo en supergrupo, su ID cambia: repite `/id`.

## Un chat por persona

Para que cada persona reciba en su propio chat solo lo suyo:

1. La persona abre el bot y pulsa **Iniciar**. El bot le contesta con su número y aparece en *Ajustes · Telegram → Cada persona en su chat*.
2. En su fila, **Asignar a una cuenta** → elige su cuenta. Le llega al momento un mensaje de bienvenida con cómo responder rápido. No hace falta reiniciar.
3. También se puede en **Cuentas → editar → Chat de Telegram**: el campo ofrece los chats que han escrito al bot.

Esa persona recibe las tareas y alertas de **su cuenta** y el aviso de apertura de la venta, y **solo puede responder sus propias tareas**. El chat principal sigue recibiéndolo todo. Para comprobarlo, pulsa **Probar** junto a su chat en *Ajustes · Telegram*.

## Qué llega

- **Al armar la operación — «Inicia sesión», con el plan de la cuenta**: «Plan: la venta abre a las 18:05. Irás a por 1) Lateral Este · Primer anfiteatro, 2) Fondo Sur; hasta 2 entradas, máximo 120,00 € por entrada con gastos…». Botones: **🌐 Abrir la web oficial**, **✅ Sesión lista**, **❌ No puedo**. «Sesión lista» se pulsa el día de la venta, con la sesión iniciada de verdad en la web oficial. Se pide **en cada compra**: al armar, la cuenta vuelve a *Sin sesión* aunque lo pulsaras en un ensayo. Si la operación se desarma, esta tarea se cancela y sus botones desaparecen; al volver a armar llega otra con el plan nuevo.
- **En T0 — «🚦 ¡Abre la venta!»**, a la hora exacta, al chat principal con el botón **🌐 Abrir la web oficial** y, si hace falta, cuántas cuentas no han pulsado «Sesión lista». En el chat de cada cuenta llega en el mismo mensaje que su tarea de compra (un solo mensaje); quien no recibe tarea recibe el aviso aparte.
- **En T0 — la tarea de compra** de cada cuenta con «Sesión lista»: «Añade 2 entradas · Lateral Este · Primer anfiteatro», con `🎯 2 × Lateral Este · Primer anfiteatro · máx. 120,00 € por entrada` y `⏱ Responde antes de las HH:MM` (30 minutos después, por defecto). Botones:
  - **🌐 Abrir la web oficial**;
  - **un botón por cantidad**, de la cantidad pedida a 1: `✅ 2 en carrito`, `✅ 1 en carrito` (en filas de 5, hasta 20). Pulsa el número de entradas que tienes de verdad en el carrito;
  - **❌ No pude** (te llega al momento la siguiente zona) y **❓ No sé** (llega «¿Están las N entradas de … en el carrito?», con los mismos botones).
- **Después de «N en carrito»** el bot pregunta **«⏱ ¿Cuántos minutos le quedan al carrito en la web? Te avisaremos antes de que caduque. Cuando lo pagues, pulsa «Ya lo he pagado».»** con `5 min`, `8 min`, `10 min`, `15 min`, `20 min` y **💳 Ya lo he pagado**. Pulsa los minutos más cercanos por debajo de lo que diga la web: el mensaje se queda solo con **💳 Ya lo he pagado**, para cuando pagues. Sin los minutos, el carrito no tiene cuenta atrás ni avisos.
- **Avisos del carrito**: antes de que se acabe el tiempo (con los avisos por defecto, un mensaje a 5 minutos, otro a 2 y otro a 1 minuto) y, cuando se acaba, **«<cuenta>: se acabó el tiempo del carrito, ¿lo has pagado?»**. Los minutos son una estimación: el carrito **no** se da por perdido solo. Estos avisos traen **💳 Ya lo he pagado** y **⏱ Quedan 5 min / 10 min / 15 min** (si la web aún te da tiempo: la cuenta atrás empieza de nuevo). Si se perdió, **Liberar** se pulsa en el dashboard (*Carritos*) y esas entradas se vuelven a repartir.
- **Otras alertas** de aviso y críticas (resultado dudoso, kill switch…) y los **carritos confirmados y asegurados**.

Al pulsar un botón, el bot confirma con un aviso breve («Anotadas 2 en carrito ✅», «Te avisaremos antes de que caduque (8 min).», «Pagado ✅ (2 entradas)») y quita los botones de ese mensaje (también el enlace: para volver a la web usa el de «¡Abre la venta!» o el de la tarea siguiente). Cuando una tarea se cierra por cualquier vía (respondida en Telegram o en el dashboard, caducada o cancelada), **sus botones desaparecen en todos los chats** a los que se envió (el principal y el de la cuenta). Si aun así queda algún botón de una tarea cerrada (por ejemplo, de un mensaje de `/tareas` o de antes de reiniciar el servidor), contesta «La tarea ya no está abierta».

> [!note] «N en carrito» desde Telegram
> Se anota la cantidad que pulsas **al precio máximo** (supuesto prudente: el presupuesto nunca se queda corto). Si quieres que conste el precio exacto por entrada, responde desde el dashboard **en lugar de** Telegram: *Tareas humanas → Están en el carrito*. Una tarea ya respondida no se puede corregir.

## Comandos

El menú del bot se pone solo al conectarlo (botón **Menú** junto a la caja de texto de Telegram).

| Comando | Qué hace | Quién |
|---|---|---|
| `/start` | En un chat configurado, cómo responder rápido. En uno nuevo, contesta con su número de chat | Cualquier chat |
| `/id` | Muestra el número de este chat | Cualquier chat |
| `/tareas` | Vuelve a enviar tus tareas abiertas con sus botones (en el chat principal, todas) | Chats configurados |
| `/estado` | Operaciones activas y cuántas entradas hay en carrito | Chats configurados |
| `/ayuda` | Cómo responder rápido y la lista de comandos | Chats configurados |
| `/evento` | Crear un evento con Claude: web de venta → evento → datos → **✅ Crear** → plano oficial y hasta 3 zonas (🟢 1ª, 🟠 2ª, 🔵 3ª) | **Solo el chat principal** |
| `/top` | ⭐ Los grandes partidos del año: tocar uno lo prepara (vigilancia desde 2 semanas antes y 1 entrada por cuenta) | **Solo el chat principal** |
| `/pausa` | Pausa todas las operaciones en marcha | **Solo el chat principal** |
| `/parar_todo` | Kill switch global: se para todo. Se suelta en el dashboard (*Seguridad*) | **Solo el chat principal** |

A cualquier otro chat que escriba al bot solo se le contesta con su número: no recibe nada ni puede mandar nada.

> [!tip] «Entrad ya en la web»
> Con una compra armada, **30, 10 y 2 minutos antes** de que abra la venta el bot avisa a las personas cuya cuenta aún no tiene **✅ Sesión lista**, con el botón a la web oficial: que entren, inicien sesión y se pongan en la sala de espera. A la hora exacta llega a cada una su zona y cuántas.

## Problemas frecuentes

| Lo que ves | Qué hacer |
|---|---|
| «Sin configurar» en *Ajustes · Telegram* | Pega el token en el paso 1 y pulsa **Conectar** |
| «Telegram no reconoce ese token» | Está mal copiado. En @BotFather: `/mybots` → tu bot → *API Token*, cópialo de nuevo y pégalo |
| «No se pudo conectar con Telegram» | Revisa la conexión a Internet del ordenador y vuelve a pulsar **Conectar** |
| «Otro programa está leyendo este bot (¿hay dos servidores abiertos?)» | Hay dos ventanas de `INICIAR.bat` abiertas, o el mismo token en otro ordenador. Cierra la otra |
| «Falta el chat principal» | Pasos 3 y 4 |
| «Telegram no deja escribir al chat…» | Un bot no puede escribir a quien no lo ha iniciado: abre el bot, pulsa **Iniciar** y vuelve a probar. En un grupo, el bot tiene que estar dentro |
| «Este chat no está autorizado» al pulsar un botón | Ese chat no es el principal ni el de ninguna cuenta: asígnalo en *Ajustes · Telegram* |
| «Esta tarea es de otra cuenta» | Un chat personal ha pulsado una tarea ajena. Que la responda su dueño o el chat principal |
| Tras reiniciar no aparece quien escribió al bot | La lista de chats vive en memoria: que vuelva a pulsar **Iniciar** (los ya asignados no lo necesitan) |

## Seguridad

- El token es **secreto**: quien lo tenga controla el bot. No lo mandes por chat ni lo enseñes en capturas.
- Solo se guarda en el archivo `.env` de tu ordenador, que **no se sube a GitHub** (está excluido en `.gitignore`). El dashboard nunca lo vuelve a mostrar y no aparece en los registros.
- Si se filtra: en @BotFather, `/revoke` → elige el bot → copia el token nuevo → *Ajustes · Telegram* → **Cambiar token** → pégalo → **Conectar**.
- Solo el propio dashboard puede cambiar el token (otra web abierta en el navegador no puede).
- El bot solo atiende al chat principal y a los chats asignados a cuentas.

Detalle técnico: [[Alertas y Telegram]]. Para la compra: [[Comprar entradas reales (paso a paso)]].
