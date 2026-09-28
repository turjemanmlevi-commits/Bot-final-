# Ticket Orchestrator v4 · Sala de control

Orquestador *speed-first* para que un grupo de personas consiga entradas coordinando **hasta 10 cuentas legítimas**: Venue Intelligence en un vault de Obsidian, motor de selección determinista, dashboard en tiempo real, Telegram opcional y *human-in-the-loop*.

> **Alcance automático terminal: carrito asegurado. El pago lo hace siempre una persona.**
> El sistema no paga, no resuelve CAPTCHA/SMS/2FA, no se salta colas, no sobrepasa límites de compra y no suplanta identidades: esas capacidades no existen en el código y los *gates* lo comprueban.

## Poner en marcha (Windows, PowerShell)

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

Para actualizar: `git pull`, `npm install`, `npm run build`.

> La carpeta está en el Escritorio sincronizado con OneDrive. Si la instalación va lenta o da `EPERM`, pausa OneDrive mientras se instala (`node_modules` tiene miles de ficheros).

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
| **Simulado** | Proveedor interno realista (colas, retos, latencias, competencia, ambigüedad, rate limits, cambio de esquema). Para ensayar y para los gates |
| **Asistencia manual** | Cualquier ticketera real sin API autorizada: el sistema reparte tareas a las personas del grupo y lleva límites, presupuesto y caducidades |
| **API autorizada** | Solo con permiso escrito del proveedor, capability a capability, anotado en su nota de `vault/30 Proveedores` |

Documentación completa en el vault: `vault/Inicio.md`.
