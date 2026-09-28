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

Con `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID` en el `.env`:

- Llegan al chat las alertas de aviso y críticas, más los carritos confirmados y asegurados.
- Las **tareas humanas** llegan con botones (*En carrito*, *No pude*, *No sé*, *Sesión lista*). Si una cuenta tiene su propio `telegramChatId`, esa persona recibe sus tareas en su chat.
- Comandos: `/estado`, `/tareas`, `/pausa` (pausa lo que esté en marcha), `/parar_todo` (kill switch global), `/ayuda`.
- Solo se aceptan mensajes del chat configurado y de los chats de las cuentas. Los comandos que paran cosas, solo del chat principal.

> [!note] Botón «En carrito» en Telegram
> Registra la cantidad pedida al precio máximo (supuesto conservador). Para registrar la cantidad y el precio exactos, responde desde el dashboard.
