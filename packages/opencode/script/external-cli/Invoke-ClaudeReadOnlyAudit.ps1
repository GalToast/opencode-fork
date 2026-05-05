param(
  [Parameter(Mandatory = $true)]
  [string] $PromptPath,

  [string] $Name = "claude-readonly-audit",
  [string] $WorkingDirectory = (Get-Location).Path,
  [int] $TimeoutSeconds = 120,
  [string] $Tools = "Read,Glob,Grep,LS",
  [string] $PermissionMode = "plan",
  [string] $OutputFormat = "text",
  [string] $Model = "",
  [string] $ClaudeExe = "",
  [switch] $NoBare
)

$ErrorActionPreference = "Stop"

function Resolve-ClaudeExe {
  param([string] $Explicit)

  if ($Explicit) {
    if (!(Test-Path -LiteralPath $Explicit)) {
      throw "Claude executable not found: $Explicit"
    }
    return (Resolve-Path -LiteralPath $Explicit).Path
  }

  $candidate = Join-Path $env:APPDATA "npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe"
  if (Test-Path -LiteralPath $candidate) {
    return (Resolve-Path -LiteralPath $candidate).Path
  }

  $command = Get-Command claude -ErrorAction SilentlyContinue
  if ($command -and $command.Source -and (Test-Path -LiteralPath $command.Source)) {
    return (Resolve-Path -LiteralPath $command.Source).Path
  }

  throw "Claude CLI was not found. Install @anthropic-ai/claude-code or pass -ClaudeExe."
}

function Get-ChildProcessTree {
  param([int] $RootProcessId)

  $seen = @{}
  $queue = New-Object System.Collections.Generic.Queue[int]
  $queue.Enqueue($RootProcessId)

  while ($queue.Count -gt 0) {
    $current = $queue.Dequeue()
    if ($seen.ContainsKey($current)) {
      continue
    }
    $seen[$current] = $true
    Get-CimInstance Win32_Process -Filter "ParentProcessId = $current" -ErrorAction SilentlyContinue |
      ForEach-Object {
        $queue.Enqueue([int] $_.ProcessId)
      }
  }

  return @($seen.Keys | ForEach-Object { [int] $_ } | Sort-Object -Descending)
}

function Stop-ProcessTree {
  param([int] $RootProcessId)

  foreach ($processId in Get-ChildProcessTree -RootProcessId $RootProcessId) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }
}

function ConvertTo-ProcessArgument {
  param([string] $Value)

  if ($Value -eq "") {
    return '""'
  }

  if ($Value -notmatch '[\s"]') {
    return $Value
  }

  $escaped = $Value -replace '\\(?=")', '\\'
  $escaped = $escaped -replace '"', '\"'
  return '"' + $escaped + '"'
}

if (!(Test-Path -LiteralPath $PromptPath)) {
  throw "Prompt file not found: $PromptPath"
}

$repo = (Resolve-Path -LiteralPath $WorkingDirectory).Path
$archiveRoot = Join-Path $repo "tmp\external-cli-subagents"
New-Item -ItemType Directory -Force -Path $archiveRoot | Out-Null

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$safeName = ($Name -replace "[^A-Za-z0-9_.-]", "-")
$runDir = Join-Path $archiveRoot "$safeName-$stamp"
New-Item -ItemType Directory -Force -Path $runDir | Out-Null

$promptCopy = Join-Path $runDir "prompt.md"
$stdoutPath = Join-Path $runDir "stdout.md"
$stderrPath = Join-Path $runDir "stderr.md"
$resultPath = Join-Path $runDir "result.json"
$pidPath = Join-Path $runDir "pid.txt"
$mcpConfigPath = Join-Path $runDir "empty-mcp-config.json"

Copy-Item -LiteralPath $PromptPath -Destination $promptCopy
Set-Content -LiteralPath $mcpConfigPath -Encoding UTF8 -Value '{"mcpServers":{}}'

$claude = Resolve-ClaudeExe -Explicit $ClaudeExe
$prompt = Get-Content -LiteralPath $PromptPath -Raw

$claudeArgs = New-Object System.Collections.Generic.List[string]
if (!$NoBare) {
  $claudeArgs.Add("--bare")
}
$claudeArgs.Add("--strict-mcp-config")
$claudeArgs.Add("--mcp-config")
$claudeArgs.Add($mcpConfigPath)
$claudeArgs.Add("--no-chrome")
$claudeArgs.Add("--disable-slash-commands")
$claudeArgs.Add("--tools")
$claudeArgs.Add($Tools)
$claudeArgs.Add("--permission-mode")
$claudeArgs.Add($PermissionMode)
$claudeArgs.Add("--output-format")
$claudeArgs.Add($OutputFormat)
$claudeArgs.Add("--no-session-persistence")
if ($Model) {
  $claudeArgs.Add("--model")
  $claudeArgs.Add($Model)
}
$claudeArgs.Add("--print")
$claudeArgs.Add("--input-format")
$claudeArgs.Add("text")

$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName = $claude
$psi.WorkingDirectory = $repo
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true
if ($null -ne $psi.ArgumentList) {
  foreach ($arg in $claudeArgs) {
    [void] $psi.ArgumentList.Add($arg)
  }
} else {
  $psi.Arguments = ($claudeArgs | ForEach-Object { ConvertTo-ProcessArgument $_ }) -join " "
}

$process = [System.Diagnostics.Process]::new()
$process.StartInfo = $psi
$startedAt = Get-Date
[void] $process.Start()
Set-Content -LiteralPath $pidPath -Encoding ASCII -Value ([string] $process.Id)

$stdoutTask = $process.StandardOutput.ReadToEndAsync()
$stderrTask = $process.StandardError.ReadToEndAsync()
$process.StandardInput.Write($prompt)
$process.StandardInput.Close()

$completed = $process.WaitForExit($TimeoutSeconds * 1000)
$timedOut = !$completed
if ($timedOut) {
  Stop-ProcessTree -RootProcessId $process.Id
  $process.WaitForExit(5000) | Out-Null
}

$stdout = $stdoutTask.GetAwaiter().GetResult()
$stderr = $stderrTask.GetAwaiter().GetResult()
Set-Content -LiteralPath $stdoutPath -Encoding UTF8 -Value $stdout
Set-Content -LiteralPath $stderrPath -Encoding UTF8 -Value $stderr

$exitCode = if ($timedOut) { $null } else { $process.ExitCode }
$endedAt = Get-Date
$result = [ordered]@{
  ok = (!$timedOut -and $exitCode -eq 0)
  timedOut = $timedOut
  exitCode = $exitCode
  pid = $process.Id
  startedAt = $startedAt.ToString("o")
  endedAt = $endedAt.ToString("o")
  durationSeconds = [Math]::Round(($endedAt - $startedAt).TotalSeconds, 3)
  command = $claude
  arguments = @($claudeArgs)
  workingDirectory = $repo
  runDirectory = $runDir
  promptPath = $promptCopy
  stdoutPath = $stdoutPath
  stderrPath = $stderrPath
  mcpConfigPath = $mcpConfigPath
}

$result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $resultPath -Encoding UTF8
$result | ConvertTo-Json -Depth 6

if ($timedOut) {
  exit 124
}

exit $exitCode
