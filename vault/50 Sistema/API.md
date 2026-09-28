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

Los tipos de todas las respuestas están en `shared/src/api.ts`.
