---
tags:
  - sistema
---

# Alertas y Telegram

## Alertas

- Tienen **gravedad** (info, aviso, crítica), **acciones** concretas (abrir sesión, abrir carrito, revisar, pausar, cancelar) y una **clave de agrupación**: el mismo problema actualiza la alerta existente en vez de crear otra, y sube de gravedad si empeora.
- Se resuelven solas cuando desaparece la causa (la sesión vuelve a estar lista, el claim se reconcilia…) o a mano.
- Cuando una operación termina, se cierran las alertas de preparación que ya no aplican.
- Lista completa y qué hacer: [[Qué hacer con cada alerta]].

## Telegram (opcional)

Configuración paso a paso: [[Configurar Telegram]]. Se configura desde el dashboard (*Ajustes · Telegram*): el token y el chat principal se guardan en el `.env` y se aplican al momento, sin reiniciar. Al conectar, el bot se configura solo (menú de comandos y descripción). Si se edita el `.env` a mano, solo se lee al arrancar.

### Chats

| Chat | Cómo se configura | Qué recibe | Qué puede hacer |
|---|---|---|---|
| **Principal** (tú o un grupo) | *Ajustes · Telegram* → **Usar como chat principal** (se guarda como `TELEGRAM_CHAT_ID`). Los de grupo empiezan por «-» | Todo: alertas, tareas de todas las cuentas y el aviso de apertura | Responder cualquier tarea y todos los comandos, incluidos `/pausa` y `/parar_todo` |
| **De una cuenta** | *Ajustes · Telegram* → **Asignar a una cuenta**, o *Cuentas → editar → Chat de Telegram* (sin reiniciar). Al vincularlo le llega una bienvenida | Las tareas y alertas de esa cuenta y el aviso de apertura de sus operaciones | Responder **solo sus tareas** («Esta tarea es de otra cuenta») y `/estado`, `/tareas`, `/id`, `/ayuda` |
| **Cualquier otro** | — | Nada | Solo recibe su chat ID como respuesta. Sus botones contestan «Este chat no está autorizado» |

### Averiguar un chat ID

- Con solo el token el bot ya funciona: quien le escriba `/start` (botón **Iniciar**) recibe el chat ID de ese chat y aparece en *Ajustes · Telegram*.
- `/id` lo muestra en cualquier chat (útil en grupos).
- *Ajustes · Telegram* lista los últimos chats que han escrito al bot (hasta 10, solo en memoria: se borran al reiniciar), con su chat ID, si ya están configurados y un botón **Probar**.
- **Enviar mensaje de prueba** manda un mensaje al chat principal; **Probar ese chat**, a cualquier otro ID. Si Telegram falla, el dashboard explica por qué (token no válido, chat no encontrado…) en lugar de dar un error.

### Qué se envía

- Alertas de **aviso** y **críticas**, y siempre los **carritos confirmados y asegurados**. La alerta de «tarea humana» no se repite: la tarea llega con sus propios botones. Una alerta se envía al crearse y otra vez solo si **sube de gravedad**; si se actualiza con la misma gravedad, no se reenvía.
- Alertas de carrito (`CART_EXPIRING`: «el carrito caduca a las HH:MM:SS», que llega a Telegram en cada umbral —con los umbrales por defecto, a 5, 2 y 1 minuto—, y, en carritos confirmados por una persona, «…: se acabó el tiempo del carrito, ¿lo has pagado?» al agotarse): mientras el carrito siga abierto llevan **💳 Ya lo he pagado** (marca el carrito como pagado) y **⏱ Quedan 5 min / 10 min / 15 min** (fija de nuevo la hora de caducidad y reinicia los avisos). **Liberar** solo está en el dashboard.
- **Tareas**: título, cuenta, `🎯 N × zona · máx. precio por entrada`, `⏱ Responde antes de las HH:MM` e instrucciones, con un botón de enlace **🌐 Abrir la web oficial** (el `url` del evento o, si no tiene, el del proveedor). Cada tarea va al chat principal y al chat de su cuenta.
  - «Inicia sesión» (se crea **al armar**; en asistencia manual sus instrucciones incluyen el **plan** de la cuenta: hora de apertura, zonas en orden, cuántas entradas como mucho y precio máximo): **✅ Sesión lista** / **❌ No puedo**. En asistencia manual, al armar, las cuentas que estaban *Lista* vuelven a *Sin sesión*: cada compra exige «Sesión lista» de nuevo. Desarmar cancela estas tareas.
  - «Añade N entradas · <zona>» (se crea **en T0** para cada cuenta con «Sesión lista», y después al momento tras cada «Sesión lista», «No pude», «no está» en una verificación, entrega parcial o carrito liberado) y «¿Están las N entradas… en el carrito?»: **un botón por cantidad**, de N a 1 en filas de 5 (hasta 20: `✅ 2 en carrito`, `✅ 1 en carrito`…), **❌ No pude**, **❓ No sé**. El mensaje recuerda que se anota al precio máximo.
  - Tras «N en carrito», el bot pregunta en ese mismo chat **«⏱ ¿Cuántos minutos le quedan al carrito en la web? Te avisaremos antes de que caduque. Cuando lo pagues, pulsa «Ya lo he pagado».»** con `5`, `8`, `10`, `15` y `20 min` y **💳 Ya lo he pagado**. Los minutos fijan la caducidad del carrito (lo mismo que `POST /api/carts/:id/expiry`, ver [[API]]) y el mensaje se queda solo con **💳 Ya lo he pagado**. Solo puede responder el chat principal o el de la cuenta del carrito. Si nadie pulsa los minutos, el carrito queda sin caducidad y sin avisos.
  - Entrega parcial (por ejemplo `✅ 1 en carrito` en una tarea de 2): se confirma esa cantidad y, en cuanto se responde, se reparten las que faltan (normalmente a la misma cuenta, en la misma zona) si el «grupo mínimo por carrito» lo permite.
- En **T0**, primero «🚦 ¡Abre la venta!» al chat principal, con el enlace oficial y cuántas cuentas no han pulsado «Sesión lista», y después las tareas. Cada persona recibe **un solo mensaje**: su tarea con «🚦 ¡Abre la venta!» encima. El aviso aparte va también a los chats de las cuentas que no reciben tarea. Unos segundos antes de T0 se abren las conexiones con Telegram (ensayo con 10 cuentas y 50 ms de ida y vuelta hasta Telegram: la tarea llega a su chat unos 35–50 ms después de T0).
- Los mensajes de cada chat salen en orden y, sumando todos, a unos 25 por segundo como mucho (las tareas de cada persona antes que sus copias en el chat principal). Si Telegram pide esperar (429) se espera lo que diga y se reenvía; si falla (5xx, página de error, corte de red o sin respuesta en 5 s) se reintenta con esperas crecientes: una tarea no se pierde.
- Al pulsar un botón, el bot contesta con un aviso breve y quita los botones de ese mensaje. Cuando una tarea se cierra por cualquier vía (Telegram, dashboard, caducidad o cancelación), el bot quita sus botones en **todos** los chats a los que la envió, también en las copias de `/tareas`. No se hace con los mensajes enviados antes de reiniciar el servidor: ahí el botón contesta «La tarea ya no está abierta».

### Comandos

- `/estado` — operaciones activas y entradas en carrito.
- `/tareas` — reenvía las tareas abiertas con sus botones (en un chat de cuenta, solo las suyas).
- `/pausa` — pausa lo que esté en marcha. **Solo chat principal.**
- `/parar_todo` — kill switch global. **Solo chat principal.** Se suelta en *Seguridad*.
- `/id` — chat ID de este chat. `/ayuda` (o `/start`) — lista de comandos.

> [!note] Botón «N en carrito» en Telegram
> Registra la cantidad pulsada al **precio máximo** (supuesto conservador: el presupuesto nunca se queda corto). Para registrar el precio exacto, responde desde el dashboard (*Tareas humanas → Están en el carrito*) en lugar de Telegram: una tarea respondida ya no se puede cambiar.

### Estado y fallos

- *Ajustes · Telegram* muestra «Token configurado», «Conectado» y «Chat principal configurado», y el detalle del último problema: «Token no válido», «Otro programa está leyendo este bot (¿hay dos servidores abiertos?)», «Sin conexión…».
- El [[Readiness]] avisa (ámbar) si Telegram está configurado pero sin conexión: las alertas seguirán en el dashboard.
- Si se pierde la conexión, el servidor vuelve a conectar solo (cada 5 s). Un mensaje que no se pudo enviar no se reintenta: el dashboard sigue siendo la referencia.
