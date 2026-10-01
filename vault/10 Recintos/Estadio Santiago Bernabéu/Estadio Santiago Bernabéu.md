---
type: venue
id: estadio-santiago-bernabeu
name: Estadio Santiago Bernabéu
city: Madrid
club:
  - "Real Madrid"
  - "Real Madrid CF"
aliases:
  - "Santiago Bernabéu"
  - "Bernabéu"
  - "Bernabeu"
source: "Nomenclatura pública del estadio (realmadrid.com/es-ES/entradas y planos públicos): gradas Lateral Oeste, Lateral Este, Fondo Norte y Fondo Sur; niveles Grada/Tribuna y primer a cuarto anfiteatro. Sectores concretos: comprobar en el plano oficial de cada partido."
verifiedAt: 2026-09-28
verifiedBy: asistente
confidence: 0.7
tags:
  - recinto
  - real
---

# Estadio Santiago Bernabéu

Estadio del Real Madrid, en el paseo de la Castellana (Madrid). Se vende en [[Real Madrid]].

> [!info] Qué está verificado
> - **Gradas** (zonas): [[Lateral Oeste]], [[Lateral Este]], [[Fondo Norte]] y [[Fondo Sur]].
> - **Niveles** (secciones de cada grada): nivel inferior (Grada / Tribuna) y primer, segundo, tercer y cuarto anfiteatro, según la nomenclatura pública del estadio.
> - **No** están los sectores numerados (101, 205, 611…) ni el aforo de cada nivel: cambian con la reforma y con cada partido. Compruébalo en el plano oficial al comprar y, si quieres más detalle, añade secciones por sector con la plantilla *Sección*.
>
> Cuando revises un nivel contra el plano oficial, sube su `confidence` a `0.9` y pon la fecha en `verifiedAt`.

## Cómo lo usa el sistema

En **asistencia manual** las zonas y secciones sirven para decir a cada persona **dónde** intentar comprar y en qué orden: «añade 2 entradas de *Lateral Este · Primer anfiteatro*, máximo 120 € cada una». Si en la web ese nivel no está a la venta o supera el precio, la persona responde «No pude» y el sistema le da el siguiente objetivo de la lista.

Datos útiles de los planos públicos: los sectores de la serie 600 y 700 son del cuarto anfiteatro (fondos 611–634; laterales 601–610 y 701–710), y la afición visitante suele ir en el cuarto anfiteatro.

## Secciones

```base
filters:
  and:
    - 'note.type == "section"'
    - 'file.inFolder("10 Recintos/Estadio Santiago Bernabéu")'
views:
  - type: table
    name: Secciones
    order:
      - file.name
      - note.zone
      - note.level
      - note.kind
      - note.confidence
```
