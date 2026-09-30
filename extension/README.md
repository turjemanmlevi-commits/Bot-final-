# Conectar tu pestaña al panel local

Esta extensión utiliza la pestaña que ya tienes abierta y su sesión de compra. No lee ni copia cookies, contraseñas ni los datos de pago. El servidor local debe estar en `http://127.0.0.1:8787`.

1. Abre `chrome://extensions` y activa **Modo de desarrollador**.
2. Pulsa **Cargar descomprimida** y elige esta carpeta `extension` de la versión actual del proyecto.
3. En la sala del panel local, prepara la conexión de la cuenta y evento correctos y copia el código temporal.
4. En el perfil de Chrome de esa cuenta, abre la página del evento. Abre el icono de la extensión y pega el código. Acepta el permiso de esa web.
5. Deja abierta esa pestaña. La sala recibe lo que la extensión puede comprobar y muestra si el selector y el carrito son compatibles.

El código une **una cuenta, un evento y una pestaña**. El estado de conexión se guarda solo en la sesión de Chrome. Tras cerrar/reiniciar Chrome o recargar la extensión, vuelve a conectar. Si el intento anterior quedó incierto, comprueba su carrito antes de preparar otro.

## Qué puede hacer

- Recibir órdenes del servidor local y actuar en la pestaña asociada.
- Detectar un reto humano y esperar a que lo resuelvas. Nunca lo resuelve ni lo esquiva. Reanuda al observar la página habilitada.
- Registrar el intento antes de pulsar el botón. Una recarga, una navegación o una pérdida de conexión no repite el clic a ciegas.
- Afirmar que se añadieron entradas solamente después de leer el carrito real, con evento, oferta, cantidad y precio coincidentes. Un clic o cambio de URL nunca confirma una reserva.
- Al abrir un carrito conectado desde la sala, enfocar la misma pestaña y perfil, conservando su sesión. No paga.

## Compatibilidad actual

**Real Madrid (`observe-only-v1`):** conexión y apertura de la misma pestaña. El selector observado usa un mapa Canvas/WebGL; todavía no hay selección automática verificada. La extensión lo declara incompatible con añadir automáticamente. Conectarlo no convierte el mapa en un selector compatible ni crea un carrito.

**Entradas.com (`entradas-fastbooking-v1`):** lectura de su lista fastbooking y selección con controles de la página. La escritura queda bloqueada si no existe una receta de lectura de carrito comprobada para ese evento. No se incluyen selectores de checkout adivinados. La versión inicial exige poder leer un carrito vacío antes de añadir y leer las filas confirmadas después. Un carrito previo con entradas queda para revisión humana.

**Tienda local (`fixture-v1`):** receta de integración para pruebas controladas. Sus resultados son simulados; no reservan entradas en una tienda real. Usa marcadores explícitos de evento, oferta, cantidad, precio y carrito listo.

Un reto que permanece visible después de resolverlo, una cola, una página de acceso, un carrito sin evidencia, otra divisa o un cambio de estructura detienen el intento de forma conservadora. Si la web cambia de dominio durante la compra, habrá que conceder acceso y revisar su receta; no se solicita acceso silenciosamente a todos los sitios.

## Telegram y sesiones

El enlace oficial del evento no es una prueba de carrito. La sala debe utilizar la evidencia y el acceso a la pestaña conectada. Un enlace a `localhost` desde Telegram en el móvil no abre el PC; usa el panel y Telegram en el mismo ordenador para el acceso local. Esta extensión no publica tu sesión ni añade acceso remoto.

## Comprobar los verificadores sin tocar una tienda

Desde la raíz del proyecto: `npx tsx --test server/src/test/extension-cart.test.ts`.

Las pruebas cubren el rechazo de evento/cuenta/cantidad/precio incorrectos, carritos previos y navegación sin evidencia. La prueba de integración de navegador debe hacerse aparte con una página de prueba; no equivale a una reserva real.

Para abrir la página controlada, ejecuta `node extension/fixture-server.mjs` y abre `http://127.0.0.1:8879/fixture?eventRef=fixture-event`. El código de emparejamiento del panel debe corresponder a un evento de prueba con ese `eventRef`, receta `fixture-v1` y origen permitido `http://127.0.0.1:8879`. No reutilices una operación de compra real para la simulación.

La página permite seleccionar cuatro resultados: carrito correcto, botón sin efecto, cantidad incorrecta y reto humano simulado. En el primer caso debe haber exactamente un clic y una confirmación; en los otros fallos no debe aparecer un aviso de éxito. El reto se termina manualmente y el carrito se comprueba sin un segundo clic.
