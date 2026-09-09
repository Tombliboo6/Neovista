param(
  [string]$PackageRoot = 'E:\ChatGPT\PRISM-AutoDrama\release\PRISM-ACE-Step-1.5-Offline-Package'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseRoot = Join-Path $projectRoot 'release'
$target = Join-Path $releaseRoot '.ace-step-installer-acceptance'
$evidencePath = Join-Path $releaseRoot 'ace-step-installer-acceptance.json'
$installer = Join-Path $PackageRoot 'PRISM-ACE-Step-1.5-Setup.exe'
$discovery = Join-Path $env:LOCALAPPDATA 'PRISM\ACE-Step\installation.json'
$discoveryBackup = $null
$discoveryExisted = Test-Path -LiteralPath $discovery -PathType Leaf
$success = $false
$started = Get-Date

$resolvedRelease = [System.IO.Path]::GetFullPath($releaseRoot).TrimEnd('\') + '\'
$resolvedTarget = [System.IO.Path]::GetFullPath($target)
if (-not $resolvedTarget.StartsWith($resolvedRelease, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Unsafe acceptance target: $resolvedTarget"
}
if (Test-Path -LiteralPath $target) { throw "Acceptance target already exists: $target" }
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw "Installer is missing: $installer" }
if ($discoveryExisted) { $discoveryBackup = [System.IO.File]::ReadAllBytes($discovery) }

try {
  $process = Start-Process -FilePath $installer -ArgumentList @('--acceptance', "--install-dir=$target") -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Installer acceptance failed with exit code $($process.ExitCode)" }

  $required = @(
    @{ Path = '.venv\Scripts\python.exe'; Minimum = 1 },
    @{ Path = 'checkpoints\acestep-v15-turbo\model.safetensors'; Minimum = 1000000000 },
    @{ Path = 'checkpoints\acestep-5Hz-lm-0.6B\model.safetensors'; Minimum = 500000000 },
    @{ Path = 'checkpoints\Qwen3-Embedding-0.6B\model.safetensors'; Minimum = 500000000 },
    @{ Path = 'checkpoints\vae\diffusion_pytorch_model.safetensors'; Minimum = 100000000 }
  )
  foreach ($item in $required) {
    $file = Get-Item -LiteralPath (Join-Path $target $item.Path)
    if ($file.Length -lt $item.Minimum) { throw "Installed file is too small: $($item.Path)" }
  }

  $expectedHome = Join-Path $target 'runtime\python'
  $venvConfig = Get-Content -LiteralPath (Join-Path $target '.venv\pyvenv.cfg') -Raw
  if (-not $venvConfig.Contains("home = $expectedHome")) { throw 'Portable Python home was not rewritten.' }

  Push-Location $target
  try {
    $pythonOutput = & '.\.venv\Scripts\python.exe' -c 'import sys,acestep,torch; print(sys.executable); print(acestep.__file__); print(torch.__version__); print(torch.version.cuda)'
    if ($LASTEXITCODE -ne 0) { throw "Installed Python probe failed with exit code $LASTEXITCODE" }
  } finally {
    Pop-Location
  }

  $discoveryValue = Get-Content -LiteralPath $discovery -Raw | ConvertFrom-Json
  if ($discoveryValue.installDirectory -ne $target) { throw 'Studio discovery manifest points to the wrong directory.' }

  $elapsed = (Get-Date) - $started
  $evidence = [ordered]@{
    product = 'PRISM ACE-Step 1.5'
    status = 'passed'
    testedAt = (Get-Date).ToUniversalTime().ToString('o')
    installerExitCode = $process.ExitCode
    installDirectory = $target
    elapsedSeconds = [math]::Round($elapsed.TotalSeconds, 3)
    pythonProbe = @($pythonOutput)
    portablePythonHome = $expectedHome
    discoveryVerified = $true
    requiredFilesVerified = $required.Count
    cleanup = 'completed after evidence capture'
  }
  [System.IO.File]::WriteAllText($evidencePath, ($evidence | ConvertTo-Json -Depth 5), [System.Text.UTF8Encoding]::new($false))
  $success = $true
} finally {
  if ($discoveryExisted) {
    [System.IO.File]::WriteAllBytes($discovery, $discoveryBackup)
  } elseif (Test-Path -LiteralPath $discovery) {
    Remove-Item -LiteralPath $discovery -Force
  }
  if ($success -and (Test-Path -LiteralPath $target)) {
    Remove-Item -LiteralPath $target -Recurse -Force
  }
}

Write-Output "ACE-Step installer acceptance passed: $evidencePath"
