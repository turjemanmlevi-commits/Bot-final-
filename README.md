# Ticket Orchestrator v4 · Sala de control

Sala de control para que un grupo de personas consiga entradas coordinando **hasta 10 cuentas legítimas**, una por persona: plano visual de cada recinto, reparto de zonas, límites y presupuesto, dashboard en tiempo real, Telegram opcional y *human-in-the-loop*. Los datos de recintos y eventos viven en un vault de Obsidian.

> [!IMPORTANT]
> **En Ticketmaster, entradas.com y Real Madrid el sistema no compra nada.** No entra en sus webs: no inicia sesión, no mira el inventario, no añade al carrito y no paga. Cada persona compra **en la web oficial, con su propia cuenta**. El sistema decide quién va a por qué zona, cuántas y hasta qué precio, se lo dice a cada una en el segundo exacto y lleva la cuenta de límites, presupuesto y carritos.
>
> Solo contra el **simulador interno** (para ensayar) añade al carrito él solo. Ni siquiera ahí paga: **el pago lo hace siempre una persona**. Tampoco resuelve CAPTCHA/SMS/2FA, ni se salta colas, ni sobrepasa límites de compra, ni suplanta identidades: esas funciones no existen en el código y los *gates* lo comprueban.

## Instalar en Windows: un solo comando (lo más fácil)

1. Abre **PowerShell**: tecla Windows → escribe `PowerShell` → Enter. No hace falta abrirlo como administrador.
2. Copia esta línea, pégala (clic derecho) y pulsa **Enter**:

   ```powershell
   irm https://raw.githubusercontent.com/turjemanmlevi-commits/Bot-final-/claude/confident-bell-yb79l7/instalar.ps1 | iex
   ```

   ¿Sale `"irm" no se reconoce como un comando…`? Estás en **Símbolo del sistema** (cmd), no en PowerShell. Pega esta otra línea, que funciona en los dos:

   ```bat
   powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/turjemanmlevi-commits/Bot-final-/claude/confident-bell-yb79l7/instalar.ps1 | iex"
   ```

3. Si Windows pide permiso para instalar Node.js, pulsa **Sí**. Cuando pregunte `Instalar tambien Obsidian para ver el vault? (s/n)`, escribe `s` y Enter (o `n` si ya lo tienes).
4. Se abre una **ventana negra** (el servidor). La primera vez tarda unos minutos; después se abre solo <http://localhost:8787>. **Deja esa ventana abierta** mientras uses el sistema.

Qué hace el comando (`instalar.ps1`):

| Paso | Qué hace |
|---|---|
| 1. Node.js | Si no lo tienes, instala **Node.js LTS** con `winget` (el instalador de Windows). Si tu Windows no tiene `winget`, abre nodejs.org y se para: instálalo y repite el comando |
| 2. Proyecto | Descarga la rama `claude/confident-bell-yb79l7` y la copia en `Escritorio\bot final` (en este PC: `C:\Users\Leviç\OneDrive\Desktop\bot final`) con `robocopy /XO`. **No borra nada**: nunca toca tu `.env` (configuración de Telegram) ni la carpeta `data` (cuentas, operaciones, carritos); no pisa un archivo si el tuyo es más reciente que el de la descarga (tus notas editadas del vault), y si ya existe `vault\.obsidian` (tu configuración de Obsidian) no la toca |
| 3. Acceso directo | Crea **Sala de control** en el Escritorio (abre `INICIAR.bat`) |
| 4. Obsidian | Opcional: lo instala con `winget` si respondes `s` |
| 5. Arranque | Abre `INICIAR.bat`, que instala dependencias, compila y abre el navegador |

**Las siguientes veces:** doble clic en **Sala de control** del Escritorio (o en `INICIAR.bat` dentro de `bot final`).

**Para actualizar:** cierra la ventana negra y vuelve a pegar el mismo comando. Conserva `.env`, `data` y tu configuración de Obsidian (`vault\.obsidian`), y copia la versión nueva de los ficheros del proyecto. Las notas que tú creaste en el vault se quedan, y una nota que venía con el proyecto y **editaste** también, siempre que tu copia sea más reciente que la de la versión descargada (el instalador no pisa archivos más recientes). Si no estás seguro, cópiala antes.

> Si tu `.env` se creó con una versión anterior, puede tener `MANUAL_TASK_MINUTES=10`. Actualizar no toca el `.env`: ábrelo con el Bloc de notas, pon `MANUAL_TASK_MINUTES=30` (o borra la línea: 30 es el valor por defecto), guarda y reinicia. Ver [Configuración](#configuración).

> Si al final sale «Node.js no aparece todavía», cierra PowerShell, abre otro y vuelve a pegar el comando (pasa cuando Node.js se acaba de instalar).

Qué hace `INICIAR.bat` cada vez que lo abres:

- Si no encuentra Node.js, lo instala con `winget`; si no puede, abre nodejs.org. Exige Node.js 20.19 o superior.
- Crea `.env` a partir de `.env.example` si no existe.
- Ejecuta `npm install` (reintenta una vez; si falla por `EPERM`/`EBUSY`, te aconseja pausar la sincronización de OneDrive) y `npm run build`.
- Desactiva la **«Edición rápida»** de la ventana negra: hacer clic dentro ya no pausa el servidor (antes, un clic la dejaba en modo «Seleccionar» y paraba tareas, T0 y Telegram hasta pulsar una tecla). Si aun así el título de la ventana empieza por «Seleccionar», pulsa `Esc`.
- Arranca el servidor y abre el navegador en el puerto de `.env` (`PORT`, 8787 por defecto). Para pararlo, cierra la ventana negra (o `Ctrl+C`).

Con el servidor en marcha, un error inesperado en segundo plano (en el scheduler o en una promesa sin controlar) se anota en la ventana negra y el servidor sigue funcionando.

> La carpeta está en el Escritorio sincronizado con OneDrive. Si la instalación va lenta o da `EPERM`, pausa OneDrive mientras se instala (`node_modules` tiene miles de ficheros).

### Alternativa: ZIP

1. En GitHub, rama `claude/confident-bell-yb79l7` → **Code → Download ZIP** (enlace directo: <https://github.com/turjemanmlevi-commits/Bot-final-/archive/refs/heads/claude/confident-bell-yb79l7.zip>).
2. Extrae el ZIP y copia **el contenido** de la carpeta de dentro en `C:\Users\Leviç\OneDrive\Desktop\bot final` (que `INICIAR.bat` quede directamente dentro de `bot final`).
3. Doble clic en `INICIAR.bat`. Si Windows muestra «Windows protegió su PC»: **Más información → Ejecutar de todas formas**.

Para actualizar: descarga un ZIP nuevo y copia encima **conservando la carpeta `data` y tu `.env`**.

### Alternativa: Git

Requisitos: [Git](https://git-scm.com/download/win) y [Node.js LTS](https://nodejs.org) (≥ 20.19).

```powershell
cd "C:\Users\Leviç\OneDrive\Desktop"
git clone -b claude/confident-bell-yb79l7 https://github.com/turjemanmlevi-commits/Bot-final-.git "bot final"
cd "bot final"
npm install
npm run build
npm start
```

Para actualizar: `git pull` y vuelve a abrir `INICIAR.bat` (reinstala y recompila).

### Probar y abrir el vault

Pulsa **Nueva demo** en el dashboard: crea cuentas ficticias y una operación contra el simulador que arranca en 60 segundos.

En Obsidian: **Abrir carpeta como vault** → `bot final\vault`. Empieza por la nota **Inicio**. Con el servidor en marcha, al guardar una nota de recinto o evento el dashboard se actualiza solo. Renombrar o mover carpetas del vault con el servidor en marcha ya no lo tumba: si la recompilación falla a mitad, se anota un aviso y se reintenta con el siguiente cambio.

## Comprar entradas reales (Ticketmaster, entradas.com, Real Madrid)

Con estas ticketeras el sistema trabaja en **asistencia manual**. En el dashboard, **Cómo se compra** lo explica en 9 pasos con el plano. En resumen:

1. **Cuentas → Nueva cuenta**: una por persona (alias y, si quiere, su chat de Telegram).
2. **Eventos → Nuevo evento**: eliges **dónde se vende** y, con **Claude** conectado (**Ajustes · Claude (IA)**), Claude busca sus próximos eventos; al elegir uno lee la fecha, la apertura de la venta (T0), **cuántas entradas se pueden comprar por persona** (con la frase de las condiciones oficiales), el recinto y su **plano oficial**. En **5 · Dónde queréis las entradas** tocas hasta 3 sitios del plano (🟢 1ª, 🟠 2ª, 🔵 3ª preferencia). También desde Telegram con **/evento**. Sin Claude: marcador «📥 Enviar a la sala» o la lista oficial de Ticketmaster / partidos.
3. **Recintos · vault**: el Estadio Santiago Bernabéu ya viene incluido, con su plano. Para otro recinto, **Nuevo recinto**.
4. **Operaciones → Nueva operación**: empieza con las zonas elegidas en el evento (se pueden cambiar tocando el plano), cantidad, precio máximo y cuentas → **Crear y validar → Armar**. Cada persona recibe su **plan** (zonas en orden, cuántas, precio máximo).
5. **El día de la venta**: cada persona inicia sesión en la web oficial y pulsa **Sesión lista** antes de T0. Hay que pulsarlo en cada compra: al armar, las cuentas vuelven a *Sin sesión* aunque lo pulsaran en un ensayo. A T0 le llega **«🚦 ¡Abre la venta!»** y su tarea («Añade 2 entradas · Lateral Este · Primer anfiteatro, máx. 120 €») con el plano y su zona resaltada. Compra en la web oficial y responde con las que tenga (**✅ 2 en carrito**, **✅ 1 en carrito**) o **No pude** (le llega al momento la siguiente zona); indica los minutos que le quedan al carrito, **paga en la web oficial** y marca **Ya lo he pagado** (en *Carritos* o en Telegram).
6. **Si se acaba el tiempo del carrito**: los minutos indicados son una estimación, así que el carrito no se da por perdido. Llega la alerta **«…: se acabó el tiempo del carrito, ¿lo has pagado?»**: **Ya lo he pagado** si se pagó, o **Liberar** (en *Carritos*) si se perdió; esas entradas se vuelven a repartir mientras la venta siga abierta.

Guía completa en el vault: `00 Guía/Comprar entradas reales (paso a paso).md`.

> La directiva europea Ómnibus prohíbe revender entradas compradas con medios automatizados que eludan los límites o controles del vendedor. Aquí todo lo hace una persona. Cada cuenta debe ser de una persona real que va a asistir; las entradas de socio del Real Madrid son personales e intransferibles.

## Plano visual de asientos

- **Recintos · vault → (recinto)**: plano generado desde el vault. En un estadio, el campo en el centro, el **norte arriba** y cada grada en su lado (Fondo Norte arriba, Fondo Sur abajo, Lateral Oeste a la izquierda, Lateral Este a la derecha) con sus niveles como **anillos**: del más cercano al campo (dentro) al más alto (fuera). En pabellones y teatros, el **escenario arriba** y las gradas en «U» alrededor de la pista. Toca una zona para ver su nombre y cómo la llama la web.
- **Nueva operación**: tocar una zona del plano la añade como objetivo; el número indica el orden en que se intentará.
- **Operación → «Plan de compra · dónde y en qué orden»**: el plano con los objetivos numerados, la lista en orden y quién está intentando qué ahora mismo.
- **Tareas humanas**: cada tarea de compra muestra el plano con **su zona resaltada** («Tu zona»).

Es orientativo: los sectores exactos están en el plano oficial de cada venta.

## Claude (IA)

**Ajustes · Claude (IA)**: pega tu clave de la API (platform.claude.com → *API keys*, empieza por `sk-ant-`) → **Conectar**. Se comprueba y se guarda solo en este ordenador (`.env`, variable `ANTHROPIC_API_KEY`); usa el Opus más reciente de tu cuenta (o el de `ANTHROPIC_MODEL`). Se paga por consulta a Anthropic; la misma búsqueda en 30 minutos es gratis.

- **Lista de eventos** de la web de venta elegida (búsqueda y lectura web de Claude, en los servidores de Anthropic).
- **Datos del evento**: fecha, fases de venta, límite por persona (queda **verificado solo si Claude cita la web de venta oficial**), precios, recinto (se crea al momento con sus zonas si no está) y la **imagen del plano oficial**, donde Claude sitúa cada zona para tocarla.
- **Telegram `/evento`** (chat principal): lo mismo con botones, y el plano llega como imagen.

Claude solo lee páginas públicas: no entra en ninguna cuenta, no compra y no interviene el día de la venta (el bot avisa al segundo con lo ya preparado).

## Telegram

Todo desde el dashboard, sin tocar archivos ni reiniciar (**Ajustes · Telegram**):

1. En Telegram, habla con **@BotFather** → `/newbot` → copia el token.
2. **Conecta tu bot**: pega el token → **Conectar**. Se comprueba con Telegram, se guarda en `.env` y el bot se conecta al momento; además se configura solo (menú de comandos y descripción).
3. **Abrir @tu_bot** → pulsa **Iniciar**: tu nombre aparece en el dashboard.
4. **Usar como chat principal** junto a tu nombre: te llega la bienvenida con cómo responder rápido.
5. **Enviar mensaje de prueba**.

Cada persona que vaya a comprar pulsa **Iniciar** en el bot y se le asigna su cuenta en esa misma página (**Asignar a una cuenta**): recibe solo sus tareas. El token solo vive en el `.env` de tu PC; el dashboard no lo vuelve a mostrar.

Qué llega: al **armar**, la tarea «Inicia sesión» con el **plan** y los botones **✅ Sesión lista** / **❌ No puedo**; en **T0**, **«🚦 ¡Abre la venta!»** (al chat principal y a los de las cuentas) con el enlace oficial, y cada tarea de compra con **un botón por cantidad**, de la cantidad pedida a 1 (`✅ 2 en carrito`, `✅ 1 en carrito`; en filas de 5, hasta 20), **❌ No pude** y **❓ No sé**. Tras «N en carrito» el bot pregunta **«⏱ ¿Cuántos minutos le quedan al carrito en la web?»** (`5`, `8`, `10`, `15` o `20 min`) junto a **💳 Ya lo he pagado**. Los avisos de carrito a punto de caducar y el de «se acabó el tiempo del carrito, ¿lo has pagado?» llegan con **💳 Ya lo he pagado** y **⏱ Quedan 5 / 10 / 15 min**. Cuando una tarea se responde (en Telegram o en el dashboard), sus botones desaparecen en todos los chats. Desde Telegram las entradas se anotan **al precio máximo**; el precio exacto se indica respondiendo desde el dashboard.

Cada cuenta puede tener su propio chat (**Ajustes · Telegram → Asignar a una cuenta**, o **Cuentas → editar → Chat de Telegram**): esa persona solo recibe y responde sus tareas. Comandos (salen en el menú del bot): `/tareas`, `/estado`, `/ayuda`, `/id`; y solo en el chat principal, `/evento` (crear un evento con Claude), `/pausa` y `/parar_todo`.

Guía: `vault/00 Guía/Configurar Telegram.md`.

## Velocidad medida (ensayo)

| Qué | Tiempo |
|---|---|
| De la hora de apertura (T0) a la tarea en Telegram | 10 ms |
| De T0 a la tarea en el dashboard | 26 ms |
| De T0 a «🚦 ¡Abre la venta!» | 12 ms |
| De «No pude» a la tarea con la siguiente zona | ~50 ms: el reparto reacciona a cada respuesta (y además se revisa cada 250 ms) |
| Simulador sin cola: primera entrada en carrito | 33–62 ms |
| Simulador sin cola: 8 de 8 entradas en carrito | 41–135 ms |
| Decisión del motor | ~0,04 ms |

En Telegram hay que sumar lo que tarde la red de Telegram. Los tiempos del simulador son solo de ensayo: con una cola virtual simulada, lo que manda es la cola (1–2 s). En una venta real lo que cuenta son **segundos humanos**: la cola virtual de la web oficial, elegir asientos y pulsar. Por eso el plan llega al armar y la tarea en el milisegundo de T0.

## Qué hay dentro

| Carpeta | Contenido |
|---|---|
| `vault/` | Vault de Obsidian: **datos** (recintos, zonas, secciones, eventos con límites, proveedores) y **documentación** (guías, runbooks, sistema, decisiones) |
| `shared/` | Contratos de dominio, API/SSE, esquemas de entrada y reglas de la máquina de estados |
| `server/` | Compilador del vault, motor (política, decisión, asignación), simulador, runtime, journal, API + SSE, Telegram, gates, bench, replay, tests |
| `dashboard/` | Sala de control en React (tiempo real), con el plano de recintos y la página **Cómo se compra** |

## Scripts

| Comando | Qué hace |
|---|---|
| `instalar.ps1` (Windows) | Instalación en un comando: Node.js, proyecto, acceso directo, Obsidian opcional y arranque |
| `INICIAR.bat` (Windows) | Instala si hace falta (incluido Node.js), compila y arranca; abre el navegador |
| `npm start` | Servidor + dashboard compilado en <http://localhost:8787> |
| `npm run dev` | Servidor con recarga al cambiar el código |
| `npm run dev:dashboard` | Dashboard con recarga en <http://localhost:5173> (necesita el servidor) |
| `npm run build` | Compila el dashboard |
| `npm run vault:compile` | Compila el vault a `compiled/` y lista errores y avisos |
| `npm run seed:demo` | Crea la demo en un servidor en marcha |
| `npm test` | Tests (motor, asignación, vault, runtime completo, Telegram) |
| `npm run gates` | Production gates G0–G6 (`-- --full` para más semillas) |
| `npm run bench` | Latencia del motor y operaciones simuladas |
| `npm run replay -- <id>` | Reproduce las decisiones de una operación desde el journal |
| `npm run typecheck` | Tipos de `shared`, `server` y `dashboard` |
| `npm run verify` | typecheck + tests + gates |

## Configuración

`INICIAR.bat` crea `.env` a partir de `.env.example`. Ahí se cambian el puerto, la zona horaria del vault, Telegram (mejor desde **Ajustes · Telegram**, que lo guarda ahí sin reiniciar), los minutos para responder una tarea de compra antes de que el sistema pida verificarla (`MANUAL_TASK_MINUTES`, **30** por defecto), Postgres o el token de operador. El `.env` solo se lee al arrancar. Sin `.env` funciona con valores por defecto: journal en PGlite (`data/pglite`), vault en `vault/`, `Europe/Madrid`.

Un `.env` creado con una versión anterior puede tener `MANUAL_TASK_MINUTES=10`, y ese valor manda sobre el nuevo defecto: cámbialo a `30` (o borra la línea) y reinicia.

## Modos de proveedor

| Modo | Uso |
|---|---|
| **Simulado** | Proveedor interno realista (colas, retos, latencias, competencia, ambigüedad, rate limits, cambio de esquema). Solo para ensayar y para los gates. Es el único modo en el que se añade al carrito automáticamente |
| **Asistencia manual** | Ticketmaster, entradas.com, Real Madrid y cualquier ticketera real: el sistema reparte tareas a las personas del grupo, que compran en la web oficial, y lleva límites, presupuesto y caducidades |
| **API autorizada** | Requiere un acuerdo escrito con el proveedor y un adaptador programado para él. No se incluye ninguno: una nota de proveedor con este modo funciona como asistencia manual |

Documentación completa en el vault: `vault/Inicio.md`.
