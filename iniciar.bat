@echo off
rem Arranca la prueba local en Windows: instala lo necesario y abre el panel.
cd /d "%~dp0"
where node >nul 2>nul || (echo Instala Node.js 20 o superior: https://nodejs.org & pause & exit /b 1)
if not exist node_modules call npm install
call npx playwright install chromium
if not exist prueba\.env copy prueba\.env.example prueba\.env >nul
call npm run prueba
pause
