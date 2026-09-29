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

Configuración paso a paso: [[Configurar Telegram]]. Todo se configura en el `.env`, que solo se lee al arrancar: tras cambiarlo, cierra la ventana del servidor y vuelve a abrir `INICIAR.bat`.

### Chats

| Chat | Cómo se configura | Qué recibe | Qué puede hacer |
|---|---|---|---|
| **Principal** (tú o un grupo) | `TELEGRAM_CHAT_ID` en `.env`. Los de grupo empiezan por «-» | Todo: alertas, tareas de todas las cuentas y el aviso de apertura | Responder cualquier tarea y todos los comandos, incluidos `/pausa` y `/parar_todo` |
| **De una cuenta** | *Cuentas → editar → Chat de Telegram* (sin reiniciar) | Las tareas y alertas de esa cuenta y el aviso de apertura de sus operaciones | Responder **solo sus tareas** («Esta tarea es de otra cuenta») y `/estado`, `/tareas`, `/id`, `/ayuda` |
| **Cualquier otro** | — | Nada | Solo recibe su chat ID como respuesta. Sus botones contestan «Este chat no está autorizado» |

### Averiguar un chat ID

- Con solo `TELEGRAM_BOT_TOKEN` el bot ya funciona: quien le escriba `/start` (botón **Iniciar**) recibe el chat ID de ese chat.
- `/id` lo muestra en cualquier chat (útil en grupos).
- *Ajustes · Telegram* lista los últimos chats que han escrito al bot (hasta 10, solo en memoria: se borran al reiniciar), con su chat ID, si ya están configurados y un botón **Probar**.
- **Enviar mensaje de prueba** manda un mensaje al chat principal; **Probar ese chat**, a cualquier otro ID. Si Telegram falla, el dashboard explica por qué (token no válido, chat no encontrado…) en lugar de dar un error.

### Qué se envía

- Alertas de **aviso** y **críticas**, y siempre los **carritos confirmados y asegurados**. La alerta de «tarea humana» no se repite: la tarea llega con sus propios botones.
- **Tareas**: título, cuenta, `🎯 N × zona · máx. precio por entrada`, `⏱ Responde antes de las HH:MM` e instrucciones, con un botón de enlace **🌐 Abrir la web oficial** (el `url` del evento o, si no tiene, el del proveedor). Cada tarea va al chat principal y al chat de su cuenta.
  - «Inicia sesión» (se crea **al armar**; en asistencia manual sus instrucciones incluyen el **plan** de la cuenta: hora de apertura, zonas en orden, cuántas entradas como mucho y precio máximo): **✅ Sesión lista** / **❌ No puedo**.
  - «Añade N entradas · <zona>» (se crea **en T0** para cada cuenta con «Sesión lista», y después tras cada «No pude» o entrega parcial) y «¿Están las N entradas… en el carrito?»: **un botón por cantidad** (`✅ 2 en carrito`, `✅ 1 en carrito`…, hasta 6), **❌ No pude**, **❓ No sé**. El mensaje recuerda que se anota al precio máximo.
  - Tras «en carrito», el bot pregunta en ese mismo chat **«⏱ ¿Cuántos minutos le quedan al carrito en la web?»** con `5`, `8`, `10`, `15` y `20 min`, y fija la caducidad del carrito (lo mismo que `POST /api/carts/:id/expiry`, ver [[API]]) para avisar a tiempo. Solo puede responder el chat principal o el de la cuenta del carrito. Si nadie lo pulsa, el carrito queda sin caducidad y sin avisos.
  - Entrega parcial (por ejemplo `✅ 1 en carrito` en una tarea de 2): se confirma esa cantidad y, en el siguiente ciclo del reparto, la misma cuenta recibe otra tarea con las que faltan en la misma zona si el «grupo mínimo por carrito» lo permite.
- En **T0**, «🚦 ¡Abre la venta!» al chat principal y a los chats de las cuentas de la operación, con el enlace oficial y cuántas cuentas no han pulsado «Sesión lista». Se envía en el mismo instante en que salen las tareas (ensayo: 12 ms tras T0; las tareas, 10 ms en Telegram y 26 ms en el dashboard).
- Al pulsar un botón, el bot contesta con un aviso breve y quita los botones de ese mensaje.

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
