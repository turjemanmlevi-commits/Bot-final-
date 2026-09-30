#!/usr/bin/env bash
# Arranca la prueba local en Mac/Linux: instala lo necesario y abre el panel.
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Instala Node.js 20 o superior: https://nodejs.org"; exit 1; }
[ -d node_modules ] || npm install
npx playwright install chromium
[ -f prueba/.env ] || cp prueba/.env.example prueba/.env
( sleep 3; (open http://127.0.0.1:3000 || xdg-open http://127.0.0.1:3000) >/dev/null 2>&1 ) &
npm run prueba
