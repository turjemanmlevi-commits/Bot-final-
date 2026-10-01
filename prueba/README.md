# Prueba: Real Madrid Femenino → asientos → carrito → Telegram

Pulsas **▶ Hacer prueba** en `http://127.0.0.1:3000` y el bot hace esto, solo:

1. Abre un Chrome con **su propio perfil guardado** (ahí queda tu sesión del Real Madrid).
2. Entra en `tickets.realmadrid.com/realmadrid_femenino` (la web de entradas del femenino, plataforma Onebox), o en la URL del partido si la pones.
3. Si no has puesto partido, recorre el catálogo y entra en el **primer partido a la venta**.
4. Pasa la cola si la hay **esperando su turno**. Si la web pide login o una verificación, te avisa y espera a que lo hagas tú en su ventana (la sesión se queda guardada).
5. Lee las zonas del plano y elige según tus **requisitos**: cantidad, zonas preferidas, asientos **seguidos en la misma fila** y precio máximo.
   - Si la zona tiene **«Buscar asientos»**, usa la selección automática de la web.
   - Si no, abre el plano de la zona, elige un bloque de asientos seguidos (evitando dejar uno suelto) y los pulsa uno a uno, eligiendo la tarifa general.
   - Si la web muestra una lista de zonas sin plano, usa sus contadores.
6. Comprueba el **carrito real** de la web (líneas, total y cuenta atrás), pulsa **«Comprar entradas»** (que en esta web abre la pantalla de datos y pago, sin pagar) y, con esa pantalla abierta, hace la captura.
7. Te manda por **Telegram** *«¿Quieres comprar las entradas?»* con la captura de la pantalla de pago, el enlace y los botones:
   - **✅ Sí, voy a pagar**: trae al frente la ventana del bot, donde solo queda rellenar los datos y pagar. **El pago lo haces tú.**
   - **❌ No, liberar**: vacía el carrito y cierra el navegador del bot.

Lo que el bot **no hace nunca**: pagar (el botón «Pagar» del checkout está prohibido en el código), aceptar condiciones por ti, reservar, resolver CAPTCHAs, saltarse colas o superar el límite de entradas de la web.

## Puesta en marcha (en tu PC)

**Con un solo comando** (descarga, instala y arranca; para actualizar, pega el mismo comando otra vez):

- **Windows**: abre *PowerShell* (tecla Windows, escribe `powershell`, Enter) y pega:
  ```powershell
  irm https://raw.githubusercontent.com/turjemanmlevi-commits/Bot-final-/claude/confident-planck-41m20b/instalar.ps1 | iex
  ```
- **Mac**: abre *Terminal* y pega:
  ```bash
  curl -fsSL https://raw.githubusercontent.com/turjemanmlevi-commits/Bot-final-/claude/confident-planck-41m20b/instalar.sh | bash
  ```

Se instala en la carpeta `bot-entradas` de tu usuario y abre el panel. Las siguientes veces: doble clic en `iniciar.bat` (Windows) o `./iniciar.sh` (Mac/Linux) dentro de esa carpeta. Si el puerto 3000 está ocupado usa el 3001, 3002…: mira la URL que sale en la ventana negra.

A mano:

```bash
npm install
npx playwright install chromium          # solo la primera vez
cp prueba/.env.example prueba/.env       # opcional
npm run prueba                           # → abre http://127.0.0.1:3000
```

### Telegram
En el panel, **Conectar Telegram**: pega el token de tu bot (de @BotFather), escribe «hola» a tu bot en Telegram y pulsa «Guardar y probar». Te llega un mensaje de prueba y queda guardado en `prueba/.env`.

> Si el mismo bot lo usa también la sala de control (dashboard), **cierra la sala** mientras hagas esta prueba: Telegram solo deja a un programa recibir los botones de un bot a la vez («conflict»).

## La prueba real, paso a paso

1. Pulsa **⚡ Prueba rápida** en el panel. Los requisitos ya van puestos: el próximo partido del femenino a la venta, **3 entradas seguidas**, cualquier zona (la más barata con sitio), sin tope de precio, y si no hay 3 seguidas coge las que haya. Si prefieres otros requisitos, despliega «Prueba con mis propios requisitos».
2. Se abre la ventana de Chrome del bot y en el panel ves cada paso.
3. **La primera vez** la web pedirá iniciar sesión: hazlo tú en esa ventana (el bot avisa por Telegram y espera). Queda guardado en `data/prueba/perfil-navegador/` para las siguientes.
4. Cuando las entradas estén en el carrito y la pantalla de pago abierta te llega el Telegram con la captura. **Sí** → la ventana del bot queda al frente para que pagues tú. **No** → libera las entradas.

Si algo no cuadra con la web real (cambian un botón, aparece un diálogo que el bot no conoce…), el bot **no se inventa nada**: pasa a modo asistido («elige tú los asientos; yo detecto el carrito y te aviso») y guarda en `data/prueba/capturas/` una captura, el HTML y un JSON de diagnóstico. Pásamelos y lo ajusto en minutos.

## Modos

| Modo | Qué abre | Para qué |
|---|---|---|
| **Web real** | tickets.realmadrid.com, ventana **siempre visible** | La prueba de verdad con tu cuenta |
| **Simulado** | Réplica local del front de Onebox en `/mock/realmadrid_femenino/…` (catálogo, cola, login, plano SVG con asientos, «Buscar asientos», lista de zonas, carrito con cuenta atrás, checkout) | Probar el bot y Telegram de principio a fin sin tocar la web real |

## Comprobación automática

```bash
npm run prueba:smoke
```
Ejecuta el flujo completo en modo simulado, con el navegador oculto y un **Telegram falso local**:
- catálogo → partido → cola → login con credenciales → 3 asientos seguidos de la fila 2 de «Lateral Oeste» (pedido como «Grada Oeste») → «Comprar entradas» → diálogo de venta cruzada → pantalla de pago → Telegram con la captura de esa pantalla → «Sí» la deja abierta;
- zona con «Buscar asientos» (diálogo de selección automática de la web);
- zona sin numerar (contador);
- lista de zonas sin plano, con la preferida agotada → siguiente; «No» vacía el carrito;
- precio máximo imposible → pide ayuda humana y, oculto, falla con un mensaje claro;
- «No» desde la pantalla de pago vacía el carrito;
- comprueba que **nunca** se pulsa pagar ni reservar.

## De dónde salen los selectores de la web real

El front de Onebox (`client-dists.oneboxtds.com/channels-client`, v0.2467) es una app Angular con componentes `ob-*` y atributos `data-testid`. De su código salen los selectores de `src/onebox.ts`: la página `ob-page-select-locations`, la lista de zonas `ob-view-list .view-item`, el visor SVG con asientos `circle.interactive.seat.available` (con `aria-label` «Fila X Asiento Y»), el diálogo de tarifa (`select-rate-dialog-confirm`), el diálogo «Buscar asientos» (`ob-select-automatic-seat-dialog`), los contadores (`counter-add` / `counter-quantity`), el resumen del carrito (`cart-summary-total`, `ob-cart-summary-card-item`, `ob-flat-countdown`) y los botones de pago, que están en una lista negra.

## Archivos

- `src/onebox.ts`: receta de Onebox (selectores, clasificación de página, catálogo, asientos seguidos, diálogos, carrito, diagnóstico).
- `src/bot.ts`: flujo en el navegador (Playwright): puertas (login/cola/verificación), partido, estrategias de selección, carrito.
- `src/runner.ts`: orquesta la prueba, los avisos de Telegram y la decisión de comprar o no.
- `src/telegram.ts`: cliente mínimo de la Bot API (mensajes, foto, botones, long-polling).
- `src/mock-site.ts`: réplica local del front de Onebox.
- `src/server.ts`, `src/panel.ts`: servidor local y panel.
