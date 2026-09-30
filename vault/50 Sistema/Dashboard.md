---
tags:
  - sistema
---

# Dashboard

Sala de control en <http://localhost:8787> (o <http://localhost:5173> con `npm run dev:dashboard`). Se abre con **Sala de control** (acceso directo del Escritorio) o `INICIAR.bat`, y se actualiza en tiempo real por SSE.

El menú de la izquierda tiene tres grupos: **Operar**, **Preparar** y **Controlar**.

| Sección | Ruta | Para qué |
|---|---|---|
| **Resumen** | `/` | Operación en foco con el tablero de cuenta atrás a T0, la línea de estados, progreso y presupuesto; carritos por pagar; alertas; lista **Compra real · lista de comprobación** (Telegram, cuentas, evento con límites verificados, operación armada, sesiones listas) con enlace a *Cómo se compra* |
| **Operaciones** | `/operaciones`, `/operaciones/nueva`, `/operaciones/:id` | Lista, alta/edición y detalle. El detalle muestra la tarjeta **Plan de compra · dónde y en qué orden** y las pestañas *En directo* (cuentas, colas, inventario, latencias, decisiones, claims), *Preparación* (validación, readiness, política, snapshot), *Carritos*, *Historial* y *Replay* |
| **Tareas humanas** | `/tareas` | Lo que le toca hacer a una persona, con formularios de respuesta, el botón **Abrir la web oficial** y, en las tareas de compra, el plano con **su zona resaltada** |
| **Carritos** | `/carritos` | Cuenta atrás de caducidad, **Abrir la web oficial para pagar** (o *Abrir carrito* en el simulador), **Ya lo he pagado** o **Liberar**, y **Minutos que quedan** (`+5 min`, o de 1 a 60 y **Guardar**) para poner o corregir la cuenta atrás. Un carrito confirmado por una persona cuyo tiempo se agotó muestra «Tiempo agotado: ¿lo has pagado?» con **Ya lo he pagado** y **Liberar**; uno caducado del simulador, «¿Lo pagaste antes de que caducara?» con **Ya lo he pagado** |
| **Alertas** | `/alertas` | Todas, con sus acciones |
| **Cómo se compra** | `/guia` | La compra real en 9 pasos (quién hace qué y cuándo), un ejemplo del plan sobre el plano del Bernabéu, qué hace Telegram y qué hacer si algo va mal |
| **Cuentas** | `/cuentas` | Alta de cuentas (solo alias), chat de Telegram de cada persona, sesiones, colas, **Parar cuenta** (botón de apagado: solo excluye esa cuenta; la operación sigue con las demás, también si se para antes de T0) |
| **Eventos** | `/eventos` | Catálogo del vault con sus límites. **Nuevo evento** y **Editar** escriben la nota en `20 Eventos/` (enlace oficial, fechas en hora de Madrid, límites y su fuente) |
| **Recintos · vault** | `/recintos`, `/recintos/:hash` | Estado de la compilación y lista de recintos. La ficha de cada recinto muestra el **plano**, la procedencia, el probador de etiquetas y las secciones con aliases. **Nuevo recinto** crea `10 Recintos/<nombre>/` con zonas y secciones (formato abajo) |
| **Seguridad** | `/seguridad` | Kill switches, circuitos y guardarraíles |
| **Calidad · gates** | `/calidad` | Ejecutar G0–G6 y ver el informe |
| **Auditoría** | `/auditoria` | El journal filtrable |
| **Ajustes · Telegram** | `/ajustes` | Estado del bot, **Enviar mensaje de prueba**, **Probar ese chat**, chats que han escrito al bot (con su chat ID), proveedores y datos del sistema |

## Plano del recinto

Se dibuja solo a partir de las notas de zonas y secciones del vault (no hace falta ninguna imagen). Es **orientativo**: los sectores exactos están en el plano oficial de cada venta.

- **Estadio** (cuando las zonas dicen su orientación: Norte, Sur, Este, Oeste, o izquierda/derecha): óvalo con el campo en el centro y el **norte arriba** (flecha N). Cada zona es una grada en su lado —en el Bernabéu, Fondo Norte arriba, Fondo Sur abajo, Lateral Oeste a la izquierda y Lateral Este a la derecha— y sus niveles son **anillos**, del más cercano al campo (dentro: Nivel inferior, «Grada / Tribuna» en la leyenda) al más alto (fuera: Cuarto anfiteatro). Cuanto más cerca del campo, más intenso el color. Las zonas sin orientación ocupan los lados libres.
- **Pabellón o teatro**: el **escenario** arriba, la pista (zonas de pie) en el centro y las demás zonas como anillos en «U» alrededor (platea o grada baja dentro; palcos; anfiteatro; grada alta fuera). Las secciones «izquierda», «central» y «derecha» se colocan en su sitio.
- En verde, las plazas accesibles. Atenuadas, las secciones cerradas para un evento.
- Pasar el ratón por una sección muestra su nombre. En la ficha del recinto, tocarla muestra además su grada, anillo, visión y cómo puede aparecer en la web (aliases).

Dónde aparece:

| Dónde | Qué muestra |
|---|---|
| *Recintos · vault → (recinto)* | El plano completo, tarjeta **Plano del recinto** |
| *Operaciones → Nueva operación*, apartado «4 · Dónde» | Tocar una sección del plano la añade como objetivo al final de la lista; el plano numera los objetivos (1, 2, 3…) en el orden en que se intentarán. Las gradas enteras y las zonas de pie se añaden con los botones de «Añadir desde el vault»; reordenar con las flechas, quitar con ✕ |
| *Operación → Plan de compra · dónde y en qué orden* | El plano con los objetivos numerados, la lista **Orden de zonas** y **Ahora mismo**: quién está intentando cuántas en qué zona y qué hay ya en carrito o pagado |
| *Tareas humanas* (tareas de compra y de verificar carrito) | Desplegable «Dónde está <zona> en el recinto» con la zona de la tarea resaltada («Tu zona») |
| *Cómo se compra* | Un ejemplo de plan de tres zonas sobre el Bernabéu |

## Nuevo recinto

Formato: una zona por línea, con sus secciones tras «:» separadas por comas; «(de pie)» marca la zona como de pie; una zona sin secciones tiene una única sección con su nombre; si una sección se repite en varias zonas se le antepone la zona. Para que el plano salga como estadio, pon la orientación en el nombre de cada zona (`Fondo Norte`, `Lateral Este`…) y el nivel en el de cada sección (`Primer anfiteatro`, `Grada baja`…).

```
Lateral Este: Grada baja, Primer anfiteatro, Segundo anfiteatro
Pista (de pie)
Grada Alta: 201, 202, 203
```

Los botones **Ejemplo: pabellón** y **Ejemplo: estadio** rellenan el cuadro, y la vista previa enseña las zonas y secciones exactas antes de crearlas.

## Arriba

A la derecha: **quién opera** (se guarda en la auditoría de cada acción) y el tema claro/oscuro. A la izquierda: la hora, el modo (simulación, asistencia manual o mixto), el journal y el estado de Telegram.

Diseño: monocromo; el color solo aparece cuando significa algo (estado o dato). El tablero de salidas marca la cuenta atrás a T0 y la línea de metro, el estado de la operación.
