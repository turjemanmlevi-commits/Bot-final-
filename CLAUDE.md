# Bot final · Ticket Orchestrator

Monorepo npm (Node 22, TypeScript estricto): `shared` (tipos zod), `server` (Hono + PGlite, la «sala de
control» en http://localhost:8787), `dashboard` (React + Vite) y `prueba` (bot de Playwright para la web
de entradas del Real Madrid, plataforma Onebox, con su réplica local `mock-site.ts`).

- Comprobar: `npm run typecheck`, `npm test -w @to/server`, `npm run prueba:smoke`, `npm run build`.
- Arrancar en Windows: `INICIAR.bat` (instala, compila y abre el dashboard).
- Analizar la web real del Real Madrid con Claude in Chrome: sigue `prueba/ANALISIS-WEB-REAL-MADRID.md`.

Reglas del proyecto: el bot **nunca paga** ni pulsa el botón de pago; CAPTCHA, verificación de Cloudflare,
cola y login los hace siempre una persona, y no se intenta ocultar la automatización. Las credenciales
solo se guardan en `data/credenciales.json` de este PC. Textos de la interfaz y mensajes en castellano.
