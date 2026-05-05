param(
  [switch] $WaitForHealth,
  [int] $Port = 8889
)

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$nativeRoot = Join-Path $scriptRoot "native"
$sourceRoot = Join-Path $nativeRoot "searxng-master"
$pythonPath = Join-Path $nativeRoot ".venv\Scripts\python.exe"
$settingsPath = Join-Path $scriptRoot "searxng-settings.yml"
$logDir = Join-Path $nativeRoot "logs"
$stdoutLog = Join-Path $logDir "searxng-stdout.log"
$stderrLog = Join-Path $logDir "searxng-stderr.log"
$healthUrl = "http://127.0.0.1:$Port/config"

function Test-SearxngHealth {
  param([string] $Url)

  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
    return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300)
  } catch {
    return $false
  }
}

if (-not (Test-Path $pythonPath)) {
  Write-Error "Native SearXNG Python not found at $pythonPath"
  exit 1
}

if (-not (Test-Path $sourceRoot)) {
  Write-Error "Native SearXNG source not found at $sourceRoot"
  exit 1
}

if (-not (Test-Path $settingsPath)) {
  Write-Error "SearXNG settings file not found at $settingsPath"
  exit 1
}

if (Test-SearxngHealth -Url $healthUrl) {
  Write-Output "SearXNG already healthy at $healthUrl"
  exit 0
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$env:SEARXNG_SETTINGS_PATH = $settingsPath
$env:SEARXNG_PORT = [string] $Port

$startInfo = @{
  FilePath = $pythonPath
  ArgumentList = @("-m", "searx.webapp")
  WorkingDirectory = $sourceRoot
  RedirectStandardOutput = $stdoutLog
  RedirectStandardError = $stderrLog
  WindowStyle = "Hidden"
  PassThru = $true
}

$process = Start-Process @startInfo

if ($WaitForHealth) {
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-SearxngHealth -Url $healthUrl) {
      Write-Output "SearXNG healthy at $healthUrl"
      exit 0
    }
    if ($process.HasExited) {
      Write-Error "Native SearXNG exited early. Check $stderrLog"
      exit 1
    }
  }

  Write-Error "Native SearXNG did not become healthy in time. Check $stderrLog"
  exit 1
}

Write-Output "Started native SearXNG in background on port $Port (PID $($process.Id))"
