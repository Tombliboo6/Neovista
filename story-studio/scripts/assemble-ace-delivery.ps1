param(
  [string]$SourceRoot = 'E:\AI\ACE-Step-1.5',
  [string]$PythonHome = 'D:\AI\SD-Test\StabilityMatrix\Data\Assets\Python\cpython-3.12.10-windows-x86_64-none',
  [switch]$KeepStaging,
  [switch]$ResumeFromHash
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseRoot = Join-Path $projectRoot 'release'
$deliveryRoot = Join-Path $releaseRoot 'PRISM-ACE-Step-1.5-Offline-Package'
$stagingRoot = Join-Path $releaseRoot '.ace-step-1.5-payload-stage'
$payloadRoot = Join-Path $deliveryRoot 'payload'
$installerBin = Join-Path $projectRoot 'installer\ace\bin'
$sevenZip = Join-Path $installerBin '7za.exe'
$archiveBase = Join-Path $payloadRoot 'ace-step-1.5.7z'

function Assert-GeneratedPath([string]$Path) {
  $resolvedRelease = [System.IO.Path]::GetFullPath($releaseRoot).TrimEnd('\') + '\'
  $resolvedTarget = [System.IO.Path]::GetFullPath($Path)
  if (-not $resolvedTarget.StartsWith($resolvedRelease, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify a path outside the release directory: $resolvedTarget"
  }
}

function Get-Sha256([string]$Path) {
  $stream = [System.IO.File]::OpenRead($Path)
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    return ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '').ToUpperInvariant()
  } finally {
    $sha256.Dispose()
    $stream.Dispose()
  }
}

foreach ($required in @($SourceRoot, $PythonHome)) {
  if (-not (Test-Path -LiteralPath $required -PathType Container)) { throw "Required source directory is missing: $required" }
}
foreach ($required in @(
  (Join-Path $installerBin 'PRISM-ACE-Step-1.5-Setup.exe'),
  $sevenZip,
  (Join-Path $projectRoot 'docs\ACE_STEP_INSTALL_README.md'),
  (Join-Path $projectRoot 'docs\ACE_STEP_THIRD_PARTY_NOTICES.md')
)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required delivery file is missing: $required" }
}

Assert-GeneratedPath $deliveryRoot
Assert-GeneratedPath $stagingRoot
if (-not $ResumeFromHash) {
  if (Test-Path -LiteralPath $deliveryRoot) { Remove-Item -LiteralPath $deliveryRoot -Recurse -Force }
  if (Test-Path -LiteralPath $stagingRoot) { Remove-Item -LiteralPath $stagingRoot -Recurse -Force }
  New-Item -ItemType Directory -Path $payloadRoot -Force | Out-Null
  New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null

  Write-Output 'Staging ACE-Step runtime and checkpoints...'
  & robocopy $SourceRoot $stagingRoot /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NP `
    /XD '.git' '.cache' 'test-results' 'gradio_outputs' '__pycache__' `
    /XF '*.pyc' '*.pyo'
  if ($LASTEXITCODE -gt 7) { throw "ACE-Step staging copy failed with robocopy exit code $LASTEXITCODE" }

  $portablePython = Join-Path $stagingRoot 'runtime\python'
  New-Item -ItemType Directory -Path $portablePython -Force | Out-Null
  Write-Output 'Staging portable CPython runtime...'
  & robocopy $PythonHome $portablePython /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NP
  if ($LASTEXITCODE -gt 7) { throw "Python runtime staging copy failed with robocopy exit code $LASTEXITCODE" }

  $unpacked = (Get-ChildItem -LiteralPath $stagingRoot -Recurse -File -Force | Measure-Object Length -Sum).Sum
  Write-Output ('Creating split archive from {0:N2} GiB...' -f ($unpacked / 1GB))
  Push-Location $stagingRoot
  try {
    & $sevenZip a -t7z -mx=1 -mmt=on -v1900m $archiveBase '.\*'
    if ($LASTEXITCODE -ne 0) { throw "7-Zip archive creation failed with exit code $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
} else {
  if (-not (Test-Path -LiteralPath $payloadRoot -PathType Container)) { throw "Cannot resume because payload is missing: $payloadRoot" }
  if (Test-Path -LiteralPath $stagingRoot -PathType Container) {
    $unpacked = (Get-ChildItem -LiteralPath $stagingRoot -Recurse -File -Force | Measure-Object Length -Sum).Sum
  } else {
    $existingManifest = Join-Path $payloadRoot 'payload.manifest'
    if (-not (Test-Path -LiteralPath $existingManifest -PathType Leaf)) { throw "Cannot resume because both staging and payload manifest are missing." }
    $unpackedLine = Get-Content -LiteralPath $existingManifest | Where-Object { $_.StartsWith('UNPACKED_BYTES=') } | Select-Object -First 1
    if (-not $unpackedLine) { throw 'Existing payload manifest does not contain UNPACKED_BYTES.' }
    $unpacked = [long]$unpackedLine.Substring('UNPACKED_BYTES='.Length)
  }
  Write-Output 'Resuming from payload hashing...'
}

$parts = @(Get-ChildItem -LiteralPath $payloadRoot -File -Filter 'ace-step-1.5.7z.*' | Sort-Object Name)
if ($parts.Count -eq 0) { throw 'No ACE-Step archive parts were created.' }
$manifestLines = @(
  '# PRISM ACE-Step offline payload manifest v1',
  'PRODUCT=PRISM ACE-Step 1.5',
  'VERSION=1.5',
  "UNPACKED_BYTES=$unpacked"
)
foreach ($part in $parts) {
  Write-Output "Hashing $($part.Name)..."
  $hash = Get-Sha256 $part.FullName
  $manifestLines += "PART|$($part.Name)|$($part.Length)|$hash"
}
[System.IO.File]::WriteAllLines((Join-Path $payloadRoot 'payload.manifest'), $manifestLines, [System.Text.UTF8Encoding]::new($false))

Copy-Item -LiteralPath (Join-Path $installerBin 'PRISM-ACE-Step-1.5-Setup.exe') -Destination $deliveryRoot
Copy-Item -LiteralPath $sevenZip -Destination $deliveryRoot
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\ACE_STEP_INSTALL_README.md') -Destination (Join-Path $deliveryRoot 'README.md')
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\ACE_STEP_THIRD_PARTY_NOTICES.md') -Destination (Join-Path $deliveryRoot 'THIRD_PARTY_NOTICES.md')
Copy-Item -LiteralPath (Join-Path $SourceRoot 'LICENSE') -Destination (Join-Path $deliveryRoot 'ACE-STEP-LICENSE.txt')

$deliveryFiles = @(Get-ChildItem -LiteralPath $deliveryRoot -Recurse -File | Sort-Object FullName)
$checksums = foreach ($file in $deliveryFiles) {
  if ($file.Name -eq 'SHA256SUMS.txt') { continue }
  $relative = $file.FullName.Substring($deliveryRoot.Length + 1).Replace('\', '/')
  $hash = Get-Sha256 $file.FullName
  "$hash  $relative"
}
[System.IO.File]::WriteAllLines((Join-Path $deliveryRoot 'SHA256SUMS.txt'), $checksums, [System.Text.UTF8Encoding]::new($false))

if (-not $KeepStaging) {
  Assert-GeneratedPath $stagingRoot
  if (Test-Path -LiteralPath $stagingRoot) { Remove-Item -LiteralPath $stagingRoot -Recurse -Force }
}

Write-Output "ACE-Step offline delivery assembled: $deliveryRoot"
