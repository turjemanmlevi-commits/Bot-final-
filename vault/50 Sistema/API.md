---
tags:
  - sistema
---

# API

Servidor en `http://localhost:8787`. Si `OPERATOR_TOKEN` está definido, hay que enviar `Authorization: Bearer <token>` (o `?token=<token>` en la URL, útil para el stream SSE). La cabecera `x-actor` (codificada con `encodeURIComponent`) dice quién hace cada acción. Importes siempre en **céntimos** (`12000` = 120,00 €).

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/health` | `{ ok, version, journal }`: el servidor responde (lo usa `INICIAR.bat` para abrir el navegador) |
| GET | `/api/state` | Estado completo inicial |
| GET | `/api/stream` | Stream SSE: `hello` al conectar, lotes `batch` de cambios y `ping` cada 15 s sin cambios |
| GET | `/api/system` | Proveedores, kill switches, circuitos, journal, Telegram |
| GET/POST | `/api/vault`, `/api/vault/compile` | Último informe / recompilar |
| GET | `/api/venues`, `/api/venues/:hash`, `/api/venues/:hash/resolve?label=` | Recintos y probador de etiquetas |
| GET | `/api/events` | Catálogo |
| POST | `/api/vault/events` | Crea la nota `20 Eventos/<nombre>.md` (409 si ya existe) |
| PUT | `/api/vault/events/:id` | Actualiza las propiedades de la nota y conserva el resto (el id no cambia) |
| POST | `/api/vault/venues` | Crea `10 Recintos/<nombre>/` con la nota, `Zonas/` y `Secciones/` (409 si existe; 400 `BAD_LAYOUT`) |
| POST | `/api/telegram/test` | Envía un mensaje de prueba |
| GET/POST/PATCH | `/api/accounts[/:id]` | Cuentas |
| POST | `/api/accounts/:id/session/open`, `/session/ready` | Abrir sesión / una persona confirma que está lista (`{ note? }`) |
| GET/POST | `/api/operations` | Listar / crear |
| GET | `/api/operations/:id` | Detalle |
| PUT | `/api/operations/:id/config` | Nueva versión de la configuración (solo borrador/validada) |
| POST | `/api/operations/:id/commands` | `validate`, `arm`, `disarm`, `readiness`, `start-now`, `pause`, `resume`, `stop`, `cancel`, `reduce-qty`, `lower-max-price`, `close` |
| GET | `/api/operations/:id/decisions?limit=` | Últimas decisiones del motor (máx. 500) |
| POST | `/api/operations/:id/replay` | Replay |
| GET | `/api/alerts` · POST `/api/alerts/:id/ack`, `/resolve` | Alertas |
| GET | `/api/human-tasks` · POST `/api/human-tasks/:id/respond` | Tareas humanas (cuerpo abajo) |
| GET | `/api/carts` | Carritos |
| POST | `/api/carts/:id/mark` | `{ state: 'PAID' \| 'RELEASED', note? }`: una persona dice que pagó o que lo quitó del carrito. El sistema nunca paga |
| POST | `/api/carts/:id/expiry` | `{ minutes }` (1–60): minutos que le quedan al carrito en la web; fija `expiresAt` = ahora + minutos y reinicia los avisos de caducidad. Es lo que hacen los botones de minutos de Telegram. 409 si el carrito ya está cerrado |
| POST | `/api/kill-switches`, `/api/circuits/:key/reset` | Seguridad |
| GET | `/api/audit?operationId&type&limit&before` | Journal |
| GET/POST | `/api/gates`, `/api/gates/run` | Gates |
| POST | `/api/demo/seed` | Crear la demo: `{ startInSeconds? (20–3600, por defecto 90), scenarioId?, seed? }` |
| GET | `/sim/cart/:eventRef/:accountId` | Página de carrito del **simulador** (solo ensayo) |

## Alta desde el dashboard

`POST /api/vault/events` y `PUT /api/vault/events/:id` reciben `EventNoteInput`:

```ts
{ name, venueId, providerId, url?: string | null, providerEventRef?,
  startsAt: 'AAAA-MM-DDTHH:mm',          // hora local de Madrid (VAULT_TZ)
  onSaleAt?: 'AAAA-MM-DDTHH:mm' | null,  // T0
  currency: 'EUR', limitPerAccount, limitPerGroup, limitPerOperation,
  limitSemantics, limitsVerified, limitsSource, limitsNotes?, notes? }
```

Responden `EventNoteResult { file, created, event | null, issues, report }`; en `event`, `startsAt`/`onSaleAt` vuelven en ISO UTC. Los errores de validación dan 400 con el mensaje `campo: mensaje; ...`.

`POST /api/vault/venues` recibe `VenueQuickInput { name, city?, source, layout }` (formato de `layout` en [[Dashboard]]) y responde `VenueQuickResult { folder, files, venueId | null, issues, report }`.

`POST /api/telegram/test` recibe `{ chatId? }` (sin él, el chat principal) y responde `{ ok, message }`; nunca falla por errores de Telegram: devuelve `ok: false` con la explicación.

## Tareas humanas

`POST /api/human-tasks/:id/respond` recibe `HumanTaskResponseInput`:

```ts
{ result: 'READY' | 'IN_CART' | 'FAILED' | 'UNKNOWN',
  qty?: number,          // obligatorio con IN_CART
  unitPrice?: number,    // céntimos por entrada con gastos; obligatorio con IN_CART
  seats?: string[], expiresAt?: string /* ISO */, note?: string }
```

| Tarea | Respuestas válidas |
|---|---|
| «Inicia sesión» (`OPEN_SESSION`) | `READY`, `FAILED` |
| «Añade N entradas · <zona>» (`ADD_TO_CART`) | `IN_CART`, `FAILED` (siguiente zona), `UNKNOWN` (pasa a verificación) |
| «¿Están las N entradas…?» (`VERIFY_CART`) | `IN_CART`, `FAILED`, `UNKNOWN` |

Una tarea cerrada (hecha, fallida, caducada o cancelada) da 409 (`NOT_OPEN`); una respondida con `UNKNOWN` aún admite respuesta. Desde Telegram, «✅ N en carrito» envía `IN_CART` con `qty: N` y `unitPrice` = precio máximo.

## SSE

Cada evento `batch` lleva un array de mensajes `StreamMessage`: `upsert` y `remove` (entidades), `system`, `audit` y `vault`; si la cola se desborda, un `hello` con el estado completo. Además, el stream envía `{ type: 'providers', data: ProviderAuthorization[] }` cuando cambian las notas de proveedores.

Los tipos de todas las respuestas están en `shared/src/api.ts`.
