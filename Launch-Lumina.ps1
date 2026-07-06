$root = $PSScriptRoot
$port = 8847
$serveScript = Join-Path $root 'Serve-Lumina.ps1'

function Test-PortFree([int]$p) {
  try {
    $l = New-Object System.Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $p)
    $l.Start()
    $l.Stop()
    return $true
  } catch { return $false }
}

while (-not (Test-PortFree $port) -and $port -lt 8900) { $port++ }

Start-Process powershell -ArgumentList @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass',
  '-File', "`"$serveScript`"",
  '-Port', $port,
  '-Root', "`"$root`""
) -WindowStyle Minimized

Start-Sleep -Seconds 1
Start-Process "http://127.0.0.1:$port/"
Write-Host "Lumina Photo Editor launched at http://127.0.0.1:$port/" -ForegroundColor Magenta
Write-Host "AI face tools require this local server (not file://)." -ForegroundColor DarkGray