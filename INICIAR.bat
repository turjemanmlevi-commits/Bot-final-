@echo off
setlocal
rem ==========================================================================
rem  Ticket Orchestrator - arranque en Windows (doble clic)
rem  1) Comprueba Node.js   2) Crea .env si falta   3) Instala dependencias
rem  4) Compila el dashboard   5) Arranca el servidor y abre el navegador
rem  Deja esta ventana abierta mientras uses el sistema. Para pararlo: cierrala.
rem ==========================================================================
chcp 65001 >nul
title Ticket Orchestrator
cd /d "%~dp0"

echo.
echo   Ticket Orchestrator - sala de control
echo   Carpeta: %CD%
echo.

where node >nul 2>nul
if errorlevel 1 (
  if exist "%ProgramFiles%\nodejs\node.exe" (
    set "PATH=%ProgramFiles%\nodejs;%PATH%"
  ) else (
    where winget >nul 2>nul
    if not errorlevel 1 (
      echo   Node.js no esta instalado: instalandolo con winget ^(acepta el aviso de Windows^)...
      winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-source-agreements --accept-package-agreements
      set "PATH=%ProgramFiles%\nodejs;%PATH%"
    )
  )
)
where node >nul 2>nul
if errorlevel 1 (
  echo   [X] No se encuentra Node.js.
  echo       Instala la version LTS desde https://nodejs.org ^(se abre ahora^),
  echo       reinicia el ordenador si te lo pide y vuelve a abrir INICIAR.bat.
  start "" "https://nodejs.org/"
  echo.
  pause
  exit /b 1
)

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>20||(a===20&&b>=19)?0:1)"
if errorlevel 1 (
  echo   [X] Tu Node.js es demasiado antiguo. Instala la version LTS desde https://nodejs.org
  start "" "https://nodejs.org/"
  echo.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do echo   [OK] Node.js %%v

if not exist ".env" (
  if exist ".env.example" (
    copy /y ".env.example" ".env" >nul
    echo   [OK] Creado el archivo .env ^(configuracion: Telegram, puerto...^)
  )
)

echo.
echo   Instalando o comprobando dependencias ^(la primera vez tarda unos minutos^)...
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 (
  echo.
  echo   Reintentando la instalacion...
  call npm install --no-audit --no-fund --loglevel=error
  if errorlevel 1 (
    echo.
    echo   [X] No se pudieron instalar las dependencias.
    echo       - Comprueba tu conexion a Internet.
    echo       - Si ves EPERM o EBUSY: pausa la sincronizacion de OneDrive un rato
    echo         ^(icono de la nube, Pausar sincronizacion^) y vuelve a abrir INICIAR.bat.
    echo.
    pause
    exit /b 1
  )
)
echo   [OK] Dependencias listas

echo.
echo   Compilando el dashboard...
call npm run build --silent
if errorlevel 1 (
  echo.
  echo   [X] No se pudo compilar el dashboard. Copia el error de arriba y pidelo revisar.
  echo.
  pause
  exit /b 1
)
echo   [OK] Dashboard compilado

set "TO_PORT=8787"
if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
    if /i "%%a"=="PORT" if not "%%b"=="" set "TO_PORT=%%b"
  )
)
set "TO_URL=http://localhost:%TO_PORT%"

rem Abre el navegador cuando el servidor responda (en una ventana oculta aparte).
start "" /min powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$u='%TO_URL%'; for($i=0;$i -lt 120;$i++){ $ok=$false; try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 ($u + '/api/health') | Out-Null; $ok=$true } catch { if ($_.Exception.Response) { $ok=$true } }; if($ok){ Start-Process $u; break }; Start-Sleep -Seconds 1 }"

rem Sin "Edicion rapida": un clic en esta ventana no debe pausar el servidor.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\consola-sin-seleccion.ps1" >nul 2>nul

echo.
echo   Arrancando el servidor en %TO_URL%
echo   El navegador se abrira solo en unos segundos.
echo   NO cierres esta ventana mientras uses el sistema. Para pararlo, cierrala.
echo   No hace falta hacer clic aqui: todo se maneja desde el navegador.
echo.
call npm start
echo.
echo   El servidor se ha detenido. Si ha sido por un error, lee el mensaje de arriba.
echo.
pause
endlocal
