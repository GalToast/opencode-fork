param(
  [string]$Distro = "Ubuntu"
)

$existing = Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -eq "wsl.exe" -and
    $_.CommandLine -match "-- bash -lc tail -f /dev/null" -and
    $_.CommandLine -match [Regex]::Escape($Distro)
  }

if ($existing) {
  Write-Output ("WSL keepalive already running for distro '{0}'." -f $Distro)
  $existing | Select-Object ProcessId, CommandLine
  exit 0
}

$proc = Start-Process -FilePath "wsl.exe" `
  -ArgumentList @("-d", $Distro, "--", "bash", "-lc", "tail -f /dev/null") `
  -WindowStyle Hidden `
  -PassThru

Write-Output ("Started WSL keepalive for distro '{0}' (PID: {1})." -f $Distro, $proc.Id)
