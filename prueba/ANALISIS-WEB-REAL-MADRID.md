# Analizar la web de entradas del Real Madrid (para Claude con la extensión de Chrome)

Esta guía es para una sesión de Claude **en el PC de la persona**, con **Claude in Chrome** conectado
a su Chrome normal (donde la verificación de Cloudflare pasa porque es una persona). El objetivo es
conocer de verdad cómo se compran las entradas en `tickets.realmadrid.com` y dejar la receta del bot
(`prueba/src/onebox.ts`) y la réplica de pruebas (`prueba/src/mock-site.ts`) iguales que la web real.

## Reglas (no se negocian)

- **La verificación de Cloudflare, la cola y el login los hace la persona.** No intentes resolverlos,
  saltarlos ni ocultar que hay un navegador controlado.
- **Nunca pagues.** No pulses «Pagar», ni `[data-testid="checkout-payment-button"]`, ni aceptes
  condiciones de compra, ni rellenes datos de pago.
- Como mucho **1 a 3 entradas** en el carrito, solo para ver cómo se comporta, y **vacíalo al acabar**.
- Ve despacio: una acción, esperar a que cargue, leer. Nada de recargar en bucle.

## Partidos para analizar (a 1-oct-2026)

Salen de `https://www.realmadrid.com/es-ES/futbol/primer-equipo-femenino/inicio` (bloque `ng-state`,
campo `ticketsLink`). Cada competición tiene su propio canal en la web de entradas:

| Partido | Enlace |
|---|---|
| Real Madrid vs Paris FC (10-nov) | https://tickets.realmadrid.com/realmadridfemenino_champions/select/3003555?hl=es-ES |
| Real Madrid vs Inter (18-nov) | https://tickets.realmadrid.com/realmadridfemenino_champions/select/3003557?hl=es-ES |
| Catálogo Champions | https://tickets.realmadrid.com/realmadridfemenino_champions/?hl=es-ES |
| Catálogo Liga F | https://tickets.realmadrid.com/realmadrid_femenino/?hl=es-ES |

## Qué hay que averiguar

En cada página, ejecuta en la pestaña el script de «Resumen de la página» (abajo) y guarda su
resultado en `prueba/recetas/realmadrid/<paso>.json`. Haz además una captura.

1. **Catálogos** (los dos): cómo son las tarjetas de partido, su botón de compra, cómo se marca
   «agotado» o «próximamente». ¿Tarda en cargar la lista?
2. **Entrada a la selección**: ¿pide login antes de ver el plano? ¿Hay cola (Queue-it)? ¿Hay una
   página intermedia (ficha del evento)?
3. **Página de selección** (Paris FC):
   - ¿El plano es **SVG** (`circle.interactive.seat…`) o **canvas/WebGL**? ¿Cuántos asientos hay en el DOM?
   - Lista de zonas (`ob-view-list .view-item`): nombres, precios, «agotado».
   - ¿Hay **selección automática** («Buscar asientos», `.ob-automatic-selection-btn`)? Ábrela y anota
     cada paso del diálogo (cantidad, zona de precio, tarifa, botón final).
   - Al pulsar un asiento: diálogo de **tarifa** (`select-rate-dialog-confirm`), avisos de asientos
     sueltos o no seguidos, **límite de entradas por compra**.
4. **Carrito**: componente del resumen (`ob-select-graphic-cart-summary`, `ob-cart-summary`…), líneas
   (zona, fila, asiento, precio), total, **cuenta atrás** (cuánto tiempo da), botón de borrar línea.
5. **«Comprar entradas»**: su `data-testid`, qué diálogo sale (venta cruzada…), y la **pantalla de
   checkout**: componentes, resumen, botón de vaciar el carrito y el botón de pago (solo anotarlo).
6. **Vaciar el carrito** y comprobar que queda a 0.
7. Para el siguiente paso del proyecto (botón «🤖 Bot entradas» en la barra de marcadores):
   - La cabecera **Content-Security-Policy** de la página de selección:
     `fetch(location.href).then(r => r.headers.get('content-security-policy'))`.
   - Si un marcador `javascript:void(document.title += ' ✓')` funciona en esa página.

## Resumen de la página (pégalo en la herramienta de JavaScript de la pestaña)

```js
(() => {
  const tags = {};
  for (const el of document.querySelectorAll('*')) {
    const t = el.tagName.toLowerCase();
    if (t.startsWith('ob-') || t.startsWith('mat-') || t.startsWith('app-')) tags[t] = (tags[t] || 0) + 1;
  }
  const testids = {};
  for (const el of document.querySelectorAll('[data-testid]')) {
    const k = el.getAttribute('data-testid');
    testids[k] = (testids[k] || 0) + 1;
  }
  const seat = document.querySelector('.seat, [class*="seat"]');
  const pick = (sel, n = 5) => [...document.querySelectorAll(sel)].slice(0, n).map((e) => ({
    tag: e.tagName.toLowerCase(), cls: String(e.className?.baseVal ?? e.className).slice(0, 120),
    id: e.id || null, aria: e.getAttribute('aria-label'), text: (e.innerText || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 140),
  }));
  return JSON.stringify({
    url: location.href, title: document.title,
    tags, testids,
    canvases: [...document.querySelectorAll('canvas')].map((c) => ({ w: c.width, h: c.height, cls: c.className })),
    svgSeats: document.querySelectorAll('circle.seat, .interactive.seat').length,
    seatExample: seat ? seat.outerHTML.slice(0, 400) : null,
    viewItems: pick('ob-view-list .view-item, .view-list .view-item', 12),
    buttons: pick('ob-button, button', 40),
    dialogs: pick('mat-dialog-container, .cdk-dialog-container', 3),
    cart: pick('ob-select-graphic-cart-summary, ob-select-cart-summary, ob-cart-summary, ob-sidebar-cart, ob-checkout-summary', 3),
    countdown: pick('.ob-flat-countdown, ob-order-countdown, .ob-countdown-value', 2),
  }, null, 2);
})()
```

## Después del análisis

1. Compara lo encontrado con el objeto `OB` y `classifyOnebox` de `prueba/src/onebox.ts`, y con los
   pasos de `prueba/src/bot.ts` (`selectAutomatic`, `selectInView`, `selectSeatsOnMap`, `goToCheckout`).
   Corrige lo que no coincida.
2. Ajusta `prueba/src/mock-site.ts` para que la réplica se parezca a la web real.
3. Comprueba: `npm run typecheck`, `npm run prueba:smoke` y `npm test -w @to/server`.
4. Escribe en `prueba/recetas/realmadrid/RESUMEN.md` lo aprendido (con fecha) y sube los cambios a la
   rama `claude/confident-planck-41m20b`. Si la carpeta no es un repositorio git (instalada con el ZIP),
   clona primero: `git clone -b claude/confident-planck-41m20b https://github.com/turjemanmlevi-commits/Bot-final-.git`.
