$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $projectRoot 'installer\ace\PrismAceInstaller.cs'
$outputDirectory = Join-Path $projectRoot 'installer\ace\bin'
$output = Join-Path $outputDirectory 'PRISM-ACE-Step-1.5-Setup.exe'
$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$icon = Join-Path $projectRoot 'build\icon.ico'
$sevenZip = 'C:\Users\pr\AppData\Local\electron-builder\Cache\7zip@1.0.0\7zip-win-x64-a34pt\bin\7za.exe'

foreach ($required in @($source, $compiler, $icon, $sevenZip)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    throw "ACE installer build dependency is missing: $required"
  }
}

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
& $compiler /nologo /target:winexe /platform:x64 /optimize+ "/win32icon:$icon" `
  /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll `
  "/out:$output" $source
if ($LASTEXITCODE -ne 0) { throw "ACE installer compiler failed with exit code $LASTEXITCODE" }
Copy-Item -LiteralPath $sevenZip -Destination (Join-Path $outputDirectory '7za.exe') -Force

Write-Output "ACE installer built: $output"
