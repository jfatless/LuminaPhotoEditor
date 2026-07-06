param(
  [int]$Port = 8847,
  [string]$Root = $PSScriptRoot
)

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.webp' = 'image/webp'
  '.gif'  = 'image/gif'
  '.svg'  = 'image/svg+xml'
  '.json' = 'application/json'
  '.ico'  = 'image/x-icon'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()

Write-Host "Lumina server running at http://127.0.0.1:$Port/" -ForegroundColor Magenta
Write-Host "Serving: $Root" -ForegroundColor DarkGray
Write-Host "Press Ctrl+C to stop." -ForegroundColor DarkGray

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response

    $path = [Uri]::UnescapeDataString($request.Url.LocalPath)
    if ($path -eq '/' -or $path -eq '') { $path = '/index.html' }

    $relative = $path.TrimStart('/').Replace('/', [IO.Path]::DirectorySeparatorChar)
    $file = Join-Path $Root $relative

    if ((Test-Path $file -PathType Leaf)) {
      $ext = [IO.Path]::GetExtension($file).ToLowerInvariant()
      $contentType = $mime[$ext]
      if (-not $contentType) { $contentType = 'application/octet-stream' }
      $bytes = [IO.File]::ReadAllBytes($file)
      $response.StatusCode = 200
      $response.ContentType = $contentType
      $response.ContentLength64 = $bytes.Length
      $response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $response.StatusCode = 404
      $msg = [Text.Encoding]::UTF8.GetBytes('Not found')
      $response.ContentType = 'text/plain'
      $response.ContentLength64 = $msg.Length
      $response.OutputStream.Write($msg, 0, $msg.Length)
    }

    $response.OutputStream.Close()
  }
} finally {
  $listener.Stop()
  $listener.Close()
}