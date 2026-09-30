#!/usr/bin/env bash
# Instala (o actualiza) y arranca la prueba local en Mac/Linux. Uso, en Terminal:
#   curl -fsSL https://raw.githubusercontent.com/turjemanmlevi-commits/Bot-final-/claude/nifty-galileo-srzpso/instalar.sh | bash
set -e
BRANCH="claude/nifty-galileo-srzpso"
DEST="${BOT_DIR:-$HOME/bot-entradas}"
echo ""
echo "== Bot de entradas: preparando la prueba local =="

if ! command -v node >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    echo "1/4 Instalando Node.js (solo la primera vez)..."
    brew install node
  else
    echo "Falta Node.js: instálalo desde https://nodejs.org (versión LTS) y vuelve a pegar el comando."
    (open https://nodejs.org || xdg-open https://nodejs.org) >/dev/null 2>&1 || true
    exit 1
  fi
fi
if [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "Tu Node.js ($(node -v)) es muy antiguo: instala la versión LTS de https://nodejs.org y repite."
  exit 1
fi

echo "2/4 Descargando la última versión en $DEST ..."
TMP="$(mktemp -d)"
curl -fsSL "https://github.com/turjemanmlevi-commits/Bot-final-/archive/refs/heads/$BRANCH.zip" -o "$TMP/bot.zip"
unzip -q "$TMP/bot.zip" -d "$TMP"
mkdir -p "$DEST"
# Tu prueba/.env y la carpeta data (sesión guardada) no vienen en el zip: se conservan.
cp -R "$TMP"/Bot-final--*/. "$DEST"/
rm -rf "$TMP"
cd "$DEST"

echo "3/4 Instalando dependencias y el navegador del bot (la primera vez tarda unos minutos)..."
npm install --no-audit --no-fund
npx playwright install chromium

echo "4/4 Arrancando. El panel se abre solo; NO cierres esta ventana mientras lo uses."
exec npm run prueba
