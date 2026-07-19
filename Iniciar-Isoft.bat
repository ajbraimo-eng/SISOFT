@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale em https://nodejs.org
  pause
  exit /b 1
)

echo A iniciar Isoft...
start "Isoft" /min cmd /c "node launcher.js"
exit /b 0
