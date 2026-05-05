param(
  [string] $PythonLauncher = "py -3.11"
)

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$nativeRoot = Join-Path $scriptRoot "native"
$venvPath = Join-Path $nativeRoot ".venv"
$pythonPath = Join-Path $venvPath "Scripts\python.exe"
$sourceRoot = Join-Path $nativeRoot "searxng-master"
$zipPath = Join-Path $nativeRoot "searxng.zip"

New-Item -ItemType Directory -Force -Path $nativeRoot | Out-Null

if (-not (Test-Path $pythonPath)) {
  Invoke-Expression "$PythonLauncher -m venv `"$venvPath`""
}

if (-not (Test-Path $sourceRoot)) {
  if (Test-Path $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
  }
  Invoke-WebRequest -Uri "https://github.com/searxng/searxng/archive/refs/heads/master.zip" -OutFile $zipPath
  Expand-Archive -LiteralPath $zipPath -DestinationPath $nativeRoot -Force
}

& $pythonPath -m pip install -U pip setuptools wheel
& $pythonPath -m pip install -U pyyaml msgspec typing-extensions pybind11
& $pythonPath -m pip install -r (Join-Path $sourceRoot "requirements.txt")

Write-Output "Native SearXNG installed at $sourceRoot"
