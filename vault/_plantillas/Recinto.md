---
type: venue
id: 
name: "{{title}}"
city: 
aliases: []
capacity: 
source: ""
verifiedAt: {{date}}
verifiedBy: 
confidence: 0.8
tags:
  - recinto
---

# {{title}}

Descripción breve del recinto.

## Cómo darlo de alta

1. Crea la carpeta `10 Recintos/{{title}}/` con subcarpetas `Zonas/` y `Secciones/`.
2. Mueve esta nota a esa carpeta.
3. Crea una nota por zona (plantilla **Zona**) y una por sección (plantilla **Sección**).
4. Rellena `source` con el plano oficial que has usado y `confidence` con lo seguro que estás (0–1).
5. Guarda: el servidor recompila solo y el dashboard lo muestra en **Recintos**.
