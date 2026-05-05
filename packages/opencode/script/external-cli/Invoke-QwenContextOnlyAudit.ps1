param(
  [Parameter(Mandatory = $true)]
  [string] $PromptPath,
  [string] $Name = "qwen-context-audit",
  [string] $WorkingDirectory = (Get-Location).Path,
  [int] $TimeoutSeconds = 120,
  [string] $Model = "",
  [string] $QwenCommand = "qwen"
)

$ErrorActionPreference = "Stop"

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
Set-Content -LiteralPath $mcpConfigPath -Encoding ASCII -Value '{"mcpServers":{}}'

$prompt = Get-Content -LiteralPath $PromptPath -Raw
$guardedPrompt = @"
Do not use tools, shell commands, file reads, file writes, MCP servers, browser automation, or workspace inspection.
Use only the context in this prompt. If the answer requires inspecting files or running commands, say so instead of attempting tool use.

$prompt
"@

$qwen = (Get-Command $QwenCommand -ErrorAction Stop).Source

$qwenArgs = New-Object System.Collections.Generic.List[string]
$qwenArgs.Add("--mcp-config")
$qwenArgs.Add($mcpConfigPath)
$qwenArgs.Add("--approval-mode")
$qwenArgs.Add("plan")
$qwenArgs.Add("--output-format")
$qwenArgs.Add("text")
$qwenArgs.Add("--exclude-tools")
$qwenArgs.Add("run_shell_command")
$qwenArgs.Add("--exclude-tools")
$qwenArgs.Add("shell")
$qwenArgs.Add("--exclude-tools")
$qwenArgs.Add("read_file")
$qwenArgs.Add("--exclude-tools")
$qwenArgs.Add("write_file")
if ($Model) {
  $qwenArgs.Add("--model")
  $qwenArgs.Add($Model)
}

$psi = [System.Diagnostics.ProcessStartInfo]::new()
$launcherArgs = New-Object System.Collections.Generic.List[string]
if ($qwen -match '\.ps1$') {
  $psi.FileName = "powershell.exe"
  $launcherArgs.Add("-NoProfile")
  $launcherArgs.Add("-ExecutionPolicy")
  $launcherArgs.Add("Bypass")
  $launcherArgs.Add("-File")
  $launcherArgs.Add($qwen)
} else {
  $psi.FileName = $qwen
}
$psi.WorkingDirectory = $repo
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true
if ($null -ne $psi.ArgumentList) {
  foreach ($arg in $launcherArgs) {
    [void] $psi.ArgumentList.Add($arg)
  }
  foreach ($arg in $qwenArgs) {
    [void] $psi.ArgumentList.Add($arg)
  }
} else {
  $allArgs = @($launcherArgs) + @($qwenArgs)
  $psi.Arguments = ($allArgs | ForEach-Object { ConvertTo-ProcessArgument $_ }) -join " "
}

$process = [System.Diagnostics.Process]::new()
$process.StartInfo = $psi
$startedAt = Get-Date
[void] $process.Start()
Set-Content -LiteralPath $pidPath -Encoding ASCII -Value ([string] $process.Id)

$stdoutTask = $process.StandardOutput.ReadToEndAsync()
$stderrTask = $process.StandardError.ReadToEndAsync()
$process.StandardInput.Write($guardedPrompt)
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
  command = $qwen
  arguments = @($qwenArgs)
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
