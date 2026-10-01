---
tags:
  - guia
  - compra
  - real-madrid
---

# Real Madrid - Villarreal (paso a paso)

Evento ya preparado en la sala: [[Real Madrid - Villarreal CF · LaLiga J8]]. Guía general: [[Comprar entradas reales (paso a paso)]].

> [!important] Lo esencial (datos oficiales comprobados el 29-sep-2026)
> - **Partido:** sábado **10 de octubre de 2026, 21:00**, Estadio Santiago Bernabéu (LaLiga, jornada 8).
> - **Dónde se compra:** solo online, en **realmadrid.com** (el club cita también entradas.com). Sin venta telefónica. La entrada va **en el móvil**. Sin cambios ni devoluciones.
> - **Fases de venta** (hora de Madrid):
>   - **Socios no abonados** (20 % de descuento): viernes **2 oct, 12:00** → lunes 5 oct, 10:00.
>   - **Madridistas Platinum / Premium** (carné de pago): lunes **5 oct, 10:00** → martes 6 oct, 10:00. **1 entrada por carné, máximo 4 por compra.**
>   - **Público general** (cuenta de realmadrid.com): martes **6 oct, 10:00**, hasta agotar. El máximo por compra **no está publicado**.
> - **Normas del club:** **una sola cuenta por persona**; las entradas de socio y de Madridista son personales e intransferibles (en el acceso pueden pedir el DNI); la reventa está prohibida; se paga con tarjeta con 3D Secure.
> - La sala **no entra** en realmadrid.com, no compra y no se salta la cola: cada persona compra y paga con **su** cuenta. La sala reparte el trabajo, avisa al segundo por Telegram y lleva la cuenta de límites y carritos.

## Ya hecho

- El evento está creado con la apertura de la **venta general** (martes 6 oct, 10:00), **1 entrada por cuenta** (todas las cuentas a la vez), la estructura de la venta (laterales y fondos con sus precios) y **vigilancia desde 7 días antes** (te avisa por Telegram).
- Los límites están **sin verificar** a propósito: el club no publica el máximo de la venta general. Mira el paso 4.

## Antes del día (15 minutos)

1. **Actualiza la sala** (el comando de siempre, en cmd):
   `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/turjemanmlevi-commits/Bot-final-/claude/confident-planck-41m20b/instalar.ps1 | iex"`
2. **Cuentas** (menú *Cuentas → Nueva cuenta*): **una por cada persona que va**, web **Real Madrid**, con un **alias** (nada de emails, teléfonos ni DNI). Si una misma persona tiene varias cuentas, pon el **mismo titular**: la sala las cuenta como una sola persona y nunca pasa de su límite.
3. **Telegram**: cada persona escribe **/start** a tu bot desde su móvil; en *Ajustes → Telegram → Asignar a una cuenta* le das su chat. Pulsa **Probar** en cada una: le debe llegar un mensaje.
4. **Límites** (*Eventos → Editar el partido → 4 · Límites de compra*):
   - Con **1 entrada por persona** (lo recomendado para este partido) puedes poner **1 por cuenta y 1 por grupo**: es el mínimo posible, así que nunca supera el límite oficial. Escribe en «De dónde salen los límites» que es el mínimo, y marca **«He comprobado estos límites»**.
   - Si queréis más de 1 por persona, espera a ver el máximo en la página de compra del club (o en sus condiciones) y ponlo entonces. **Sin límites verificados no se puede armar la operación.**
5. **Dónde sentaros** (mismo formulario, paso 5): toca hasta **3 zonas** en orden (🟢 1ª, 🟠 2ª, 🔵 3ª). Si vais como **socios** o **Madridistas Platinum/Premium**, cambia la **apertura** a la de vuestra fase (paso 3 · Fechas). Guarda.
6. **Cada persona comprueba hoy** que puede entrar en su cuenta de **realmadrid.com** desde el móvil y que su tarjeta pasa el 3D Secure.

## La víspera (lunes 5 oct)

7. **Operaciones → Nueva** desde el partido: marca las cuentas (hasta 10), deja **1 entrada por cuenta** y las zonas en orden → **Crear y validar** → corrige lo que salga en rojo → **Armar**. Cada persona recibe su **plan** por Telegram.

## El día (martes 6 oct)

| Hora | Qué pasa | Qué hace cada persona |
|---|---|---|
| **9:30, 9:50 y 9:58** | El bot avisa «⏰ Faltan N min: entrad ya» a quien no tiene la sesión lista | Entrar en **realmadrid.com** con su cuenta, abrir la página del partido y, si hay **sala de espera**, entrar ya. Pulsar **«Sesión lista»** en Telegram |
| **10:00 (T0)** | Cada persona recibe **en un solo mensaje** «🚦 ¡Abre la venta!» con **su tarea**: zona, precio máximo y el botón a la web oficial | Comprar **1 entrada** en su zona (si hay cola, esperar el turno como cualquiera) y pulsar **«En carrito»**; si no hay entradas, **«No pude»**: al momento le llega la **siguiente zona** |
| **Después** | La sala lleva la cuenta de carritos y del tiempo que les queda | **Pagar** en la web oficial y pulsar **«Pagado»** |

> [!tip] Si algo va mal
> **Pausa** (en la operación o **/pausa** en Telegram) o **PARAR TODO** (*Seguridad*, o **/parar_todo**): se avisa al momento a todas las personas de que paren. Al **reanudar**, cada persona sigue en su zona (nunca vuelve a una donde ya dijo «No pude»). Si el PARAR TODO está activo a las 10:00, la operación **queda en pausa** (no se pierde): suéltalo y pulsa **Reanudar**.

## Qué se ha comprobado esta noche (con simuladores)

Ensayo con reloj real de este mismo partido (copia de la sala, venta abriendo a los 3 minutos, 10 cuentas con su chat, Telegram simulado en el mismo ordenador), antes y después de las mejoras de esta noche:

| Qué | Antes | Ahora |
|---|---|---|
| De la apertura a la tarea en el chat de cada persona | 27–32 ms | **10–13 ms** |
| Mensajes por persona a la hora de apertura | 2 (la tarea llegaba antes que el aviso) | **1** (aviso y tarea juntos) |
| «Sesión lista» registrada | 17–50 ms | **5–17 ms** |
| 8 personas pulsan «en carrito» a la vez (Telegram con 80 ms de retraso) | hasta 1 s | **menos de 0,1 s** |
| «No pude» → siguiente zona | 7 ms | 5–7 ms |

Además:

- Ana, con **2 cuentas** (mismo titular), recibe **1** tarea: nunca se pasa del límite por persona. Y aunque hagáis **dos operaciones del mismo partido**, lo que una persona ya tiene (o está comprando) en una cuenta cuenta para la otra: la segunda no la deja pasar del límite.
- A quien no tenía la sesión lista le llegaron los avisos «entrad ya».
- Con una red más lenta (50 ms hasta Telegram), la tarea llega en **33–48 ms** (antes 169–209 ms): las conexiones con Telegram se abren 3 segundos antes de la hora.
- Si Telegram falla o pide esperar (errores 429 o 500), el mensaje **se reintenta** en vez de perderse (antes se perdían 8 de 11 en el chat principal).

No se ha probado contra realmadrid.com ni contra Telegram o Claude reales (desde la nube no se usan tus claves): el ensayo de verdad es el tuyo.
