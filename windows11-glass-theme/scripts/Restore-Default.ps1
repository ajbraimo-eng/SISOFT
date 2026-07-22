#Requires -Version 5.1
<#
.SYNOPSIS
  Reverte tweaks Glass Dock (tema/transparência/taskbar).
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'

Write-Host 'A restaurar predefinições Windows 11...' -ForegroundColor Cyan

$restoreReg = @'
Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize]
"EnableTransparency"=dword:00000001
"AppsUseLightTheme"=dword:00000001
"SystemUsesLightTheme"=dword:00000001

[HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced]
"TaskbarAl"=dword:00000001
"ShowTaskViewButton"=dword:00000001

[HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Search]
"SearchboxTaskbarMode"=dword:00000001
'@

$tmp = Join-Path $env:TEMP 'GlassDock-restore.reg'
Set-Content -Path $tmp -Value $restoreReg -Encoding ASCII
reg import $tmp | Out-Null
Remove-Item $tmp -Force -ErrorAction SilentlyContinue

# Reabrir tema padrão Windows
$defaultTheme = Join-Path $env:SystemRoot 'Resources\Themes\aero.theme'
if (Test-Path $defaultTheme) {
  Start-Process $defaultTheme
}

Write-Host 'Desative manualmente: RoundedTB, TranslucentTB, MicaForEveryone, Rainmeter (GlassDockSearch).' -ForegroundColor Yellow
Write-Host 'Restauro parcial concluído.' -ForegroundColor Green
