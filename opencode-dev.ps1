#!/usr/bin/env pwsh
# Simple dev-mode launcher for opencode - runs raw bun without binary fallback
# Usage: ./opencode-dev.ps1 [args...]

param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $CliArgs
)

$ErrorActionPreference = "Stop"

# Resolve paths
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$packageRoot = Join-Path $repoRoot "packages\opencode"
$entryPath = Join-Path $packageRoot "src\index.ts"
$callerCwd = (Get-Location).Path

# Verify we're in a valid opencode repo
if (-not (Test-Path $entryPath)) {
  Write-Error "Opencode source not found at $entryPath. Are you in the right repo?"
  exit 1
}

# Check for bun
$bunCmd = Get-Command bun -ErrorAction SilentlyContinue
if (-not $bunCmd) {
  Write-Error "bun is required but not found in PATH. Install from https://bun.sh"
  exit 1
}

# Set minimal environment
$env:OPENCODE_CALLER_CWD = $callerCwd

# Detect harness mode
$harnessActive = $CliArgs -contains "--harness" -or ($CliArgs[0..1] -join " ") -eq "debug harness"
if ($harnessActive) {
  $env:OPENCODE_HARNESS_ACTIVE = "1"
}

# Default websearch backend
if (-not (Test-Path Env:OPENCODE_ENABLE_EXA)) {
  $env:OPENCODE_ENABLE_EXA = "1"
}

# Launch in dev mode (raw bun, no build step)
Write-Host "opencode-dev: launching from source..." -ForegroundColor Cyan
& $bunCmd.Source run --cwd $packageRoot --conditions=browser $entryPath -- @CliArgs

exit $LASTEXITCODE
