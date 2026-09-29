---
tags:
  - guia
---

# Bajar el proyecto a tu ordenador

Todo el proyecto —código, dashboard y este vault— está en GitHub. El objetivo es tenerlo en `C:\Users\Leviç\OneDrive\Desktop\bot final` y arrancarlo con **doble clic en `INICIAR.bat`**.

## 1. Descargar (elige una opción)

### Opción A · ZIP (sin instalar nada más)

1. Abre <https://github.com/turjemanmlevi-commits/Bot-final-> y, en el selector de ramas, elige `claude/confident-bell-yb79l7`.
2. Pulsa **Code → Download ZIP**. Enlace directo: <https://github.com/turjemanmlevi-commits/Bot-final-/archive/refs/heads/claude/confident-bell-yb79l7.zip>
3. Clic derecho en el ZIP → **Extraer todo…**. Dentro hay una carpeta (`Bot-final--claude-confident-bell-yb79l7` o parecida): copia **su contenido** en `C:\Users\Leviç\OneDrive\Desktop\bot final`, de forma que `INICIAR.bat` quede directamente dentro de `bot final`.

### Opción B · Con Git

Necesitas **Git** (<https://git-scm.com/download/win>). Abre **PowerShell** y ejecuta:

```powershell
cd "C:\Users\Leviç\OneDrive\Desktop"
git clone -b claude/confident-bell-yb79l7 https://github.com/turjemanmlevi-commits/Bot-final-.git "bot final"
cd "bot final"
```

> [!warning] Si la carpeta `bot final` ya existe y tiene cosas
> `git clone` no escribe en una carpeta con contenido. Clónalo en otra (`bot final 2`) y mueve tus archivos después, o pídele a Claude (en una sesión local sobre esa carpeta) que lo fusione.

## 2. Instalar Node.js (una sola vez)

Descarga la versión **LTS** de <https://nodejs.org> e instálala con las opciones por defecto (hace falta la 20.19 o superior). Si `INICIAR.bat` no encuentra Node.js o es demasiado antiguo, abre esa web por ti.

## 3. Arrancar: doble clic en `INICIAR.bat`

`INICIAR.bat`, en la carpeta `bot final`:

1. Comprueba que tienes Node.js 20.19 o superior.
2. Crea el archivo de configuración `.env` (copiando `.env.example`) si todavía no existe.
3. Instala las dependencias (`npm install`; si falla, lo reintenta una vez) y compila el dashboard (`npm run build`).
4. Arranca el servidor y abre el navegador en <http://localhost:8787> (o en el puerto `PORT` del `.env`).

La **primera vez tarda unos minutos**. Después es mucho más rápido.

> [!important] Deja la ventana negra abierta
> Es el servidor. Mientras esté abierta, el sistema funciona. Para pararlo, **ciérrala** (o pulsa Ctrl+C dentro de ella).

> [!warning] «Windows protegió su PC»
> Windows SmartScreen avisa con los archivos descargados de Internet. Pulsa **Más información → Ejecutar de todas formas**.

Para ensayar, pulsa **Nueva demo** en el dashboard: verás una operación completa contra el simulador. Para comprar de verdad: [[Comprar entradas reales (paso a paso)]]. Para los avisos en el móvil: [[Configurar Telegram]].

## 4. Abrir el vault en Obsidian (opcional)

Instala Obsidian (<https://obsidian.md>) y pulsa **Abrir carpeta como vault** → elige `C:\Users\Leviç\OneDrive\Desktop\bot final\vault`.

Abre **solo la carpeta `vault`**, no la raíz del proyecto (así Obsidian no indexa `node_modules`).

Con el servidor arrancado, cada vez que guardes una nota de recinto, evento o proveedor, el dashboard se actualiza solo (Recintos · vault).

## 5. Actualizar cuando haya cambios

Primero cierra la ventana negra del servidor.

- **Si lo clonaste con Git:**

  ```powershell
  cd "C:\Users\Leviç\OneDrive\Desktop\bot final"
  git pull
  ```

  Después, doble clic en `INICIAR.bat`: instala y compila lo nuevo solo.

- **Si usaste el ZIP:** descárgalo de nuevo, extráelo y copia su contenido encima de `bot final`, reemplazando los archivos **excepto la carpeta `data` y el archivo `.env`**: ahí están tus cuentas, tus operaciones y la configuración de Telegram. No borres la carpeta antes de copiar. Luego, doble clic en `INICIAR.bat`.

> [!note] Tus notas del vault
> Los eventos y recintos que hayas creado se conservan al copiar encima. Si has **editado** notas que venían con el proyecto (por ejemplo, un recinto), haz antes una copia: la versión del ZIP las sustituye.

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
