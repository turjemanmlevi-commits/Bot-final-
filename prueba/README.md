# Prueba local: partido del femenino → carrito → Telegram

Pulsas **Hacer prueba** en `http://127.0.0.1:3000` y el bot hace esto:

1. Abre un Chrome con **tu perfil guardado**, donde queda tu sesión del Real Madrid.
2. Entra en la página de compra del partido. Las del femenino son `tickets.realmadrid.com/realmadrid_femenino/select/<id>` (plataforma Onebox).
3. Pasa la cola si la hay, **esperando su turno**. Hace login con tu cuenta.
4. Elige zona y cantidad según tus preferencias y precio máximo. Pulsa **Añadir al carrito**.
5. Detecta el carrito y lee zonas, total y caducidad. Hace una captura.
6. Te manda por **Telegram** el mensaje *«¿Quieres comprar las entradas?»* con la captura y estos botones:
   - **🛒 Comprar entradas**: enlace al carrito. Solo aparece si la URL es pública.
   - **✅ Sí, ábreme el carrito**: trae al frente la ventana del bot con el carrito. **El pago lo haces tú.**
   - **❌ No, liberar**: cierra el navegador del bot y el carrito se libera.

Lo que el bot **no hace nunca**: pagar, resolver CAPTCHAs, saltarse colas o superar el límite de entradas.
Si aparece login, verificación o algo que no sabe seleccionar, te avisa por Telegram y en el panel. Tú lo resuelves en su ventana y él sigue.

## Puesta en marcha (en tu PC)

```bash
npm install
npx playwright install chromium          # solo la primera vez
cp prueba/.env.example prueba/.env       # y rellena Telegram (opcional)
npm run prueba                           # → abre http://127.0.0.1:3000
```

### Telegram
1. Crea un bot en Telegram con **@BotFather** y copia el token en `TELEGRAM_BOT_TOKEN`.
2. Escribe «hola» a tu bot. Luego ejecuta `npm run prueba:chat-id` y copia el número en `TELEGRAM_CHAT_ID`.
3. Reinicia `npm run prueba`. El panel mostrará «Telegram: Conectado como @tu_bot».

Sin Telegram también funciona: la pregunta de comprar aparece en el panel.

## Modos

| Modo | Qué abre | Para qué |
|---|---|---|
| **Simulado** | Réplica local del flujo en `/mock/...`: login, cola opcional, zonas con una agotada, carrito con temporizador y botón *Pagar* que no hace nada | Probar el bot y Telegram de principio a fin sin tocar la web real |
| **Web real** | La URL del partido en `tickets.realmadrid.com`, con ventana **siempre visible** | La prueba de verdad con tu cuenta |

### Primera prueba real
- **Login**: la primera vez, inicia sesión tú en la ventana del bot. Queda guardado en `data/prueba/perfil-navegador/`. La próxima vez ya entra directo. También puedes poner `RM_EMAIL`/`RM_PASSWORD`, aunque es opcional.
- **Selección**: los selectores de la web real **no se han podido verificar todavía**. Desde el servidor donde se escribió esto, `tickets.realmadrid.com` responde con un bloqueo de Cloudflare. El bot busca bloques con precio en € y un control de cantidad (desplegable, campo numérico o botón «+»). Después pulsa *Añadir al carrito / Comprar / Continuar*. Si no lo consigue, pasa a **modo asistido**: te pide que selecciones tú y él detecta el carrito y te avisa igual.
- En cada fallo se guarda una captura en `data/prueba/capturas/`. Pásamela y ajusto la selección a la web real.

## Comprobación automática

```bash
npm run prueba:smoke
```
Ejecuta el flujo completo en modo simulado, con el navegador oculto y un **Telegram falso local**:
- cola, login y la zona preferida agotada, con lo que salta a la siguiente;
- carrito, aviso a Telegram y pulsación de «Sí», que deja el carrito abierto;
- «No» desde el panel, que libera el carrito;
- precio máximo imposible, que pide ayuda humana y, con el navegador oculto, falla con un mensaje claro;
- validación de la URL en modo real.

## Archivos

- `src/bot.ts`: flujo en el navegador (Playwright). Detecta login, verificación, cola y carrito; hace la selección y lee el carrito.
- `src/runner.ts`: orquesta la prueba, los avisos de Telegram y la decisión de comprar o no.
- `src/telegram.ts`: cliente mínimo de la Bot API (mensajes, foto, botones, long-polling).
- `src/mock-site.ts`: réplica local del flujo de venta.
- `src/server.ts`, `src/panel.ts`: servidor local y panel.
