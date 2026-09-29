---
tags:
  - guia
  - eventos
---

# Buscar eventos oficiales y vigilar la venta

Al crear un evento ya no hace falta escribirlo: eliges el **recinto** y **dónde se vende**, y salen los **próximos eventos oficiales** de ese recinto. Al elegir uno se rellenan solos el nombre, el enlace oficial, la fecha y la hora, la **apertura de la venta** (o de la preventa que elijas) y el **límite de compra** que publica la web. Después la sala **vigila el evento** desde los días que digas antes de la venta.

> [!important] Solo lee datos públicos
> Las fuentes son APIs **oficiales y gratuitas** de solo lectura. La sala **no entra** en ticketmaster.es, entradas.com ni realmadrid.com, no inicia sesión y no compra: eso lo sigue haciendo cada persona en la web oficial, con su cuenta. Ver [[Uso legítimo y guardarraíles]].

## Qué fuentes hay

| Fuente | Qué da | Cuándo sale |
|---|---|---|
| **Ticketmaster** (Discovery API) | Próximos eventos del recinto, fecha y hora, **apertura de la venta general y de cada preventa**, **límite de compra** («Hay un límite de 6 entradas por cliente»), precio y enlace | Al elegir «Ticketmaster» en *Dónde se vende* |
| **Partidos** (football-data.org) | Próximos partidos **en casa** del club del estadio, en LaLiga y en la Champions, con la fecha y la hora oficiales y si la hora ya está fijada | Al elegir un estadio de LaLiga (el [[Estadio Santiago Bernabéu]] → partidos del Real Madrid) |
| entradas.com | — | No tiene una API pública oficial: el evento se escribe a mano desde su web |
| realmadrid.com | — | No tiene API: los **partidos** salen con «Partidos»; la **apertura de la venta** y el **límite** de cada partido se copian de la web del club |

## Ponerlas en marcha (una vez, 5 minutos cada una)

En el dashboard, **Ajustes · Fuentes de eventos**:

1. **Ticketmaster**: pulsa **Crear la clave gratis** (developer.ticketmaster.com), crea la cuenta y confirma el email. Arriba a la derecha, tu nombre → **My Apps**: copia la **Consumer Key** (la primera clave larga; la «Consumer Secret» no hace falta), pégala y pulsa **Conectar**.
2. **Partidos**: pulsa **Pedir el token gratis** (football-data.org → Register, plan *Free*). Te llega por email el «API token»: pégalo y pulsa **Conectar**.

Se comprueban al momento y se guardan solo en este ordenador (archivo `.env`, que no se sube a ningún sitio). No hace falta reiniciar. La clave gratuita de Ticketmaster admite 5.000 consultas al día y la de football-data.org 10 por minuto: la sala guarda los resultados unos minutos para no gastarlas.

## Crear un evento eligiéndolo

**Eventos → Nuevo evento**:

1. Elige el **Recinto** y **Dónde se vende**.
2. Sale el cuadro **«Elige el evento oficial»** con los **eventos de las próximas 2 semanas** de ese recinto. En *Qué buscar* puedes ver el próximo mes, los próximos 3 meses o **«Ventas que abren en las próximas 2 semanas»** (eventos de más adelante cuya venta abre pronto). También puedes escribir el **artista** o el nombre del evento.
3. Cada evento enseña: fecha y hora (de Madrid), estado (*A la venta*, *Sin venta ahora*, *Aplazado*…), cuándo abre la **venta general** y cada **preventa**, el **límite de compra** con la frase oficial, el precio y su **ID** oficial. Con **Ver en Ticketmaster** compruebas que es ese.
4. Pulsa **Usar este evento**. Si tiene preventas, sale un botón por fase: **Usar · Venta general**, **Usar · Preventa…**: la hora de esa fase será la **apertura (T0)**.
5. Se rellena todo y queda **vinculado** («Evento oficial vinculado»). Revisa y pulsa **Guardar evento**.

> [!tip] El límite de compra
> Si Ticketmaster publica el límite, se lee de la frase oficial y se pone solo: **por cuenta** = ese número y **cómo cuenta** = **por titular** (Ticketmaster cuenta por cliente: mismo nombre, cuenta o tarjeta), con la frase citada en «De dónde salen los límites». Si no lo publica en su API, lo dice: míralo en la página del evento («Límite de X entradas por cliente») y escríbelo. En los partidos el límite lo pone el club: cópialo de sus condiciones.

## Vigilar la venta

En el mismo formulario, apartado **Fechas**, **Vigilar desde**: *1 día*, **2 días** (lo normal), *3 días*, *1 semana* o *2 semanas* antes de la venta (o del evento, si no tiene apertura). Desde ese momento:

- Te llega por Telegram **«👀 Vigilando…»** con la hora de apertura.
- Si el evento está **vinculado**, la sala consulta la fuente oficial **cada 10 minutos** (cada 2 en las 3 horas finales). Si cambia algo, te avisa en el dashboard y por Telegram:
  - **Cambia la hora de la venta** (o de la preventa elegida) o **la fecha del evento** → se **actualiza sola** en el evento (nota de Obsidian incluida).
  - **Nueva preventa**, **LaLiga fija la hora** del partido, **aplazado** o **cancelado** → aviso (crítico si se cancela o se aplaza).
  - **Cambia el límite de compra** → aviso (crítico si baja por debajo del que tiene el evento). El límite **nunca se cambia solo**: lo revisas tú en *Editar*.
- Recordatorios: **el día antes** («⏰ Mañana…») y **una hora antes** («⏰ En 1 hora…», que dice si todavía no hay operación armada). Si llega la hora y no hay operación armada: «🔔 Abre la venta…».
- Una hora después de abrir, deja de vigilar.

En **Eventos**, cada evento dice si se vigila, la última consulta y los últimos cambios oficiales. Si el evento no está vinculado (entradas.com, eventos escritos a mano), solo hay recordatorios.

> [!note] Si ya hay una operación armada
> La vigilancia actualiza el **evento**, no el T0 de una operación ya armada. Si te avisa de que la venta cambia de hora, **Desarmar → Editar configuración → T0 → Armar** en la operación.

## Si algo no sale

| Qué pasa | Qué hacer |
|---|---|
| «Falta la clave de Ticketmaster» | Ponla en **Ajustes · Fuentes de eventos** |
| «No encuentro «…» en Ticketmaster» | Escribe el artista o el nombre del evento en el buscador del cuadro |
| No sale un partido | Solo salen partidos **en casa** del club del estadio (propiedad `club` de la nota del recinto) en LaLiga y Champions. La Copa del Rey no está en la cuenta gratuita |
| «Ticketmaster no acepta la clave» | Copia otra vez la **Consumer Key** (no la *Consumer Secret*) |
| «Demasiadas consultas» | Espera un minuto: la cuenta gratuita tiene límite |

Relacionado: [[Comprar entradas reales (paso a paso)]] · [[Ticketmaster]] · [[Real Madrid]] · [[Entradas.com]] · [[Configurar Telegram]].
