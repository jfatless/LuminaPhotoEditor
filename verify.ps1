$root = $PSScriptRoot
$errors = @()

$required = @(
  "index.html",
  "css\styles.css",
  "js\filters.js",
  "js\engine.js",
  "js\tools.js",
  "js\forensics-engine.js",
  "js\face-restore.js",
  "js\forensics-tool.js",
  "js\ocr-preprocess.js",
  "js\font-id.js",
  "js\ocr.js",
  "js\app.js",
  "Launch-Lumina.bat",
  "Launch-Lumina.ps1",
  "Serve-Lumina.ps1"
)

foreach ($file in $required) {
  $path = Join-Path $root $file
  if (-not (Test-Path $path)) {
    $errors += "Missing: $file"
  }
}

$html = Get-Content (Join-Path $root "index.html") -Raw
$htmlChecks = @("autoEnhanceBtn", "helpModal", "loading", "canvasScroll", "ocrOverlay", "ocrScanBtn", "forensicOneClickBtn", "forensicsOverlay", "aiCompleteRestoreBtn", "aiFaceRestoreBtn", "Complete, Restore & 2× Enhance")
foreach ($check in $htmlChecks) {
  if ($html -notmatch [regex]::Escape($check)) {
    $errors += "index.html missing: $check"
  }
}

$app = Get-Content (Join-Path $root "js\app.js") -Raw
if ($app -notmatch "class LuminaApp") {
  $errors += "app.js missing: LuminaApp class"
}

$engine = Get-Content (Join-Path $root "js\engine.js") -Raw
$engineChecks = @("autoEnhance", "_getRotatedDimensions", "crop")
foreach ($check in $engineChecks) {
  if ($engine -notmatch $check) {
    $errors += "engine.js missing: $check"
  }
}

$forensics = Get-Content (Join-Path $root "js\forensics-tool.js") -Raw
$forensicsChecks = @("aiCompleteAndRestore", "enhanceFull(result, 2)", "detectMirrorNeeded")
foreach ($check in $forensicsChecks) {
  if ($forensics -notmatch [regex]::Escape($check)) {
    $errors += "forensics-tool.js missing: $check"
  }
}

$launch = Get-Content (Join-Path $root "Launch-Lumina.ps1") -Raw
if ($launch -notmatch "Serve-Lumina.ps1") {
  $errors += "Launch-Lumina.ps1 missing: Serve-Lumina.ps1 reference"
}

if ($errors.Count -eq 0) {
  Write-Host "All verification checks passed." -ForegroundColor Green
  exit 0
} else {
  Write-Host "Verification failed:" -ForegroundColor Red
  $errors | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
  exit 1
}