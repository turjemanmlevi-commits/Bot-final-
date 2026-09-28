---
type: provider
id: 
name: "{{title}}"
mode: MANUAL_ASSIST
authorizedCapabilities: []
source: ""
verifiedAt: {{date}}
tags:
  - proveedor
---

# {{title}}

<!--
mode: SIMULATED, MANUAL_ASSIST o AUTHORIZED_API.
authorizedCapabilities: solo lo que el proveedor autoriza POR ESCRITO para automatizar
(session.open, session.status, queue.status, inventory.read, cart.add, cart.read, clock.server_time).
Nunca: checkout.pay, challenge.solve, queue.bypass, limit.override, identity.spoof (el compilador las rechaza).
-->

## Autorización

Enlace o referencia al acuerdo / API oficial que autoriza cada capability.
