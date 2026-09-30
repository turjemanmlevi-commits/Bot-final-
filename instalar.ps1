# Instala (o actualiza) y arranca la prueba local en Windows. Uso, en PowerShell:
#   irm https://raw.githubusercontent.com/turjemanmlevi-commits/Bot-final-/claude/nifty-galileo-srzpso/instalar.ps1 | iex
function Start-PruebaBot {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  $branch = 'claude/nifty-galileo-srzpso'
  $dest = Join-Path $HOME 'bot-entradas'
  Write-Host ''
  Write-Host '== Bot de entradas: preparando la prueba local ==' -ForegroundColor Cyan

  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    if (Get-Command winget -ErrorAction SilentlyContinue) {
      Write-Host '1/4 Instalando Node.js (solo la primera vez, puede pedir permiso)...'
      winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent
      $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    }
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
      Write-Host 'Falta Node.js. Se abre nodejs.org: instala la version LTS, cierra esta ventana y vuelve a pegar el comando.' -ForegroundColor Yellow
      Start-Process 'https://nodejs.org'
      return
    }
  }
  $major = [int]((node -v).TrimStart('v').Split('.')[0])
  if ($major -lt 20) {
    Write-Host "Tu Node.js es muy antiguo ($(node -v)). Instala la version LTS de https://nodejs.org y repite." -ForegroundColor Yellow
    Start-Process 'https://nodejs.org'
    return
  }

  Write-Host "2/4 Descargando la ultima version en $dest ..."
  $zip = Join-Path $env:TEMP 'bot-entradas.zip'
  $tmp = Join-Path $env:TEMP 'bot-entradas-src'
  Invoke-WebRequest "https://github.com/turjemanmlevi-commits/Bot-final-/archive/refs/heads/$branch.zip" -OutFile $zip -UseBasicParsing
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive $zip -DestinationPath $tmp -Force
  $src = Get-ChildItem $tmp -Directory | Select-Object -First 1
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  # Tu prueba\.env y la carpeta data (sesion guardada) no vienen en el zip: se conservan.
  Copy-Item -Path (Join-Path $src.FullName '*') -Destination $dest -Recurse -Force
  Set-Location $dest

  Write-Host '3/4 Instalando dependencias y el navegador del bot (la primera vez tarda unos minutos)...'
  & npm.cmd install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Write-Host 'Ha fallado npm install. Copia lo de arriba y pasamelo.' -ForegroundColor Red; return }
  & npx.cmd playwright install chromium
  if ($LASTEXITCODE -ne 0) { Write-Host 'Ha fallado la descarga del navegador. Copia lo de arriba y pasamelo.' -ForegroundColor Red; return }

  Write-Host '4/4 Arrancando. El panel se abre solo; NO cierres esta ventana mientras lo uses.' -ForegroundColor Green
  & npm.cmd run prueba
}
Start-PruebaBot
