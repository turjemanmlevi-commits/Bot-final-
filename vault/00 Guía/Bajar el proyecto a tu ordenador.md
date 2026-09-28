---
tags:
  - guia
---

# Bajar el proyecto a tu ordenador

Todo el proyecto —código, dashboard y este vault— vive en el repositorio de GitHub. Para tenerlo en `C:\Users\Leviç\OneDrive\Desktop\bot final`:

## 1. Requisitos (una sola vez)

- **Node.js 22 LTS** (o ≥ 20.19): <https://nodejs.org>
- **Git**: <https://git-scm.com/download/win>
- **Obsidian**: <https://obsidian.md>

## 2. Descargar

Abre **PowerShell** y ejecuta:

```powershell
cd "C:\Users\Leviç\OneDrive\Desktop"
git clone -b claude/confident-bell-yb79l7 https://github.com/turjemanmlevi-commits/Bot-final-.git "bot final"
cd "bot final"
```

> [!warning] Si la carpeta `bot final` ya existe y tiene cosas
> `git clone` no escribe en una carpeta con contenido. Clónalo en otra (`bot final 2`) y mueve tus archivos después, o pídele a Claude (en una sesión local sobre esa carpeta) que lo fusione.

## 3. Instalar y arrancar

```powershell
npm install
npm run build      # compila el dashboard
npm start          # arranca servidor + dashboard
```

Abre <http://localhost:8787>. Pulsa **Nueva demo** para ver una operación completa contra el simulador.

## 4. Abrir el vault en Obsidian

En Obsidian: **Abrir carpeta como vault** → elige `C:\Users\Leviç\OneDrive\Desktop\bot final\vault`.

Abre **solo la carpeta `vault`**, no la raíz del proyecto (así Obsidian no indexa `node_modules`).

Con el servidor arrancado, cada vez que guardes una nota de recinto, evento o proveedor, el dashboard se actualiza solo (Recintos · vault).

## 5. Actualizar cuando haya cambios

```powershell
cd "C:\Users\Leviç\OneDrive\Desktop\bot final"
git pull
npm install
npm run build
```

## OneDrive

El Escritorio está sincronizado con OneDrive. `node_modules` y `data/` tienen miles de ficheros: si OneDrive va lento o da errores `EPERM`, pausa la sincronización mientras instalas o marca esas carpetas como «Liberar espacio». El vault y el código sí conviene sincronizarlos.

## Trabajar con Claude directamente en esta carpeta

Una sesión de Claude en la nube no puede tocar tu disco. Para que Claude trabaje **dentro de esta carpeta** (y veas el vault crecer en Obsidian en directo):

- Abre la app de escritorio de Claude → Claude Code → elige esta carpeta; o
- en una terminal dentro de la carpeta ejecuta `claude remote-control` y sigue la sesión desde la app.
