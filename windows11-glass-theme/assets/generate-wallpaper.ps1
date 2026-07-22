#Requires -Version 5.1
<#
.SYNOPSIS
  Gera wallpaper.bmp a partir do SVG (via browser/Edge headless se disponível,
  ou cria um BMP procedural azul glass como fallback).
#>
[CmdletBinding()]
param(
  [string]$OutPath = $(Join-Path $env:LOCALAPPDATA 'GlassDock\wallpaper.bmp'),
  [int]$Width = 1920,
  [int]$Height = 1080
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Svg = Join-Path $Root 'assets\wallpaper.svg'

$dir = Split-Path $OutPath
if (-not (Test-Path $dir)) {
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
}

Add-Type -AssemblyName System.Drawing

function New-GlassBitmap([int]$W, [int]$H) {
  $bmp = New-Object System.Drawing.Bitmap $W, $H
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

  # Background gradient
  $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush `
    ([System.Drawing.Point]::new(0, 0)), ([System.Drawing.Point]::new($W, $H)), `
    ([System.Drawing.Color]::FromArgb(255, 184, 212, 240)), `
    ([System.Drawing.Color]::FromArgb(255, 155, 191, 232))
  $g.FillRectangle($bgBrush, 0, 0, $W, $H)
  $bgBrush.Dispose()

  # Soft blobs
  $blob = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(60, 126, 176, 232))
  $g.FillEllipse($blob, [int]($W * 0.05), [int]($H * 0.55), [int]($W * 0.4), [int]($H * 0.45))
  $blob2 = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(70, 232, 244, 252))
  $g.FillEllipse($blob2, [int]($W * 0.55), [int]($H * -0.05), [int]($W * 0.45), [int]($H * 0.5))
  $blob.Dispose(); $blob2.Dispose()

  # Ribbon strokes
  function Draw-Ribbon($g, $points, $width, $c1, $c2) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddCurve($points)
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(200, $c1)), $width
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $g.DrawPath($pen, $path)
    $pen.Dispose(); $path.Dispose()
  }

  $p1 = @(
    [System.Drawing.PointF]::new(-0.05 * $W, 0.65 * $H),
    [System.Drawing.PointF]::new(0.25 * $W, 0.35 * $H),
    [System.Drawing.PointF]::new(0.45 * $W, 0.7 * $H),
    [System.Drawing.PointF]::new(0.7 * $W, 0.4 * $H),
    [System.Drawing.PointF]::new(1.05 * $W, 0.28 * $H)
  )
  $p2 = @(
    [System.Drawing.PointF]::new(-0.02 * $W, 0.85 * $H),
    [System.Drawing.PointF]::new(0.3 * $W, 0.55 * $H),
    [System.Drawing.PointF]::new(0.55 * $W, 0.8 * $H),
    [System.Drawing.PointF]::new(0.85 * $W, 0.55 * $H),
    [System.Drawing.PointF]::new(1.1 * $W, 0.48 * $H)
  )
  $p3 = @(
    [System.Drawing.PointF]::new(0.05 * $W, 0.18 * $H),
    [System.Drawing.PointF]::new(0.3 * $W, 0.42 * $H),
    [System.Drawing.PointF]::new(0.5 * $W, 0.12 * $H),
    [System.Drawing.PointF]::new(0.75 * $W, 0.38 * $H),
    [System.Drawing.PointF]::new(1.0 * $W, 0.32 * $H)
  )

  Draw-Ribbon $g $p1 ([math]::Max(40, $W / 22)) ([System.Drawing.Color]::FromArgb(107, 163, 224)) ([System.Drawing.Color]::FromArgb(168, 207, 245))
  Draw-Ribbon $g $p2 ([math]::Max(30, $W / 28)) ([System.Drawing.Color]::FromArgb(74, 143, 212)) ([System.Drawing.Color]::FromArgb(126, 180, 232))
  Draw-Ribbon $g $p3 ([math]::Max(24, $W / 35)) ([System.Drawing.Color]::FromArgb(91, 155, 224)) ([System.Drawing.Color]::FromArgb(208, 230, 250))

  # Highlight
  $hi = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(90, 255, 255, 255)), ([math]::Max(6, $W / 120))
  $hi.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $hi.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawCurve($hi, $p1)
  $hi.Dispose()

  $g.Dispose()
  return $bmp
}

# Prefer copying SVG note + procedural BMP (works offline without Inkscape)
$bmp = New-GlassBitmap -W $Width -H $Height
$bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Bmp)
$bmp.Dispose()

# Also keep SVG reference beside output
Copy-Item -Path $Svg -Destination (Join-Path $dir 'wallpaper.svg') -Force -ErrorAction SilentlyContinue

Write-Host "Wallpaper gerado: $OutPath ($Width x $Height)"
