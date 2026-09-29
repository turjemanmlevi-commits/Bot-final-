# Ticket Orchestrator v4 · Sala de control

Orquestador *speed-first* para que un grupo de personas consiga entradas coordinando **hasta 10 cuentas legítimas**: Venue Intelligence en un vault de Obsidian, motor de selección determinista, dashboard en tiempo real, Telegram opcional y *human-in-the-loop*.

> **Alcance automático terminal: carrito asegurado. El pago lo hace siempre una persona.**
> El sistema no paga, no resuelve CAPTCHA/SMS/2FA, no se salta colas, no sobrepasa límites de compra y no suplanta identidades: esas capacidades no existen en el código y los *gates* lo comprueban.

## Empezar en Windows (lo más fácil)

1. Instala **Node.js LTS** desde <https://nodejs.org> (versión 20.19 o superior; con las opciones por defecto).
2. Descarga el proyecto en `C:\Users\Leviç\OneDrive\Desktop\bot final`:
   - con Git (ver «Alternativa: PowerShell» más abajo), o
   - en GitHub: rama `claude/confident-bell-yb79l7` → **Code → Download ZIP**, y extrae el ZIP en esa carpeta.
3. Haz **doble clic en `INICIAR.bat`**. Al terminar se abre <http://localhost:8787> en el navegador.

Qué hace `INICIAR.bat`:

- Comprueba que tienes Node.js 20.19 o superior (si no, abre nodejs.org).
- Crea `.env` a partir de `.env.example` si no existe.
- Ejecuta `npm install` (reintenta una vez; si falla por `EPERM`/`EBUSY`, te aconseja pausar la sincronización de OneDrive) y `npm run build`.
- Arranca el servidor y abre el navegador en el puerto de `.env` (`PORT`, 8787 por defecto).

**Deja abierta la ventana negra** mientras uses el sistema. Para pararlo, ciérrala (o pulsa `Ctrl+C`).

> Si Windows muestra «Windows protegió su PC» al abrirlo, pulsa **Más información → Ejecutar de todas formas** (pasa con los ficheros descargados de internet).

## Alternativa: PowerShell

Requisitos: [Node.js 22 LTS](https://nodejs.org) (≥ 20.19), [Git](https://git-scm.com/download/win) y [Obsidian](https://obsidian.md).

```powershell
cd "C:\Users\Leviç\OneDrive\Desktop"
git clone -b claude/confident-bell-yb79l7 https://github.com/turjemanmlevi-commits/Bot-final-.git "bot final"
cd "bot final"
npm install
npm run build
npm start
```

Abre <http://localhost:8787> y pulsa **Nueva demo**: crea cuentas ficticias y una operación contra el simulador que arranca en 60 segundos.

En Obsidian: **Abrir carpeta como vault** → `bot final\vault`. Empieza por la nota **Inicio**. Con el servidor en marcha, al guardar una nota de recinto o evento el dashboard se actualiza solo.

Para actualizar: `git pull` y vuelve a abrir `INICIAR.bat` (reinstala y recompila). Si descargaste el ZIP, descarga uno nuevo y sustituye los ficheros **conservando la carpeta `data/` y tu `.env`**.

> La carpeta está en el Escritorio sincronizado con OneDrive. Si la instalación va lenta o da `EPERM`, pausa OneDrive mientras se instala (`node_modules` tiene miles de ficheros).

## Comprar entradas reales (Ticketmaster, entradas.com, Real Madrid)

Con estas ticketeras el sistema trabaja en **asistencia manual**: **no entra en sus webs** (no inicia sesión, no lee, no añade al carrito, no paga). Cada persona compra en la **web oficial con su propia cuenta**; el sistema coordina quién va a por qué zona y cuántas, precio máximo, límites por titular, presupuesto, caducidad de carritos, alertas y Telegram.

1. **Cuentas → Nueva cuenta**: una por persona (alias y, si quiere, su chat de Telegram).
2. **Eventos → Nuevo evento**: enlace oficial, fecha del evento, hora de apertura de la venta (T0) y límites de compra verificados en las condiciones oficiales.
3. **Recintos · vault → Nuevo recinto** si el recinto no está (el Estadio Santiago Bernabéu ya viene incluido).
4. **Operaciones → Nueva operación → Crear y validar → Armar**.
5. **El día de la venta**: cada persona abre sesión en la web oficial y pulsa **Sesión lista** antes de T0. A T0 recibe sus tareas con **Abrir la web oficial**; cuando tiene las entradas en el carrito responde **Están en el carrito** (o **No pude** para pasar a la siguiente zona), paga en la web oficial y marca **Ya lo he pagado** en Carritos.

Guía completa en el vault: `00 Guía/Comprar entradas reales (paso a paso).md`.

> La directiva europea Ómnibus prohíbe revender entradas compradas con medios automatizados que eludan los límites o controles del vendedor. Aquí todo lo hace una persona. Cada cuenta debe ser de una persona real que va a asistir; las entradas de socio del Real Madrid son personales e intransferibles.

## Telegram

1. En Telegram, habla con **@BotFather** → `/newbot` → copia el token.
2. Pégalo en `.env` como `TELEGRAM_BOT_TOKEN` y reinicia (cierra la ventana y abre `INICIAR.bat`).
3. Escribe `/start` a tu bot: te responde con el **chat ID** de ese chat (los de grupo empiezan por `-`).
4. Ponlo en `TELEGRAM_CHAT_ID` y reinicia.
5. En **Ajustes · Telegram** pulsa **Enviar mensaje de prueba**. Esa página también lista los chats que han escrito al bot.

Cada cuenta puede tener su propio chat (**Cuentas → editar → Chat de Telegram**): esa persona solo recibe y responde sus tareas. Comandos: `/estado`, `/tareas`, `/id`, `/ayuda`; y en el chat principal `/pausa` y `/parar_todo`.

Guía: `vault/00 Guía/Configurar Telegram.md`.

## Qué hay dentro

| Carpeta | Contenido |
|---|---|
| `vault/` | Vault de Obsidian: **datos** (recintos, zonas, secciones, eventos con límites, proveedores) y **documentación** (guías, runbooks, sistema, decisiones) |
| `shared/` | Contratos de dominio, API/SSE, esquemas de entrada y reglas de la máquina de estados |
| `server/` | Compilador del vault, motor (política, decisión, asignación), simulador, runtime, journal, API + SSE, Telegram, gates, bench, replay, tests |
| `dashboard/` | Sala de control en React (tiempo real) |

## Scripts

| Comando | Qué hace |
|---|---|
| `INICIAR.bat` (Windows) | Instala si hace falta, compila y arranca; abre el navegador |
| `npm start` | Servidor + dashboard compilado en <http://localhost:8787> |
| `npm run dev` | Servidor con recarga al cambiar el código |
| `npm run dev:dashboard` | Dashboard con recarga en <http://localhost:5173> (necesita el servidor) |
| `npm run build` | Compila el dashboard |
| `npm run vault:compile` | Compila el vault a `compiled/` y lista errores y avisos |
| `npm run seed:demo` | Crea la demo en un servidor en marcha |
| `npm test` | Tests (motor, asignación, vault, runtime completo) |
| `npm run gates` | Production gates G0–G6 (`-- --full` para más semillas) |
| `npm run bench` | Latencia del motor y operaciones simuladas |
| `npm run replay -- <id>` | Reproduce las decisiones de una operación desde el journal |
| `npm run typecheck` | Tipos de `shared`, `server` y `dashboard` |
| `npm run verify` | typecheck + tests + gates |

## Configuración

Copia `.env.example` a `.env` si quieres cambiar algo (puerto, zona horaria del vault, Telegram, Postgres, token de operador). Sin `.env` funciona con valores por defecto: journal en PGlite (`data/pglite`), vault en `vault/`, `Europe/Madrid`.

## Modos de proveedor

| Modo | Uso |
|---|---|
| **Simulado** | Proveedor interno realista (colas, retos, latencias, competencia, ambigüedad, rate limits, cambio de esquema). Solo para ensayar y para los gates |
| **Asistencia manual** | Ticketmaster, entradas.com, Real Madrid y cualquier ticketera real: el sistema reparte tareas a las personas del grupo, que compran en la web oficial, y lleva límites, presupuesto y caducidades |
| **API autorizada** | Requiere un acuerdo escrito con el proveedor y un adaptador programado para él. No se incluye ninguno: una nota de proveedor con este modo funciona como asistencia manual |

Documentación completa en el vault: `vault/Inicio.md`.
