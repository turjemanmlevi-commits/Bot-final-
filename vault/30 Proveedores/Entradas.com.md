---
type: provider
id: entradas-com
name: entradas.com
mode: MANUAL_ASSIST
authorizedCapabilities: []
url: https://www.entradas.com
source: "Web oficial de entradas.com (grupo CTS Eventim). No hay API de compra autorizada: asistencia manual."
verifiedAt: 2026-09-28
tags:
  - proveedor
  - real
---

# entradas.com

> [!important] Asistencia manual
> El sistema **no se conecta** a entradas.com. Cada persona compra en la web o la app oficial con su propia cuenta; el sistema coordina al grupo.

## Qué hace y qué no hace el sistema con este proveedor

| El sistema **sí** | El sistema **no** (nunca) |
|---|---|
| Reparte quién compra qué zona, cuántas entradas y a qué precio máximo | Entrar en la web, iniciar sesión o leer el inventario |
| Envía cada tarea al dashboard y a Telegram con el enlace oficial | Añadir al carrito, pagar o rellenar formularios |
| Lleva la cuenta de límites, presupuesto y caducidad de cada carrito | Resolver CAPTCHA, SMS o verificaciones |
| Te avisa si un carrito está a punto de caducar | Saltarse colas o límites de compra |

Todas las acciones en la web las hace **una persona, con su propia cuenta**. `authorizedCapabilities: []` significa exactamente eso: nada automatizado. Ver [[Uso legítimo y guardarraíles]].

## Cómo preparar una compra en entradas.com

1. **Evento** — Dashboard → *Eventos* → **Nuevo evento**. Proveedor *entradas.com*, pega el enlace oficial del evento (`https://www.entradas.com/event/...`) y la apertura de la venta. entradas.com (CTS Eventim) **no tiene una API pública oficial**: sus eventos se traen con el marcador **📥 Enviar a la sala** desde la página del evento (nombre, fecha, recinto, precios y el límite si la página lo enseña). Con **Vigilar desde** tendrás los recordatorios por Telegram (ver [[Buscar eventos oficiales y vigilar la venta]]).
2. **Límites** — Cópialos de la ficha del evento («máximo X entradas por pedido / por cliente») y anota de dónde salen. Si la venta no lo dice claro, deja los límites sin verificar: el sistema no te dejará armar hasta que lo confirmes (fail-closed).
3. **Cuentas** — *Cuentas* → **Nueva cuenta**, proveedor *entradas.com*, una por persona del grupo.
4. **Operación** — sigue [[Comprar entradas reales (paso a paso)]].

## Reglas de la casa

- Respeta las condiciones de compra de cada evento: límites por pedido o por cliente, preventas con código y entradas nominativas.
- Colas y verificaciones: las pasa cada persona. El sistema espera.
