param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $CliArgs
)

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$packageRoot = Join-Path $repoRoot "packages\opencode"
$binPath = Join-Path $repoRoot "packages\opencode\dist\opencode-windows-x64\bin\opencode.exe"
$packageJsonPath = Join-Path $packageRoot "package.json"
$entryPath = Join-Path $packageRoot "src\launcher.ts"
$searxComposePath = Join-Path $repoRoot "script\searxng\docker-compose.yml"
$searxNativeStartPath = Join-Path $repoRoot "script\searxng\start-native.ps1"
$opentuiDllRoot = Join-Path $repoRoot "node_modules\.bun"
$opentuiCacheDir = Join-Path $repoRoot ".opencode\runtime\opentui"
$callerCwd = (Get-Location).Path
$harnessRoot = $callerCwd
$harnessRuntimeDir = Join-Path $harnessRoot ".opencode\runtime\harness"
$harnessObservationPath = Join-Path $harnessRuntimeDir "observations.jsonl"
$harnessOverlayPath = Join-Path $harnessRuntimeDir "overlay.json"
$searxEndpointCachePath = Join-Path $harnessRuntimeDir "searxng-endpoint.json"
$mutableWorkerManifestPath = Join-Path $harnessRuntimeDir "worker-canary.json"
$supervisorRoot = $repoRoot

function Get-MutableWorkerMode {
  if (-not (Test-Path Env:OPENCODE_MUTABLE_WORKER_MODE)) {
    return ""
  }

  return $env:OPENCODE_MUTABLE_WORKER_MODE.Trim().ToLowerInvariant()
}

function Get-MutableWorkerManifest {
  param([string] $ManifestPath)

  if (-not (Test-Path $ManifestPath)) {
    return $null
  }

  try {
    return Get-Content $ManifestPath -Raw | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Test-MutableWorkerRoot {
  param([string] $Root)

  if ([string]::IsNullOrWhiteSpace($Root)) {
    return $false
  }

  $entry = Join-Path $Root "packages\opencode\src\index.ts"
  return Test-Path $entry
}

function Resolve-EffectiveSourceRoot {
  param(
    [string] $StableRoot,
    [string] $ManifestPath,
    [string] $Mode
  )

  if ($Mode -ne "canary" -and $Mode -ne "prefer-canary") {
    return @{
      root = $StableRoot
      delegated = $false
      mode = $Mode
    }
  }

  $manifest = Get-MutableWorkerManifest -ManifestPath $ManifestPath
  if (-not $manifest) {
    return @{
      root = $StableRoot
      delegated = $false
      mode = $Mode
    }
  }

  $candidate = [string] $manifest.workerRoot
  if (-not (Test-MutableWorkerRoot -Root $candidate)) {
    return @{
      root = $StableRoot
      delegated = $false
      mode = $Mode
    }
  }

  return @{
    root = [System.IO.Path]::GetFullPath($candidate)
    delegated = $true
    mode = $Mode
    manifest = $manifest
  }
}

$mutableWorkerMode = Get-MutableWorkerMode
$workerSelection = Resolve-EffectiveSourceRoot -StableRoot $repoRoot -ManifestPath $mutableWorkerManifestPath -Mode $mutableWorkerMode
$effectiveSourceRoot = [string] $workerSelection.root

function Test-HarnessInvocation {
  param([string[]] $ArgsList)

  if (-not $ArgsList) {
    return $false
  }

  if ($ArgsList -contains "--harness") {
    return $true
  }

  $tokens = @($ArgsList | Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and -not $_.StartsWith("-") })
  return $tokens.Length -ge 2 -and $tokens[0] -eq "debug" -and $tokens[1] -eq "harness"
}

$harnessActive = Test-HarnessInvocation -ArgsList $CliArgs
$observerActive = $false
$env:OPENCODE_CALLER_CWD = $callerCwd
if ($harnessActive) {
  $env:OPENCODE_HARNESS_ACTIVE = "1"
}

if (-not (Test-Path Env:OPENCODE_ENABLE_EXA)) {
  $env:OPENCODE_ENABLE_EXA = "1"
}
if (-not (Test-Path Env:OPENCODE_EXPERIMENTAL_WORKSPACES)) {
  $env:OPENCODE_EXPERIMENTAL_WORKSPACES = "1"
}
# Force SearXNG-only mode for opencodex launches.
$env:OPENCODE_WEBSEARCH_BACKEND = "searxng"
if (-not (Test-Path Env:OPENCODE_SEARXNG_URL)) {
  $env:OPENCODE_SEARXNG_URL = "http://127.0.0.1:8080"
}
$env:SEARXNG_URL = $env:OPENCODE_SEARXNG_URL

function Write-HarnessObservation {
  param(
    [string] $Source,
    [string] $Kind,
    [string] $Message,
    [hashtable] $Data
  )

  if (-not ($harnessActive -or $observerActive)) {
    return
  }

  try {
    New-Item -ItemType Directory -Force $harnessRuntimeDir | Out-Null
    $payload = @{
      time = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      source = $Source
      kind = $Kind
      message = $Message
    }
    if ($Data) {
      $payload.data = $Data
    }
    [System.IO.File]::AppendAllText(
      $harnessObservationPath,
      (($payload | ConvertTo-Json -Compress -Depth 8) + [Environment]::NewLine)
    )
  } catch {
    # Harness telemetry should never block the actual launch path.
  }
}

if ($harnessActive -or $observerActive) {
  Write-HarnessObservation -Source "wrapper" -Kind "launch.wrapper_invoked" -Message "Wrapper invoked." -Data @{
    callerCwd = $callerCwd
    harnessActive = $harnessActive
  }
  if ($workerSelection.delegated) {
    Write-HarnessObservation -Source "wrapper" -Kind "launch.worker_canary_selected" -Message "Launching through the mutable worker canary." -Data @{
      sourceRoot = $effectiveSourceRoot
      manifestPath = $mutableWorkerManifestPath
      mode = $mutableWorkerMode
    }
  } elseif ($mutableWorkerMode -eq "canary" -or $mutableWorkerMode -eq "prefer-canary") {
    Write-HarnessObservation -Source "wrapper" -Kind "launch.worker_canary_unavailable" -Message "Mutable worker canary was requested but not ready; using the stable supervisor source tree." -Data @{
      sourceRoot = $repoRoot
      manifestPath = $mutableWorkerManifestPath
      mode = $mutableWorkerMode
    }
  }
}

function Get-OpenTuiPackageDir {
  param([string] $BunRoot)

  if (-not (Test-Path $BunRoot)) {
    return $null
  }

  $packageRoot = Get-ChildItem -Path $BunRoot -Directory -Filter "@opentui+core-win32-x64@*" -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending |
    Select-Object -First 1
  if (-not $packageRoot) {
    return $null
  }

  $packageDir = Join-Path $packageRoot.FullName "node_modules\@opentui\core-win32-x64"
  if (Test-Path $packageDir) {
    return $packageDir
  }

  return $null
}

function Ensure-OpenTuiModuleShim {
  param([string] $PackageDir)

  $indexPath = Join-Path $PackageDir "index.ts"
  if (-not (Test-Path $indexPath)) {
    return
  }

  $shim = @'
const envPath = process.env.OTUI_RENDER_LIB_PATH?.trim()
const path = envPath || (await import("./opentui.dll", { with: { type: "file" } })).default
export default path
'@

  $current = Get-Content $indexPath -Raw -ErrorAction SilentlyContinue
  if ($current -ne $shim) {
    Set-Content -Path $indexPath -Value $shim -NoNewline
  }
}

function Get-OpenTuiVersion {
  param([string] $PackageJsonPath)

  try {
    $packageJson = Get-Content $PackageJsonPath -Raw | ConvertFrom-Json
    $version = [string] $packageJson.dependencies.'@opentui/core'
    if (-not [string]::IsNullOrWhiteSpace($version)) {
      return ($version -replace '^[~^]+', '').Trim()
    }
  } catch {
  }

  return "0.1.86"
}

function Restore-OpenTuiDllFromNpmPack {
  param(
    [string] $Version,
    [string] $CacheDir
  )

  $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
  if (-not $npmCmd) {
    return $null
  }

  $cacheDllPath = Join-Path $CacheDir "opentui.dll"
  $scratchDir = Join-Path $CacheDir "pack"

  New-Item -ItemType Directory -Force $CacheDir | Out-Null
  Remove-Item $scratchDir -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force $scratchDir | Out-Null

  try {
    $tarball = (& $npmCmd.Source pack "@opentui/core-win32-x64@$Version" --pack-destination $scratchDir 2>$null | Select-Object -Last 1)
    if ([string]::IsNullOrWhiteSpace($tarball)) {
      return $null
    }

    $tarballPath = Join-Path $scratchDir $tarball.Trim()
    tar -xzf $tarballPath -C $scratchDir *> $null

    $packedDll = Join-Path $scratchDir "package\opentui.dll"
    if (-not (Test-Path $packedDll)) {
      return $null
    }

    Copy-Item $packedDll $cacheDllPath -Force
    return $cacheDllPath
  } catch {
    return $null
  }
}

function Ensure-OpenTuiRenderLib {
  param(
    [string] $BunRoot,
    [string] $CacheDir,
    [string] $PackageJsonPath
  )

  $packageDir = Get-OpenTuiPackageDir -BunRoot $BunRoot
  if (-not $packageDir) {
    return $null
  }
  Ensure-OpenTuiModuleShim -PackageDir $packageDir

  $packageDllPath = Join-Path $packageDir "opentui.dll"
  $cacheDllPath = Join-Path $CacheDir "opentui.dll"
  $envDllPath = $null

  if (Test-Path Env:OTUI_RENDER_LIB_PATH) {
    $candidate = $env:OTUI_RENDER_LIB_PATH.Trim()
    if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path $candidate)) {
      $envDllPath = $candidate
    }
  }

  New-Item -ItemType Directory -Force $CacheDir | Out-Null

  if ($envDllPath -and -not (Test-Path $cacheDllPath)) {
    Copy-Item $envDllPath $cacheDllPath -Force -ErrorAction SilentlyContinue
  }

  if ((Test-Path $packageDllPath) -and -not (Test-Path $cacheDllPath)) {
    Copy-Item $packageDllPath $cacheDllPath -Force -ErrorAction SilentlyContinue
  }

  if ((Test-Path $cacheDllPath) -and -not (Test-Path $packageDllPath)) {
    Copy-Item $cacheDllPath $packageDllPath -Force -ErrorAction SilentlyContinue
  }

  if (-not (Test-Path $packageDllPath)) {
    $version = Get-OpenTuiVersion -PackageJsonPath $PackageJsonPath
    $restoredDll = Restore-OpenTuiDllFromNpmPack -Version $version -CacheDir $CacheDir
    if ($restoredDll) {
      Copy-Item $restoredDll $packageDllPath -Force -ErrorAction SilentlyContinue
    }
  }

  if (Test-Path $cacheDllPath) {
    return $cacheDllPath
  }

  if (Test-Path $packageDllPath) {
    return $packageDllPath
  }

  return $envDllPath
}

$stableDll = Ensure-OpenTuiRenderLib -BunRoot $opentuiDllRoot -CacheDir $opentuiCacheDir -PackageJsonPath $packageJsonPath
if (-not [string]::IsNullOrWhiteSpace($stableDll)) {
  $env:OTUI_RENDER_LIB_PATH = $stableDll
  Write-HarnessObservation -Source "wrapper" -Kind "opentui.ready" -Message "OpenTUI render library is ready." -Data @{
    renderLibPath = $stableDll
  }
} else {
  Write-Warning "opencodex: OpenTUI render DLL is missing or quarantined. If Windows Defender keeps removing it, add an exclusion for '$opentuiCacheDir' (preferred) or '$opentuiDllRoot'."
  Write-HarnessObservation -Source "wrapper" -Kind "opentui.missing" -Message "OpenTUI render library is unavailable." -Data @{
    cacheDir = $opentuiCacheDir
    bunRoot = $opentuiDllRoot
  }
}

function Test-SearxngHealth {
  param([string] $BaseUrl)

  # Use a local endpoint that does not trigger outbound engine traffic.
  $healthUrl = "{0}/config" -f $BaseUrl.TrimEnd("/")
  try {
    $response = Invoke-WebRequest -Uri $healthUrl -Method Get -UseBasicParsing -TimeoutSec 4
    return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300)
  } catch {
    return $false
  }
}

function Wait-ForSearxngHealth {
  param(
    [string] $BaseUrl,
    [int] $Attempts = 5,
    [int] $DelayMilliseconds = 400,
    [int] $RequiredSuccesses = 2
  )

  $successes = 0
  for ($i = 0; $i -lt $Attempts; $i++) {
    if (Test-SearxngHealth -BaseUrl $BaseUrl) {
      $successes++
      if ($successes -ge $RequiredSuccesses) {
        return $true
      }
    } else {
      $successes = 0
    }

    if ($i -lt ($Attempts - 1)) {
      Start-Sleep -Milliseconds $DelayMilliseconds
    }
  }

  return $false
}

function Get-SearxngPortScanSpec {
  if (Test-Path Env:OPENCODE_SEARXNG_PORT_SCAN) {
    return [string] $env:OPENCODE_SEARXNG_PORT_SCAN
  }

  if (Test-Path Env:OPENCODE_SEARXNG_PORTS) {
    return [string] $env:OPENCODE_SEARXNG_PORTS
  }

  return ""
}

function Expand-SearxngPortToken {
  param([string] $Token)

  $trimmed = ""
  if (-not [string]::IsNullOrWhiteSpace($Token)) {
    $trimmed = $Token.Trim()
  }
  if ([string]::IsNullOrWhiteSpace($trimmed)) {
    return @()
  }

  if ($trimmed -match "^(\d+)\s*-\s*(\d+)$") {
    $start = [int] $Matches[1]
    $finish = [int] $Matches[2]
    if ($start -gt $finish) {
      $tmp = $start
      $start = $finish
      $finish = $tmp
    }
    $ports = @()
    for ($port = $start; $port -le $finish; $port++) {
      if ($port -ge 1 -and $port -le 65535) {
        $ports += $port
      }
    }
    return $ports
  }

  $number = 0
  if ([int]::TryParse($trimmed, [ref] $number) -and $number -ge 1 -and $number -le 65535) {
    return @($number)
  }

  return @()
}

function Get-SearxngPortCandidates {
  param([int] $PreferredPort = 8080)

  $spec = Get-SearxngPortScanSpec
  $ports = @()

  if (-not [string]::IsNullOrWhiteSpace($spec)) {
    foreach ($token in ($spec -split "[,\s]+")) {
      $ports += Expand-SearxngPortToken -Token $token
    }
  }

  if ($ports.Count -eq 0) {
    $ports = @($PreferredPort, 8889, 3333, 8080, 8081, 8888)
  } elseif ($PreferredPort -ge 1 -and $PreferredPort -le 65535) {
    $ports = @($PreferredPort) + $ports
  }

  return $ports | Select-Object -Unique
}

function Read-SearxngEndpointCache {
  if (-not (Test-Path $searxEndpointCachePath)) {
    return $null
  }

  try {
    $cached = Get-Content $searxEndpointCachePath -Raw | ConvertFrom-Json
    $url = [string] $cached.url
    if ([string]::IsNullOrWhiteSpace($url)) {
      return $null
    }
    return $url.Trim().TrimEnd("/")
  } catch {
    return $null
  }
}

function Write-SearxngEndpointCache {
  param([string] $Url)

  if ([string]::IsNullOrWhiteSpace($Url)) {
    return
  }

  try {
    New-Item -ItemType Directory -Force $harnessRuntimeDir | Out-Null
    [System.IO.File]::WriteAllText(
      $searxEndpointCachePath,
      (@{
        url = $Url.Trim().TrimEnd("/")
        updatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      } | ConvertTo-Json -Compress -Depth 4)
    )
  } catch {
  }
}

function Convert-ToWslPath {
  param([string] $WindowsPath)

  $fullPath = [System.IO.Path]::GetFullPath($WindowsPath)
  if ($fullPath -match "^([A-Za-z]):\\(.*)$") {
    $drive = $Matches[1].ToLowerInvariant()
    $rest = $Matches[2] -replace "\\", "/"
    return "/mnt/$drive/$rest"
  }

  return $fullPath -replace "\\", "/"
}

function Start-NativeSearxng {
  param([string] $StartScriptPath)

  if (-not (Test-Path $StartScriptPath)) {
    return $false
  }

  $pwshCmd = Get-Command powershell -ErrorAction SilentlyContinue
  if (-not $pwshCmd) {
    return $false
  }

  try {
    & $pwshCmd.Source -NoProfile -ExecutionPolicy Bypass -File $StartScriptPath *> $null
    return ($LASTEXITCODE -eq 0)
  } catch {
    return $false
  }
}

function Start-SearxngContainer {
  param(
    [string] $ComposePath,
    [string] $NativeStartScriptPath
  )

  if (-not [string]::IsNullOrWhiteSpace($NativeStartScriptPath)) {
    if (Start-NativeSearxng -StartScriptPath $NativeStartScriptPath) {
      return $true
    }
  }

  if (-not (Test-Path $ComposePath)) {
    Write-Warning "opencodex: SearXNG compose file not found at $ComposePath"
    return $false
  }

  $dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
  if ($dockerCmd) {
    try {
      & docker compose -f $ComposePath up -d *> $null
      if ($LASTEXITCODE -eq 0) {
        return $true
      }
    } catch {
      # Fall through to WSL fallback.
    }
  }

  $wslCmd = Get-Command wsl -ErrorAction SilentlyContinue
  if (-not $wslCmd) {
    Write-Warning "opencodex: docker and wsl are unavailable; could not auto-start SearXNG."
    return $false
  }

  $distro = $env:OPENCODE_WSL_DISTRO
  if ([string]::IsNullOrWhiteSpace($distro)) {
    $distro = "Ubuntu"
  }

  & wsl -d $distro -- sh -lc "true" *> $null
  if ($LASTEXITCODE -ne 0) {
    $fallbackDistro = (& wsl -l -q 2>$null | Select-Object -First 1)
    if ([string]::IsNullOrWhiteSpace($fallbackDistro)) {
      Write-Warning "opencodex: no usable WSL distro found; could not auto-start SearXNG."
      return $false
    }
    $distro = $fallbackDistro.Trim()
  }

  $composePathWsl = Convert-ToWslPath -WindowsPath $ComposePath
  & wsl -d $distro -- sh -lc "docker compose -f '$composePathWsl' up -d" *> $null
  if ($LASTEXITCODE -eq 0) {
    return $true
  }

  Write-Warning "opencodex: failed to start SearXNG in WSL distro '$distro'."
  return $false
}

function Get-WslPrimaryIPv4 {
  param([string] $Distro)

  if ([string]::IsNullOrWhiteSpace($Distro)) {
    return $null
  }

  try {
    $rawIps = & wsl -d $Distro -- sh -lc "hostname -I" 2>$null
    $ipv4 = ($rawIps -split "\s+" | Where-Object { $_ -match "^\d+\.\d+\.\d+\.\d+$" } | Select-Object -First 1)
    if ([string]::IsNullOrWhiteSpace($ipv4)) {
      return $null
    }
    return $ipv4.Trim()
  } catch {
    return $null
  }
}

function Get-PreferredWslSearxngUrl {
  param(
    [string] $CurrentUrl,
    [int] $Port = 8080,
    [string] $Scheme = "http"
  )

  $candidateDistros = @()
  if (-not [string]::IsNullOrWhiteSpace($env:OPENCODE_WSL_DISTRO)) {
    $candidateDistros += $env:OPENCODE_WSL_DISTRO
  }
  $candidateDistros += "Ubuntu"
  $listedDistros = & wsl -l -q 2>$null
  if ($listedDistros) {
    $candidateDistros += $listedDistros
  }
  $candidateDistros = $candidateDistros | ForEach-Object { $_.Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique

  foreach ($distro in $candidateDistros) {
    $wslIp = Get-WslPrimaryIPv4 -Distro $distro
    if (-not $wslIp) {
      continue
    }
    $candidateUrl = "{0}://{1}:{2}" -f $Scheme, $wslIp, $Port
    if (Test-SearxngHealth -BaseUrl $candidateUrl) {
      return $candidateUrl
    }
  }

  return $null
}

function Get-HealthySearxngUrl {
  param(
    [string] $CurrentUrl,
    [int] $Port = 8080,
    [string] $Scheme = "http",
    [switch] $IncludeWslCandidates
  )

  $candidates = @()
  $cachedUrl = Read-SearxngEndpointCache
  if (-not [string]::IsNullOrWhiteSpace($CurrentUrl)) {
    $candidates += $CurrentUrl.TrimEnd("/")
  }
  if (-not [string]::IsNullOrWhiteSpace($cachedUrl)) {
    $candidates += $cachedUrl
  }

  $preferredWslUrl = $null
  if ($IncludeWslCandidates) {
    $preferredWslUrl = Get-PreferredWslSearxngUrl -CurrentUrl $CurrentUrl -Port $Port -Scheme $Scheme
    if (-not [string]::IsNullOrWhiteSpace($preferredWslUrl)) {
      $candidates += $preferredWslUrl.TrimEnd("/")
    }
  }

  foreach ($candidatePort in (Get-SearxngPortCandidates -PreferredPort $Port)) {
    $candidates += ("{0}://127.0.0.1:{1}" -f $Scheme, $candidatePort)
    $candidates += ("{0}://localhost:{1}" -f $Scheme, $candidatePort)
  }
  $candidates = $candidates | ForEach-Object { $_.Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique

  foreach ($candidate in $candidates) {
    $requiresStability = $candidate -eq $CurrentUrl -or $candidate -eq $cachedUrl -or ($IncludeWslCandidates -and $candidate -eq $preferredWslUrl)
    if (($requiresStability -and (Wait-ForSearxngHealth -BaseUrl $candidate)) -or ((-not $requiresStability) -and (Test-SearxngHealth -BaseUrl $candidate))) {
      return $candidate
    }
  }

  return $null
}

function Test-SearxngAutoStartEnabled {
  if (-not (Test-Path Env:OPENCODE_SEARXNG_AUTO_START)) {
    return $false
  }

  $value = [string] $env:OPENCODE_SEARXNG_AUTO_START
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $false
  }

  switch ($value.Trim().ToLowerInvariant()) {
    "1" { return $true }
    "true" { return $true }
    "yes" { return $true }
    "on" { return $true }
    default { return $false }
  }
}

function Test-SearxngPreflightEnabled {
  if (Test-Path Env:OPENCODE_SEARXNG_PREFLIGHT) {
    $value = [string] $env:OPENCODE_SEARXNG_PREFLIGHT
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      switch ($value.Trim().ToLowerInvariant()) {
        "1" { return $true }
        "true" { return $true }
        "yes" { return $true }
        "on" { return $true }
        default { return $false }
      }
    }
  }

  return ($harnessActive -or $observerActive)
}

$backend = $env:OPENCODE_WEBSEARCH_BACKEND
if ($backend -ieq "auto" -or $backend -ieq "searxng") {
  if (-not (Test-SearxngPreflightEnabled)) {
    $cachedUrl = Read-SearxngEndpointCache
    if (-not [string]::IsNullOrWhiteSpace($cachedUrl)) {
      $env:OPENCODE_SEARXNG_URL = $cachedUrl.TrimEnd("/")
      $env:SEARXNG_URL = $env:OPENCODE_SEARXNG_URL
    }
    $autoStart = Test-SearxngAutoStartEnabled
    if ($autoStart) {
      Write-HarnessObservation -Source "wrapper" -Kind "searxng.start_background_attempt" -Message "Attempting non-blocking SearXNG startup." -Data @{
        composePath = $searxComposePath
        autoStart = $true
        url = $env:OPENCODE_SEARXNG_URL
      }
      $started = Start-SearxngContainer -ComposePath $searxComposePath -NativeStartScriptPath $searxNativeStartPath
      if ($started) {
        Write-HarnessObservation -Source "wrapper" -Kind "searxng.start_background_started" -Message "Issued non-blocking SearXNG startup." -Data @{
          composePath = $searxComposePath
          autoStart = $true
        }
      } else {
        Write-HarnessObservation -Source "wrapper" -Kind "searxng.start_background_failed" -Message "Non-blocking SearXNG startup failed." -Data @{
          composePath = $searxComposePath
          autoStart = $true
        }
      }
    }
    Write-HarnessObservation -Source "wrapper" -Kind "searxng.preflight_skipped" -Message "Skipping SearXNG launch preflight for faster startup." -Data @{
      url = $env:OPENCODE_SEARXNG_URL
      cached = -not [string]::IsNullOrWhiteSpace($cachedUrl)
      autoStart = $autoStart
    }
  } else {
    $parsedSearxUrl = $null
    try {
      $parsedSearxUrl = [System.Uri]::new($env:OPENCODE_SEARXNG_URL)
    } catch {
      $parsedSearxUrl = $null
    }

    $port = if ($parsedSearxUrl -and $parsedSearxUrl.Port -gt 0) { $parsedSearxUrl.Port } else { 8080 }
    $scheme = if ($parsedSearxUrl -and -not [string]::IsNullOrWhiteSpace($parsedSearxUrl.Scheme)) { $parsedSearxUrl.Scheme } else { "http" }

    $healthyUrl = Get-HealthySearxngUrl -CurrentUrl $env:OPENCODE_SEARXNG_URL -Port $port -Scheme $scheme
    $healthy = -not [string]::IsNullOrWhiteSpace($healthyUrl)
    if ($healthy) {
      Write-SearxngEndpointCache -Url $healthyUrl
      if ($healthyUrl -ne $env:OPENCODE_SEARXNG_URL) {
        $previousUrl = $env:OPENCODE_SEARXNG_URL
        $env:OPENCODE_SEARXNG_URL = $healthyUrl
        $env:SEARXNG_URL = $healthyUrl
        Write-Host "opencodex: using SearXNG endpoint $healthyUrl"
        Write-HarnessObservation -Source "wrapper" -Kind "searxng.endpoint_rerouted" -Message "Switched to a healthier SearXNG endpoint." -Data @{
          previousUrl = $previousUrl
          nextUrl = $healthyUrl
        }
      } elseif ($parsedSearxUrl -and -not ($parsedSearxUrl.Host -eq "127.0.0.1" -or $parsedSearxUrl.Host -eq "localhost")) {
        $env:SEARXNG_URL = $healthyUrl
        Write-Host "opencodex: using WSL SearXNG endpoint $healthyUrl"
        Write-HarnessObservation -Source "wrapper" -Kind "searxng.endpoint_confirmed" -Message "Using healthy WSL SearXNG endpoint." -Data @{
          url = $healthyUrl
        }
      } else {
        $env:SEARXNG_URL = $env:OPENCODE_SEARXNG_URL
        Write-HarnessObservation -Source "wrapper" -Kind "searxng.healthy" -Message "SearXNG endpoint is healthy." -Data @{
          url = $env:SEARXNG_URL
        }
      }
    }
    if (-not $healthy) {
      $autoStart = Test-SearxngAutoStartEnabled
      if ($autoStart) {
        Write-Host "opencodex: starting SearXNG..."
        Write-HarnessObservation -Source "wrapper" -Kind "searxng.start_attempt" -Message "Attempting to start SearXNG." -Data @{
          composePath = $searxComposePath
          autoStart = $true
        }
        $started = Start-SearxngContainer -ComposePath $searxComposePath -NativeStartScriptPath $searxNativeStartPath
        if ($started) {
          Write-HarnessObservation -Source "wrapper" -Kind "searxng.start_started" -Message "SearXNG start command succeeded." -Data @{
            composePath = $searxComposePath
            autoStart = $true
          }
        } else {
          Write-HarnessObservation -Source "wrapper" -Kind "searxng.start_failed" -Message "SearXNG start command failed." -Data @{
            composePath = $searxComposePath
            autoStart = $true
          }
        }
        if ($started) {
          for ($attempt = 0; $attempt -lt 15 -and -not $healthy; $attempt++) {
            Start-Sleep -Seconds 1
            $healthyUrl = Get-HealthySearxngUrl -CurrentUrl $env:OPENCODE_SEARXNG_URL -Port $port -Scheme $scheme
            if (-not [string]::IsNullOrWhiteSpace($healthyUrl)) {
              $env:OPENCODE_SEARXNG_URL = $healthyUrl
              $env:SEARXNG_URL = $healthyUrl
              $healthy = $true
              Write-Host "opencodex: using SearXNG endpoint $healthyUrl"
              Write-HarnessObservation -Source "wrapper" -Kind "searxng.started_healthy" -Message "SearXNG became healthy after startup." -Data @{
                url = $healthyUrl
                attempt = $attempt + 1
              }
              break
            }
          }
        }
      } else {
        Write-HarnessObservation -Source "wrapper" -Kind "searxng.start_skipped" -Message "Skipped SearXNG auto-start during launch." -Data @{
          url = $env:OPENCODE_SEARXNG_URL
          autoStart = $false
        }
      }
    }

    if (-not $healthy) {
      Write-Warning "opencodex: SearXNG is still unreachable at $($env:OPENCODE_SEARXNG_URL). Websearch may report 'cannot reach url'."
      Write-HarnessObservation -Source "wrapper" -Kind "searxng.unhealthy" -Message "SearXNG is still unreachable after recovery attempts." -Data @{
        url = $env:OPENCODE_SEARXNG_URL
      }
    }
  }
}

$launchMode = if (Test-Path Env:OPENCODE_WINDOWS_LAUNCH_MODE) {
  $env:OPENCODE_WINDOWS_LAUNCH_MODE.Trim().ToLowerInvariant()
} else {
  ""
}
$bunCmd = Get-Command bun -ErrorAction SilentlyContinue
$binaryExists = Test-Path $binPath
$useBunRunner = ($launchMode -ne "binary") -and $bunCmd -and (Test-Path $entryPath) -and (-not $binaryExists)

if ($useBunRunner) {
  if ($harnessActive -or $observerActive) {
    Write-HarnessObservation -Source "wrapper" -Kind "launch.source_mode" -Message "Launching from source through Bun." -Data @{
      callerCwd = $callerCwd
      harnessRoot = $harnessRoot
      entryPath = $entryPath
      packageRoot = $packageRoot
      effectiveSourceRoot = $effectiveSourceRoot
    }
  }
  # Keep the user's launch directory as the workspace while loading the fork entrypoint by absolute path.
  & $bunCmd.Source run --conditions=browser $entryPath -- @CliArgs
  $exitCode = $LASTEXITCODE
  exit $exitCode
}

if (-not (Test-Path $binPath)) {
  Write-Error "Patched OpenCode binary not found at $binPath and Bun source launch is unavailable."
  exit 1
}

if ($harnessActive -or $observerActive) {
  Write-HarnessObservation -Source "wrapper" -Kind "launch.binary_mode" -Message "Launching with the packaged binary." -Data @{
    callerCwd = $callerCwd
    harnessRoot = $harnessRoot
    binPath = $binPath
    bunAvailable = [bool]$bunCmd
    requestedLaunchMode = $launchMode
    effectiveSourceRoot = $effectiveSourceRoot
  }
}

# Launch the binary directly.
& $binPath @CliArgs
$exitCode = $LASTEXITCODE
exit $exitCode
