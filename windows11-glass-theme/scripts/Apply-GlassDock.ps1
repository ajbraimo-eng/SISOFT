#Requires -Version 5.1
<#
.SYNOPSIS
  Aplica o tema Glass Dock no Windows 11.
.NOTES
  Execute como Administrador. Crie um ponto de restauro antes.
#>
[CmdletBinding()]
param(
  [switch]$SkipRegistry,
  [switch]$SkipWallpaper,
  [switch]$InstallRainmeterSkin
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ThemeDir = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Themes\GlassDock'
$WallpaperDest = Join-Path $env:LOCALAPPDATA 'GlassDock\wallpaper.bmp'

Write-Host ''
Write-Host '========================================' -ForegroundColor Cyan
Write-Host '  Glass Dock — Windows 11 Theme Pack' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan
Write-Host "Origem: $Root"
Write-Host ''

function Assert-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Warning 'Algumas alterações (registo) pedem Admin. Continue; parts podem falhar.'
  }
}

function Ensure-Dir([string]$Path) {
  if (-not (Test-Path $Path)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }
}

function Convert-SvgHint {
  Write-Host '[Wallpaper] SVG em assets/wallpaper.svg' -ForegroundColor Yellow
  Write-Host '  Abra no browser, exporte PNG 3840x2160, ou use generate-wallpaper.ps1' -ForegroundColor DarkGray
}

function Set-WallpaperBmp {
  param([string]$BmpPath)
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Wallpaper {
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);
}
"@
  $SPI_SETDESKWALLPAPER = 0x0014
  $UPDATE_INI_FILE = 0x01
  $SENDWININICHANGE = 0x02
  [Wallpaper]::SystemParametersInfo($SPI_SETDESKWALLPAPER, 0, $BmpPath, $UPDATE_INI_FILE -bor $SENDWININICHANGE) | Out-Null
}

Assert-Admin
Ensure-Dir $ThemeDir
Ensure-Dir (Split-Path $WallpaperDest)

# --- Copy theme pack ---
Write-Host '[1/5] A copiar ficheiros do tema...' -ForegroundColor Green
Copy-Item -Path (Join-Path $Root '*') -Destination $ThemeDir -Recurse -Force
Write-Host "      → $ThemeDir"

# --- Wallpaper ---
if (-not $SkipWallpaper) {
  Write-Host '[2/5] Wallpaper...' -ForegroundColor Green
  $bundled = Join-Path $Root 'assets\wallpaper.bmp'
  $gen = Join-Path $Root 'assets\generate-wallpaper.ps1'
  if (Test-Path $bundled) {
    Copy-Item -Path $bundled -Destination $WallpaperDest -Force
  }
  elseif (Test-Path $gen) {
    & $gen -OutPath $WallpaperDest
  }
  if (Test-Path $WallpaperDest) {
    Set-WallpaperBmp -BmpPath $WallpaperDest
    Write-Host "      Wallpaper aplicado: $WallpaperDest"
  }
  else {
    Convert-SvgHint
    Write-Host '      Coloque um BMP/PNG em:' $WallpaperDest -ForegroundColor Yellow
  }
}
else {
  Write-Host '[2/5] Wallpaper ignorado (-SkipWallpaper)' -ForegroundColor DarkGray
}

# --- Registry ---
if (-not $SkipRegistry) {
  Write-Host '[3/5] Tweaks de registo (transparência, taskbar centrada)...' -ForegroundColor Green
  $reg = Join-Path $Root 'configs\registry-tweaks.reg'
  if (Test-Path $reg) {
    reg import $reg | Out-Null
    Write-Host '      Registo importado.'
  }
}
else {
  Write-Host '[3/5] Registo ignorado (-SkipRegistry)' -ForegroundColor DarkGray
}

# --- Apply .theme ---
Write-Host '[4/5] A abrir GlassDock.theme...' -ForegroundColor Green
$themeFile = Join-Path $ThemeDir 'GlassDock.theme'
if (Test-Path $themeFile) {
  Start-Process $themeFile
  Write-Host '      Confirme em Definições → Personalização se necessário.'
}

# --- Rainmeter ---
Write-Host '[5/5] Rainmeter / configs auxiliares...' -ForegroundColor Green
$docs = [Environment]::GetFolderPath('MyDocuments')
$rmSkins = Join-Path $docs 'Rainmeter\Skins\GlassDockSearch'
if ($InstallRainmeterSkin -or (Test-Path (Join-Path $docs 'Rainmeter\Skins'))) {
  Ensure-Dir $rmSkins
  Copy-Item -Path (Join-Path $Root 'rainmeter\GlassDockSearch\*') -Destination $rmSkins -Recurse -Force
  Write-Host "      Skin Rainmeter: $rmSkins"
  Write-Host '      No Rainmeter: Skins → GlassDockSearch → Search.ini'
}
else {
  Write-Host '      Rainmeter não detetado. Instale e volte a correr com -InstallRainmeterSkin' -ForegroundColor Yellow
}

# --- Summary ---
Write-Host ''
Write-Host 'Próximos passos manuais:' -ForegroundColor Cyan
Write-Host '  1. RoundedTB  → configs/RoundedTB.json (radius 18, margins 12, Dynamic ON)'
Write-Host '  2. TranslucentTB → Taskbar Clear / Acrylic claro'
Write-Host '  3. MicaForEveryone → configs/MicaForEveryone.conf'
Write-Host '  4. Pack de ícones Fluent/Colorful (opcional)'
Write-Host '  5. Abra preview/index.html para referência visual'
Write-Host ''
Write-Host 'Concluído.' -ForegroundColor Green
