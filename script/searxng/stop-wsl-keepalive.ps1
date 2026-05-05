param(
  [string]$Distro = "Ubuntu"
)

$targets = Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -eq "wsl.exe" -and
    $_.CommandLine -match "-- bash -lc tail -f /dev/null" -and
    $_.CommandLine -match [Regex]::Escape($Distro)
  }

if (-not $targets) {
  Write-Output ("No WSL keepalive process found for distro '{0}'." -f $Distro)
  exit 0
}

$targets | ForEach-Object {
  try {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
    Write-Output ("Stopped WSL keepalive PID {0} for distro '{1}'." -f $_.ProcessId, $Distro)
  } catch {
    Write-Output ("Failed to stop PID {0}: {1}" -f $_.ProcessId, $_.Exception.Message)
  }
}
