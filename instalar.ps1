# ==========================================================================
#  Ticket Orchestrator - instalador para Windows
#  Uso (en PowerShell, una sola linea):
#    irm https://raw.githubusercontent.com/turjemanmlevi-commits/Bot-final-/claude/confident-bell-yb79l7/instalar.ps1 | iex
#
#  1) Instala Node.js LTS si falta (winget).
#  2) Descarga el proyecto en "Escritorio\bot final" SIN borrar nada tuyo:
#     conserva .env (tu configuracion) y data\ (cuentas, operaciones...).
#  3) Crea el acceso directo "Sala de control" en el Escritorio.
#  4) Opcional: instala Obsidian.
#  5) Arranca el sistema (INICIAR.bat) y abre http://localhost:8787
# ==========================================================================
$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

$Repo = 'turjemanmlevi-commits/Bot-final-'
$Branch = 'claude/confident-bell-yb79l7'
$ZipUrl = "https://github.com/$Repo/archive/refs/heads/$Branch.zip"
$Desktop = [Environment]::GetFolderPath('Desktop')
$Dest = Join-Path $Desktop 'bot final'

function Say($text) { Write-Host "  $text" }
function Ok($text) { Write-Host "  [OK] $text" -ForegroundColor Green }

Write-Host ''
Write-Host '  Ticket Orchestrator - instalacion' -ForegroundColor Cyan
Write-Host "  Carpeta: $Dest"
Write-Host ''

# 1) Node.js -----------------------------------------------------------------
$NodeDir = Join-Path $env:ProgramFiles 'nodejs'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  if (Test-Path (Join-Path $NodeDir 'node.exe')) {
    $env:Path = "$NodeDir;$env:Path"
  } elseif (Get-Command winget -ErrorAction SilentlyContinue) {
    Say 'Instalando Node.js LTS (acepta el aviso de Windows si aparece)...'
    winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-source-agreements --accept-package-agreements
    $env:Path = "$NodeDir;$env:Path"
  } else {
    Start-Process 'https://nodejs.org/'
    throw 'Falta Node.js y este Windows no tiene winget. Instala la version LTS desde nodejs.org (se ha abierto) y vuelve a ejecutar este comando.'
  }
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js no aparece todavia. Cierra esta ventana, abre otra de PowerShell y vuelve a ejecutar el comando.'
}
Ok ("Node.js " + (& node -v))

# 2) Descargar y copiar el proyecto -----------------------------------------------
$Tmp = Join-Path ([IO.Path]::GetTempPath()) ('to-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Tmp | Out-Null
try {
  Say 'Descargando el proyecto...'
  $ZipFile = Join-Path $Tmp 'proyecto.zip'
  Invoke-WebRequest -UseBasicParsing -Uri $ZipUrl -OutFile $ZipFile
  Expand-Archive -Path $ZipFile -DestinationPath $Tmp -Force
  $Src = Get-ChildItem -Path $Tmp -Directory | Where-Object { $_.Name -like 'Bot-final-*' } | Select-Object -First 1
  if (-not $Src) { throw 'El archivo descargado no tiene el formato esperado.' }
  New-Item -ItemType Directory -Force -Path $Dest | Out-Null
  # Copia sin borrar nada de la carpeta; nunca pisa .env ni data\.
  # /XO: no pisa archivos que hayas modificado despues (tus notas del vault).
  # Si ya tienes Obsidian configurado en el vault, se respeta tu configuracion.
  $ExcludeDirs = @('data', 'node_modules')
  if (Test-Path (Join-Path $Dest 'vault\.obsidian')) { $ExcludeDirs += (Join-Path $Dest 'vault\.obsidian'); $ExcludeDirs += (Join-Path $Src.FullName 'vault\.obsidian') }
  & robocopy $Src.FullName $Dest /E /XO /NFL /NDL /NJH /NJS /NP /XF .env /XD @ExcludeDirs | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "No se pudieron copiar los archivos (robocopy $LASTEXITCODE). Si OneDrive esta sincronizando, pausalo y repite." }
  $global:LASTEXITCODE = 0
  Ok 'Proyecto copiado'
} finally {
  Remove-Item -Recurse -Force -Path $Tmp -ErrorAction SilentlyContinue
}

# 3) Acceso directo en el Escritorio ---------------------------------------------
try {
  $Shell = New-Object -ComObject WScript.Shell
  $Lnk = $Shell.CreateShortcut((Join-Path $Desktop 'Sala de control.lnk'))
  $Lnk.TargetPath = Join-Path $Dest 'INICIAR.bat'
  $Lnk.WorkingDirectory = $Dest
  $Lnk.Description = 'Arranca el Ticket Orchestrator y abre el dashboard'
  $Lnk.Save()
  Ok 'Acceso directo "Sala de control" en el Escritorio'
} catch {
  Say 'No se pudo crear el acceso directo (no pasa nada: usa INICIAR.bat).'
}

# 4) Obsidian (opcional) ---------------------------------------------------------
$HasObsidian = (Test-Path (Join-Path $env:LOCALAPPDATA 'Programs\Obsidian\Obsidian.exe'))
if (-not $HasObsidian -and (Get-Command winget -ErrorAction SilentlyContinue)) {
  $Answer = Read-Host '  Instalar tambien Obsidian para ver el vault? (s/n)'
  if ($Answer -match '^[sSyY]') {
    winget install --id Obsidian.Obsidian -e --source winget --accept-source-agreements --accept-package-agreements
  }
}

# 5) Arrancar -------------------------------------------------------------------------
Write-Host ''
Ok 'Listo. Arrancando el sistema (la primera vez tarda unos minutos)...'
Say 'Se abrira http://localhost:8787 en el navegador. No cierres la ventana negra.'
Say 'Para abrir el vault en Obsidian: "Abrir carpeta como vault" -> bot final\vault'
Start-Process -FilePath (Join-Path $Dest 'INICIAR.bat') -WorkingDirectory $Dest
