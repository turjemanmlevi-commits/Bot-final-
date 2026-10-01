---
type: venue
id: arena-demo-madrid
name: Arena Demo Madrid
city: Madrid
aliases:
  - "Arena Demo"
  - "ADM"
capacity: 11500
source: "Plano ficticio de demostración (no es un recinto real)"
verifiedAt: 2026-09-01
verifiedBy: demo
confidence: 0.9
tags:
  - recinto
  - demo
---

# Arena Demo Madrid

> [!warning] Recinto ficticio
> Es un recinto **de demostración** para probar el sistema de punta a punta. Para dar de alta un recinto real usa las plantillas de `_plantillas` y copia los datos del plano oficial, indicando siempre la fuente (`source`), la fecha (`verifiedAt`) y tu confianza (`confidence`, de 0 a 1).

Pabellón multiusos con pista de pie, dos niveles de grada, plataforma accesible y palcos laterales.

## Zonas

- [[Pista]] — De pie, delante del escenario.
- [[Grada Baja]] — Nivel 1, sentado, alrededor de la pista.
- [[Grada Alta]] — Nivel 2, sentado, más lejos pero más barato.
- [[Palcos]] — Palcos laterales de 10 plazas.

## Secciones

```base
filters:
  and:
    - 'note.type == "section"'
    - 'file.inFolder("10 Recintos/Arena Demo Madrid")'
views:
  - type: table
    name: Secciones
    order:
      - file.name
      - note.zone
      - note.kind
      - note.view
      - note.distance
      - note.capacity
      - note.obstructed
      - note.accessible
      - note.confidence
```

## Cómo lo usa el sistema

- `npm run vault:compile` (o el botón **Recompilar vault** del dashboard) lee esta nota, sus zonas y sus secciones y genera un *VenueArtifact* con hash. El servidor lo recompila solo cuando guardas cambios en Obsidian.
- Cada operación **armada** congela el hash del artefacto: editar el vault después no cambia una operación en curso.
- Los `aliases` de cada sección son las etiquetas que puede usar el proveedor ("SEC 101", "Grada Baja 101"...). Si el dashboard muestra etiquetas sin resolver, añádelas aquí.
- Ver [[Cómo funciona el vault]] y [[Selección de entradas]].
