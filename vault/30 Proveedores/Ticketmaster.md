---
type: provider
id: ticketmaster
name: Ticketmaster
mode: MANUAL_ASSIST
authorizedCapabilities: []
url: https://www.ticketmaster.es
source: "Web oficial de Ticketmaster España. No hay API de compra autorizada: asistencia manual."
verifiedAt: 2026-09-28
tags:
  - proveedor
  - real
---

# Ticketmaster

> [!important] Asistencia manual
> El sistema **no se conecta** a Ticketmaster. Cada persona compra en la web o la app oficial con su propia cuenta; el sistema coordina al grupo.

## Qué hace y qué no hace el sistema con este proveedor

| El sistema **sí** | El sistema **no** (nunca) |
|---|---|
| Reparte quién compra qué zona, cuántas entradas y a qué precio máximo | Entrar en la web, iniciar sesión o leer el inventario |
| Envía cada tarea al dashboard y a Telegram con el enlace oficial | Añadir al carrito, pagar o rellenar formularios |
| Lleva la cuenta de límites, presupuesto y caducidad de cada carrito | Resolver CAPTCHA, SMS o verificaciones |
| Te avisa si un carrito está a punto de caducar | Saltarse colas o límites de compra |

Todas las acciones en la web las hace **una persona, con su propia cuenta**. `authorizedCapabilities: []` significa exactamente eso: nada automatizado. Ver [[Uso legítimo y guardarraíles]].

## Cómo preparar una compra en Ticketmaster

1. **Evento** — Dashboard → *Eventos* → **Nuevo evento** → *Dónde se vende*: **Ticketmaster**. Abre el evento en ticketmaster.es y pulsa el marcador **📥 Enviar a la sala** (sin claves), o elígelo de la **lista de toda España** (con la clave gratuita de la Discovery API, en Ajustes · Fuentes de eventos). Se rellenan el recinto, el enlace oficial, la fecha, la apertura de la venta o de la preventa y el límite (ver [[Buscar eventos oficiales y vigilar la venta]]).
2. **Límites** — Si la API publica el límite («Hay un límite de 6 entradas por cliente») se pone solo. Si no, cópialos de la página del evento o de sus condiciones («máximo X entradas por cliente / por pedido»). Ticketmaster suele contar el límite **por cliente**: con varias cuentas del mismo titular o la misma tarjeta el cupo es uno solo → semántica *por titular* (`PER_HOLDER`) o *por medio de pago* (`PER_PAYMENT_METHOD`).
3. **Cuentas** — *Cuentas* → **Nueva cuenta**, proveedor *Ticketmaster*, una por persona del grupo.
4. **Operación** — sigue [[Comprar entradas reales (paso a paso)]].

## Reglas de la casa

- Las condiciones de Ticketmaster prohíben comprar con programas automatizados y superar los límites de compra; pueden cancelar los pedidos que los incumplan.
- Colas virtuales y verificaciones: las pasa cada persona en su navegador. El sistema espera.
- Las entradas nominativas son de quien figura en ellas: compra solo para personas del grupo.
