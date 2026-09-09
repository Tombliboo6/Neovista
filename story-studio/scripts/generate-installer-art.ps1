$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$iconPath = Join-Path $projectRoot 'build\icon.ico'
$sidebarPath = Join-Path $projectRoot 'build\installerSidebar.bmp'

$bitmap = [System.Drawing.Bitmap]::new(164, 314)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

try {
  $rect = [System.Drawing.Rectangle]::new(0, 0, 164, 314)
  $gradient = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    $rect,
    [System.Drawing.Color]::FromArgb(18, 15, 28),
    [System.Drawing.Color]::FromArgb(83, 48, 132),
    90
  )
  try { $graphics.FillRectangle($gradient, $rect) } finally { $gradient.Dispose() }

  $accent = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(100, 170, 104, 255))
  try { $graphics.FillEllipse($accent, -70, 190, 260, 190) } finally { $accent.Dispose() }

  $icon = [System.Drawing.Icon]::new($iconPath, 64, 64)
  try { $graphics.DrawIcon($icon, 50, 42) } finally { $icon.Dispose() }

  $muted = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(220, 226, 220, 240))
  $titleFont = [System.Drawing.Font]::new('Segoe UI', 13, [System.Drawing.FontStyle]::Bold)
  $bodyFont = [System.Drawing.Font]::new('Microsoft YaHei UI', 9, [System.Drawing.FontStyle]::Regular)
  try {
    $graphics.DrawString('PRISM', $titleFont, [System.Drawing.Brushes]::White, 45, 122)
    $graphics.DrawString('STORY STUDIO', $bodyFont, $muted, 28, 153)
    $graphics.DrawString('选择位置后自动安装', $bodyFont, $muted, 23, 266)
  } finally {
    $bodyFont.Dispose()
    $titleFont.Dispose()
    $muted.Dispose()
  }

  $bitmap.Save($sidebarPath, [System.Drawing.Imaging.ImageFormat]::Bmp)
} finally {
  $graphics.Dispose()
  $bitmap.Dispose()
}

Write-Output "Generated $sidebarPath"
