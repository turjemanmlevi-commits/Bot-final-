---
tags:
  - sistema
---

# API

Servidor en `http://localhost:8787`. Si `OPERATOR_TOKEN` está definido, hay que enviar `Authorization: Bearer <token>`. La cabecera `x-actor` (codificada con `encodeURIComponent`) dice quién hace cada acción.

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/state` | Estado completo inicial |
| GET | `/api/stream` | Stream SSE: `hello` y lotes `batch` de cambios |
| GET | `/api/system` | Proveedores, kill switches, circuitos, journal, Telegram |
| GET/POST | `/api/vault`, `/api/vault/compile` | Último informe / recompilar |
| GET | `/api/venues`, `/api/venues/:hash`, `/api/venues/:hash/resolve?label=` | Recintos y probador de etiquetas |
| GET | `/api/events` | Catálogo |
| POST | `/api/vault/events` | Crea la nota `20 Eventos/<nombre>.md` (409 si ya existe) |
| PUT | `/api/vault/events/:id` | Actualiza las propiedades de la nota y conserva el resto (el id no cambia) |
| POST | `/api/vault/venues` | Crea `10 Recintos/<nombre>/` con la nota, `Zonas/` y `Secciones/` (409 si existe; 400 `BAD_LAYOUT`) |
| POST | `/api/telegram/test` | Envía un mensaje de prueba |
| GET/POST/PATCH | `/api/accounts[/:id]` | Cuentas |
| POST | `/api/accounts/:id/session/open`, `/session/ready` | Abrir sesión / una persona confirma que está lista |
| GET/POST | `/api/operations` | Listar / crear |
| GET | `/api/operations/:id` | Detalle |
| PUT | `/api/operations/:id/config` | Nueva versión de la configuración (solo borrador/validada) |
| POST | `/api/operations/:id/commands` | `validate`, `arm`, `disarm`, `readiness`, `start-now`, `pause`, `resume`, `stop`, `cancel`, `reduce-qty`, `lower-max-price`, `close` |
| POST | `/api/operations/:id/replay` | Replay |
| GET | `/api/alerts` · POST `/api/alerts/:id/ack`, `/resolve` | Alertas |
| GET | `/api/human-tasks` · POST `/api/human-tasks/:id/respond` | Tareas humanas |
| GET | `/api/carts` · POST `/api/carts/:id/mark` | Carritos (`PAID` / `RELEASED`) |
| POST | `/api/kill-switches`, `/api/circuits/:key/reset` | Seguridad |
| GET | `/api/audit?operationId&type&limit&before` | Journal |
| GET/POST | `/api/gates`, `/api/gates/run` | Gates |
| POST | `/api/demo/seed` | Crear la demo |

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

## SSE

Además de `hello`, `upsert`, `remove`, `system`, `audit` y `vault`, el stream envía `{ type: 'providers', data: ProviderAuthorization[] }` cuando cambian las notas de proveedores.

Los tipos de todas las respuestas están en `shared/src/api.ts`.
