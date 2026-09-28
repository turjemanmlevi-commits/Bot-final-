---
tags:
  - guia
---

# Cómo funciona el vault

El servidor recorre el vault, lee el **frontmatter** (propiedades) de cada nota y compila:

- un **VenueArtifact** por recinto (y otro por evento si el evento cierra secciones), con **hash de contenido**: si nada cambia, el hash no cambia;
- el **catálogo de eventos** con sus límites;
- la **autorización** de capabilities por proveedor.

Las notas sin `type` son documentación y se ignoran. La carpeta `_plantillas` y las carpetas que empiezan por punto también.

## Tipos de nota

| `type` | Dónde | Propiedades clave |
|---|---|---|
| `venue` | `10 Recintos/<Recinto>/<Recinto>.md` | `id`, `name`, `city`, `aliases`, `source`, `verifiedAt`, `confidence` |
| `zone` | `10 Recintos/<Recinto>/Zonas/` | `venue`, `aliases` |
| `section` | `10 Recintos/<Recinto>/Secciones/` | `venue`, `zone`, `kind` (SEATED/STANDING), `aliases`, `rows`, `seatsPerRow`, `capacity`, `view` (0–5), `obstructed`, `accessible`, `distance`, `confidence` |
| `event` | `20 Eventos/` | `venue`, `provider`, `providerEventRef`, `startsAt`, `onSaleAt`, `currency`, `limit*`, `closedSections` |
| `provider` | `30 Proveedores/` | `id`, `mode`, `authorizedCapabilities` |

- `venue` y `zone` se escriben como enlaces: `venue: "[[Arena Demo Madrid]]"`. Si una nota está dentro de la carpeta de un recinto, `venue` es opcional.
- Las **fechas sin zona horaria** (como las escribe Obsidian: `2026-10-09T10:00`) se interpretan en `Europe/Madrid` (variable `VAULT_TZ` del servidor).
- Los **ids** se generan solos a partir del nombre si no los pones (`arena-demo-madrid.101`). Si renombras una sección, cambia su id: evita renombrar secciones que ya usan operaciones armadas.

## Aliases: la pieza clave

Cada ticketera escribe las secciones a su manera: «SEC 101», «Grada Baja - 101», «SECCION-101»… El sistema normaliza (minúsculas, sin tildes ni signos) y busca en este orden:

1. coincidencia exacta con el nombre, el id o un alias;
2. la misma sin espacios;
3. quitando prefijos genéricos (`sec`, `sección`, `sector`, `bloque`, `zona`…);
4. el número de sección dentro de la zona mencionada;
5. solo la zona (si tiene una única sección).

Cuanto menos directa es la coincidencia, **más ambigüedad** (0 = segura, 1 = sin resolver). Cada operación decide cuánta ambigüedad tolera. Las etiquetas que no se resuelven aparecen en el dashboard (Operación → En directo → Inventario): añádelas como alias de su sección.

Puedes probar cualquier etiqueta en el dashboard: **Recintos → (recinto) → Probar una etiqueta del proveedor**.

## Errores mientras escribes

Si una nota queda a medias (YAML roto), el servidor **mantiene la última compilación válida** y muestra el error en el dashboard. En cuanto la nota vuelve a ser válida, se aplica.

## Operaciones armadas

Al **armar** una operación se congela el hash del recinto. Editar el vault después **no** cambia esa operación: así cada decisión es reproducible (ver [[Replay y auditoría]]).

## Compilar a mano

```powershell
npm run vault:compile
```

Deja el resultado en `compiled/` y sale con error si alguna nota no es válida.
