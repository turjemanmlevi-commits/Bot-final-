---
tags:
  - guia
  - telegram
---

# Configurar Telegram

Con Telegram, cada persona recibe en el móvil **sus tareas con botones**, el aviso **«🚦 ¡Abre la venta!»** a la hora exacta y las alertas importantes (por ejemplo, un carrito a punto de caducar). Es opcional, pero muy recomendable para una compra real. Son unos 10 minutos y los mismos pasos que ves en **Ajustes · Telegram** del dashboard.

## Paso a paso

1. **Crea el bot.** En Telegram abre **@BotFather**, envía `/newbot`, ponle un nombre (p. ej. «Entradas Ana») y un usuario que termine en `bot` (p. ej. `entradas_ana_bot`). Copia el **token** que te da (parece `123456789:AA…`).
2. **Pon el token en `.env`.** En la carpeta `bot final`, clic derecho en `.env` → *Abrir con* → *Bloc de notas*. Busca la línea `TELEGRAM_BOT_TOKEN=` (casi al final) y pega el token justo detrás del `=`, sin espacios ni comillas. Si esa línea empieza por `#`, borra el `#` y el espacio. Guarda.
3. **Reinicia.** Cierra la ventana negra del servidor y vuelve a abrir **Sala de control** (o `INICIAR.bat`). En *Ajustes · Telegram* debe aparecer «Token configurado» y «Conectado».
4. **Averigua tu chat ID.** Abre tu bot en Telegram (en *Ajustes · Telegram* tienes el botón **Abrir el bot en Telegram**) y pulsa **Iniciar**. El bot te contesta con el **chat ID** de ese chat. También aparece en *Ajustes · Telegram → Chats que han escrito al bot*, con un botón para copiarlo.
5. **Pon el chat en `.env`.** Pega el número justo detrás de `TELEGRAM_CHAT_ID=` (con el signo `-` delante si es un grupo). Guarda y **reinicia** otra vez (paso 3).
6. **Prueba.** En *Ajustes · Telegram*, pulsa **Enviar mensaje de prueba**. Debe llegarte «✅ Prueba del Ticket Orchestrator».

Las dos líneas quedan así (con tus valores):

```ini
TELEGRAM_BOT_TOKEN=123456789:AAH-ejemplo-no-real
TELEGRAM_CHAT_ID=123456789
```

> [!tip] ¿No ves el archivo `.env`?
> Lo crea `INICIAR.bat` la primera vez que lo abres (es una copia de `.env.example`). Si no lo ves, activa «Extensiones de nombre de archivo» en el Explorador (menú *Ver → Mostrar*). Al guardar con el Bloc de notas, comprueba que no se queda como `.env.txt`: en *Tipo* elige «Todos los archivos».

> [!important] El `.env` solo se lee al arrancar
> Cada vez que lo cambies, cierra la ventana negra y vuelve a abrir **Sala de control** (o `INICIAR.bat`). Actualizar con el comando de instalación no toca tu `.env`: el token y el chat se conservan.

## Grupo (opcional)

Si queréis verlo todo en un chat de grupo:

1. Crea un grupo de Telegram con las personas del grupo de compra y añade el bot.
2. Escribe `/id` en el grupo (si no contesta, `/id@usuario_de_tu_bot`). El bot contesta con el chat ID del grupo, que **empieza por «-»** (a menudo `-100…`).
3. Ponlo como `TELEGRAM_CHAT_ID`, con el signo menos, y reinicia.

> [!warning] Quien está en el chat principal puede con todo
> Cualquiera del chat principal puede pulsar los botones de **cualquier** tarea y usar `/pausa` y `/parar_todo`. Mete solo a personas del grupo y acordad que cada una responde **solo sus tareas**. Si Telegram convierte el grupo en supergrupo, su ID cambia: repite `/id`.

## Un chat por persona

Para que cada persona reciba en su propio chat solo lo suyo:

1. La persona abre el bot y pulsa **Iniciar** (o escribe `/id`). El bot le contesta con su número.
2. Te pasa ese número, o lo ves en *Ajustes · Telegram → Chats que han escrito al bot*.
3. **Cuentas → editar** su cuenta → **Chat de Telegram** → pega el número → **Guardar cambios**. No hace falta reiniciar.

Esa persona recibe las tareas y alertas de **su cuenta** y el aviso de apertura de la venta, y **solo puede responder sus propias tareas**. El chat principal sigue recibiéndolo todo. Para comprobarlo, pulsa **Probar** junto a su chat en *Ajustes · Telegram* (o escribe su número en «Otro chat ID» → **Probar ese chat**).

## Qué llega

- **Al armar la operación — «Inicia sesión», con el plan de la cuenta**: «Plan: la venta abre a las 18:05. Irás a por 1) Lateral Este · Primer anfiteatro, 2) Fondo Sur; hasta 2 entradas, máximo 120,00 € por entrada con gastos…». Botones: **🌐 Abrir la web oficial**, **✅ Sesión lista**, **❌ No puedo**. «Sesión lista» se pulsa el día de la venta, con la sesión iniciada de verdad en la web oficial.
- **En T0 — «🚦 ¡Abre la venta!»**, a la hora exacta, al chat principal y a los chats de las cuentas de la operación, con el botón **🌐 Abrir la web oficial** y, si hace falta, cuántas cuentas no han pulsado «Sesión lista».
- **En T0 — la tarea de compra** de cada cuenta con «Sesión lista»: «Añade 2 entradas · Lateral Este · Primer anfiteatro», con `🎯 2 × Lateral Este · Primer anfiteatro · máx. 120,00 € por entrada` y `⏱ Responde antes de las HH:MM`. Botones:
  - **🌐 Abrir la web oficial**;
  - **un botón por cantidad**: `✅ 2 en carrito`, `✅ 1 en carrito` (hasta 6). Pulsa el número de entradas que tienes de verdad en el carrito;
  - **❌ No pude** (te llega la siguiente zona) y **❓ No sé** (llega «¿Están las N entradas de … en el carrito?»).
- **Después de «en carrito»** el bot pregunta **«⏱ ¿Cuántos minutos le quedan al carrito en la web? Te avisaremos antes de que caduque.»** con `5 min`, `8 min`, `10 min`, `15 min` y `20 min`. Pulsa el más cercano por debajo de lo que diga la web. Sin esto, el carrito no tiene cuenta atrás ni avisos de caducidad.
- **Alertas** de aviso y críticas (carrito a punto de caducar, carrito caducado, resultado dudoso…) y los **carritos confirmados y asegurados**.

Al pulsar un botón, los botones de ese mensaje desaparecen (también el enlace: para volver a la web usa el de «¡Abre la venta!» o el de la tarea siguiente) y el bot confirma con un aviso breve («Anotadas 2 en carrito ✅», «Te avisaremos antes de que caduque (8 min).»). Si la misma tarea está también en otro chat (el principal y el de la cuenta) y ya se respondió, sus botones contestan «La tarea ya no está abierta».

> [!note] «N en carrito» desde Telegram
> Se anota la cantidad que pulsas **al precio máximo** (supuesto prudente: el presupuesto nunca se queda corto). Si quieres que conste el precio exacto por entrada, responde desde el dashboard **en lugar de** Telegram: *Tareas humanas → Están en el carrito*. Una tarea ya respondida no se puede corregir.

## Comandos

| Comando | Qué hace | Quién |
|---|---|---|
| `/start` | En un chat configurado, la ayuda. En uno nuevo, contesta con su chat ID | Cualquier chat |
| `/id` | Muestra el chat ID de este chat | Cualquier chat |
| `/estado` | Operaciones activas y cuántas entradas hay en carrito | Chats configurados |
| `/tareas` | Vuelve a enviar tus tareas abiertas con sus botones (en el chat principal, todas) | Chats configurados |
| `/pausa` | Pausa todas las operaciones en marcha | **Solo el chat principal** |
| `/parar_todo` | Kill switch global: se para todo. Se suelta en el dashboard (*Seguridad*) | **Solo el chat principal** |
| `/ayuda` | Lista de comandos | Chats configurados |

A cualquier otro chat que escriba al bot solo se le contesta con su chat ID: no recibe nada ni puede mandar nada.

## Problemas frecuentes

| Lo que ves | Qué hacer |
|---|---|
| «Sin token» en *Ajustes · Telegram* | Falta `TELEGRAM_BOT_TOKEN` en `.env`, la línea sigue empezando por `#` o no has reiniciado |
| «Token no válido» | El token está mal copiado. En @BotFather: `/mybots` → tu bot → *API Token*. Cópialo de nuevo, guarda y reinicia |
| «Otro programa está leyendo este bot (¿hay dos servidores abiertos?)» | Hay dos ventanas de `INICIAR.bat` abiertas, o el mismo token en otro ordenador. Cierra la otra |
| «Falta TELEGRAM_CHAT_ID» | Haz los pasos 4 y 5 |
| La prueba dice «Telegram no encuentra el chat…» | Un bot no puede escribir a quien no lo ha iniciado: abre el bot, pulsa **Iniciar** y vuelve a probar. En un grupo, el bot tiene que estar dentro |
| No llega el mensaje | Pulsa **Iniciar** en el bot primero. Revisa que el número es exacto (con «-» si es un grupo) y que has reiniciado después de editar `.env` |
| «Este chat no está autorizado» al pulsar un botón | Ese chat no es el principal ni el de ninguna cuenta. Configúralo |
| «Esta tarea es de otra cuenta» | Un chat personal ha pulsado una tarea ajena. Que la responda su dueño o el chat principal |

## Seguridad

- El token es **secreto**: quien lo tenga controla el bot. No lo mandes por chat ni lo enseñes en capturas.
- El archivo `.env` **no se sube a GitHub** (está excluido en `.gitignore`).
- Si se filtra: en @BotFather, `/revoke` → elige el bot → pon el token nuevo en `.env` y reinicia.
- El bot solo atiende al chat principal y a los chats puestos en las cuentas.

Detalle técnico: [[Alertas y Telegram]]. Para la compra: [[Comprar entradas reales (paso a paso)]].
