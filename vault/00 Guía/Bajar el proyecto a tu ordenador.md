---
tags:
  - guia
---

# Bajar el proyecto a tu ordenador

Todo el proyecto —código, dashboard y este vault— está en GitHub. El objetivo es tenerlo en `C:\Users\Leviç\OneDrive\Desktop\bot final` y arrancarlo con **doble clic en «Sala de control»** (el acceso directo del Escritorio) o en `INICIAR.bat`.

## 1. Instalar con un solo comando (recomendado)

1. Abre **PowerShell**: tecla Windows → escribe `PowerShell` → Enter. No hace falta abrirlo como administrador.
2. Copia esta línea, pégala en PowerShell (clic derecho) y pulsa **Enter**:

   ```powershell
   irm https://raw.githubusercontent.com/turjemanmlevi-commits/Bot-final-/claude/confident-bell-yb79l7/instalar.ps1 | iex
   ```

3. Si Windows pregunta si quieres permitir que se instale **Node.js**, pulsa **Sí**.
4. Cuando pregunte `Instalar tambien Obsidian para ver el vault? (s/n)`, escribe `s` y Enter (o `n` si ya lo tienes).
5. Se abre una **ventana negra**: es el servidor. La primera vez tarda unos minutos (instala y compila). Después se abre solo el navegador en <http://localhost:8787>.

> [!important] Deja la ventana negra abierta
> Es el servidor. Mientras esté abierta, el sistema funciona. Para pararlo, **ciérrala** (o pulsa Ctrl+C dentro de ella).

Qué hace el comando, paso a paso:

| Paso | Qué hace |
|---|---|
| 1. Node.js | Si no está instalado, instala **Node.js LTS** con `winget` (el instalador de programas de Windows). Si tu Windows no tiene `winget`, abre nodejs.org y se para: instálalo con las opciones por defecto y vuelve a pegar el comando |
| 2. Proyecto | Descarga la rama `claude/confident-bell-yb79l7` y la copia en la carpeta `bot final` de tu Escritorio (en este PC, `C:\Users\Leviç\OneDrive\Desktop\bot final`) con `robocopy /XO`. **No borra nada** y nunca toca tu `.env` (configuración, token de Telegram) ni la carpeta `data` (cuentas, operaciones, carritos). Tampoco pisa un archivo si el tuyo es más reciente que el de la descarga (tus notas editadas del vault), ni tu configuración de Obsidian (`vault\.obsidian`) si ya existe |
| 3. Acceso directo | Crea **Sala de control** en el Escritorio: abre `INICIAR.bat` |
| 4. Obsidian | Si respondes `s`, lo instala con `winget` |
| 5. Arranque | Abre `INICIAR.bat` (ver el punto 3) |

> [!tip] Si sale «Node.js no aparece todavía»
> Pasa a veces justo después de instalar Node.js. Cierra PowerShell, abre otro y vuelve a pegar el comando.

## 2. Otras formas de bajarlo

### Opción B · ZIP

1. Abre <https://github.com/turjemanmlevi-commits/Bot-final-> y, en el selector de ramas, elige `claude/confident-bell-yb79l7`.
2. Pulsa **Code → Download ZIP**. Enlace directo: <https://github.com/turjemanmlevi-commits/Bot-final-/archive/refs/heads/claude/confident-bell-yb79l7.zip>
3. Clic derecho en el ZIP → **Extraer todo…**. Dentro hay una carpeta (`Bot-final--claude-confident-bell-yb79l7` o parecida): copia **su contenido** en `C:\Users\Leviç\OneDrive\Desktop\bot final`, de forma que `INICIAR.bat` quede directamente dentro de `bot final`.
4. Doble clic en `INICIAR.bat`. Con esta opción no se crea el acceso directo «Sala de control».

> [!warning] «Windows protegió su PC»
> Windows SmartScreen avisa con los archivos descargados de Internet. Pulsa **Más información → Ejecutar de todas formas**.

### Opción C · Con Git

Necesitas **Git** (<https://git-scm.com/download/win>). Abre **PowerShell** y ejecuta:

```powershell
cd "C:\Users\Leviç\OneDrive\Desktop"
git clone -b claude/confident-bell-yb79l7 https://github.com/turjemanmlevi-commits/Bot-final-.git "bot final"
cd "bot final"
```

> [!warning] Si la carpeta `bot final` ya existe y tiene cosas
> `git clone` no escribe en una carpeta con contenido. Clónalo en otra (`bot final 2`) y mueve tus archivos después, o usa el comando del punto 1, que sí copia encima sin borrar nada.

## 3. Arrancar: «Sala de control» o `INICIAR.bat`

Cada vez que quieras usar el sistema: doble clic en **Sala de control** (Escritorio) o en `INICIAR.bat` (carpeta `bot final`). `INICIAR.bat`:

1. Busca Node.js. Si no está, lo instala con `winget`; si no puede, abre nodejs.org para que lo instales tú. Hace falta la versión 20.19 o superior (si la tuya es más antigua, abre nodejs.org para que instales la LTS).
2. Crea el archivo de configuración `.env` (copiando `.env.example`) si todavía no existe.
3. Instala las dependencias (`npm install`; si falla, lo reintenta una vez) y compila el dashboard (`npm run build`).
4. Desactiva la **«Edición rápida»** de la ventana negra: hacer clic dentro ya no pausa el servidor. Antes, un clic la ponía en modo «Seleccionar» y el servidor (tareas, T0, Telegram) se quedaba parado hasta pulsar una tecla. Si aun así el título de la ventana empieza por «Seleccionar», pulsa `Esc`.
5. Arranca el servidor y abre el navegador en <http://localhost:8787> (o en el puerto `PORT` del `.env`).

La **primera vez tarda unos minutos**. Después es mucho más rápido.

Con el servidor en marcha, un error inesperado en segundo plano (en el scheduler o en una promesa sin controlar) se anota en la ventana negra y el servidor sigue funcionando.

Para ensayar, pulsa **Nueva demo** en el dashboard: verás una operación completa contra el simulador. Para comprar de verdad: la página **Cómo se compra** del dashboard y [[Comprar entradas reales (paso a paso)]]. Para los avisos en el móvil: [[Configurar Telegram]].

## 4. Abrir el vault en Obsidian (opcional)

Si no lo instalaste con el comando, descárgalo de <https://obsidian.md>. Pulsa **Abrir carpeta como vault** → elige `C:\Users\Leviç\OneDrive\Desktop\bot final\vault`.

Abre **solo la carpeta `vault`**, no la raíz del proyecto (así Obsidian no indexa `node_modules`).

Con el servidor arrancado, cada vez que guardes una nota de recinto, evento o proveedor, el dashboard se actualiza solo (*Recintos · vault*). Puedes renombrar o mover carpetas en Obsidian con el servidor en marcha: ya no lo tumba (si la recompilación falla a mitad, se anota un aviso y se reintenta con el siguiente cambio).

## 5. Actualizar cuando haya cambios

Primero cierra la ventana negra del servidor.

- **Si lo instalaste con el comando** (o con el ZIP): vuelve a pegar en PowerShell el comando del punto 1. Copia la versión nueva encima **sin borrar** tu `.env`, la carpeta `data` ni tu configuración de Obsidian (`vault\.obsidian`), sin pisar archivos tuyos más recientes que los de la descarga, y arranca.
- **Revisa tu `.env` tras actualizar:** si se creó con una versión anterior puede tener `MANUAL_TASK_MINUTES=10`. Actualizar no lo cambia y ese valor manda sobre el nuevo defecto (30 minutos para responder cada tarea de compra). Ábrelo con el Bloc de notas, pon `MANUAL_TASK_MINUTES=30` (o borra la línea), guarda y reinicia.
- **Si lo clonaste con Git:**

  ```powershell
  cd "C:\Users\Leviç\OneDrive\Desktop\bot final"
  git pull
  ```

  Después, doble clic en `INICIAR.bat`: instala y compila lo nuevo solo.

- **Si prefieres el ZIP a mano:** descárgalo de nuevo, extráelo y copia su contenido encima de `bot final`, reemplazando los archivos **excepto la carpeta `data` y el archivo `.env`**: ahí están tus cuentas, tus operaciones y la configuración de Telegram. No borres la carpeta antes de copiar. Luego, doble clic en `INICIAR.bat`.

> [!note] Tus notas del vault
> Los eventos y recintos que hayas creado se conservan al actualizar. Si has **editado** notas que venían con el proyecto (por ejemplo, un recinto), el comando de instalación no las pisa si tu copia es más reciente que la de la versión descargada. Si no estás seguro, o si actualizas copiando el ZIP a mano, haz antes una copia: la versión nueva puede sustituirlas.

## OneDrive

El Escritorio está sincronizado con OneDrive. `node_modules` y `data/` tienen miles de ficheros: si OneDrive va lento o la instalación da errores `EPERM` o `EBUSY`, **pausa la sincronización** durante la primera instalación (icono de la nube → *Pausar sincronización*) y vuelve a abrir `INICIAR.bat`. También puedes marcar esas carpetas como «Liberar espacio». El vault y el código sí conviene sincronizarlos.

## Arranque manual (alternativa)

Si prefieres PowerShell, dentro de la carpeta `bot final`:

```powershell
npm install
npm run build      # compila el dashboard
npm start          # arranca servidor + dashboard
```

## Trabajar con Claude directamente en esta carpeta

Una sesión de Claude en la nube no puede tocar tu disco. Para que Claude trabaje **dentro de esta carpeta** (y veas el vault crecer en Obsidian en directo):

- Abre la app de escritorio de Claude → Claude Code → elige esta carpeta; o
- en una terminal dentro de la carpeta ejecuta `claude remote-control` y sigue la sesión desde la app.
