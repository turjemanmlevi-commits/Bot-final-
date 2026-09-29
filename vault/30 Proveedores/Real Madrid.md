---
type: provider
id: real-madrid
name: Real Madrid
mode: MANUAL_ASSIST
authorizedCapabilities: []
url: https://www.realmadrid.com/es-ES/entradas
source: "Venta oficial de entradas del Real Madrid C. F. (realmadrid.com/es-ES/entradas). No hay API de compra autorizada: asistencia manual."
verifiedAt: 2026-09-28
tags:
  - proveedor
  - real
---

# Real Madrid

Venta oficial de entradas del Real Madrid (fútbol en el [[Estadio Santiago Bernabéu]] y baloncesto) en `realmadrid.com/es-ES/entradas`. Cada partido tiene su página, por ejemplo `https://www.realmadrid.com/es-ES/futbol/partidos/entradas/real-madrid-...`.

> [!important] Asistencia manual
> El sistema **no se conecta** a realmadrid.com. Cada persona compra con **su propia cuenta** (socio, Madridista o público general) en la web oficial; el sistema coordina al grupo.

## Qué hace y qué no hace el sistema con este proveedor

| El sistema **sí** | El sistema **no** (nunca) |
|---|---|
| Reparte quién compra qué zona, cuántas entradas y a qué precio máximo | Entrar en la web, iniciar sesión o leer el inventario |
| Envía cada tarea al dashboard y a Telegram con el enlace oficial | Añadir al carrito, pagar o rellenar formularios |
| Lleva la cuenta de límites, presupuesto y caducidad de cada carrito | Resolver CAPTCHA, SMS o verificaciones |
| Te avisa si un carrito está a punto de caducar | Saltarse colas o límites de compra |

Todas las acciones en la web las hace **una persona, con su propia cuenta**. `authorizedCapabilities: []` significa exactamente eso: nada automatizado. Ver [[Uso legítimo y guardarraíles]].

## Particularidades de la venta del club

- La venta va **por fases y por colectivos** (socios abonados, socios no abonados, Madridistas, público general), cada una con su fecha y su límite. Crea el evento con la hora de apertura de **tu** fase y los límites de esa fase.
- Según las condiciones publicadas por el club, las entradas compradas como socio son **personales e intransferibles**: cada cuenta debe ser de la persona que va a ir al partido.
- Los límites suelen ser **por socio o usuario** → semántica *por titular* (`PER_HOLDER`), con el número exacto de la fase que vas a usar.
- El acceso al estadio puede exigir identificarse: revisa las condiciones de cada partido.

## Cómo preparar la compra

1. **Evento** — Dashboard → *Eventos* → **Nuevo evento** → *Dónde se vende*: **Real Madrid**. Abre la página del partido en realmadrid.com y pulsa el marcador **📥 Enviar a la sala**: se rellenan el partido, la fecha y la hora, el [[Estadio Santiago Bernabéu]], el enlace, **las fases de venta** que enseñe la página (elige la tuya: socios, Madridistas, general…) y el límite si lo dice. Con el token gratuito de football-data.org sale además la lista de **próximos partidos en casa** (LaLiga y Champions) y la vigilancia avisa cuando LaLiga fija o cambia la hora (ver [[Buscar eventos oficiales y vigilar la venta]]).
2. **Límites** — los de tu fase, con el enlace a las condiciones.
3. **Cuentas** — una por persona que va a ir (su alias, nunca su número de socio ni su DNI).
4. **Operación** — sigue [[Comprar entradas reales (paso a paso)]].
