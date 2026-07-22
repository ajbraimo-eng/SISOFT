@echo off
:: Glass Dock — atalho de instalação (Windows 11)
cd /d "%~dp0"
echo.
echo  Glass Dock Theme Pack
echo  ----------------------
echo  Vai pedir confirmacao do PowerShell / UAC.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Apply-GlassDock.ps1" -InstallRainmeterSkin
echo.
pause
