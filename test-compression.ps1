# test-compression.ps1
# Standalone test for the screenshot compression in screenshot-service.ts
# Reads whatever is on the clipboard, compresses it the same way the plugin does,
# and saves BOTH versions to disk so you can compare sizes.

param(
    [string]$OutDir = "C:\Users\Nacho\Desktop\compression-test"
)

# ── Setup ─────────────────────────────────────────────────────────────────────
Add-Type -AssemblyName System.Windows.Forms
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

# ── Read clipboard ────────────────────────────────────────────────────────────
$img = [System.Windows.Forms.Clipboard]::GetImage()
if (-not $img) {
    Write-Host "ERROR: no image on the clipboard. Take a screenshot first (Win+Shift+S)." -ForegroundColor Red
    exit 1
}

$origW = $img.Width
$origH = $img.Height
Write-Host ""
Write-Host "Original image: ${origW} x ${origH} px" -ForegroundColor White

# ── Save ORIGINAL (PNG, uncompressed) for comparison ──────────────────────────
$pngPathUncompressed = Join-Path $OutDir "original-uncompressed-$timestamp.png"
$img.Save($pngPathUncompressed, [System.Drawing.Imaging.ImageFormat]::Png)
$origSize = (Get-Item $pngPathUncompressed).Length

# ── Compress: resize to 1568px + JPEG q75 (mirrors screenshot-service.ts) ─────
$maxDim = 1568
$quality = 75
$newW = $origW
$newH = $origH
$wasResized = $false

if ($newW -gt $maxDim -or $newH -gt $maxDim) {
    $ratio = [Math]::Min($maxDim / $newW, $maxDim / $newH)
    $newW = [int]($newW * $ratio)
    $newH = [int]($newH * $ratio)
    $bmp = New-Object System.Drawing.Bitmap($newW, $newH)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($img, 0, 0, $newW, $newH)
    $g.Dispose()
    $img.Dispose()
    $img = $bmp
    $wasResized = $true
}

# Save as JPEG q75
$jpegPath = Join-Path $OutDir "compressed-$timestamp.jpg"
$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
$encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$quality)
$img.Save($jpegPath, $jpegCodec, $encoderParams)
$img.Dispose()

# ── Report ───────────────────────────────────────────────────────────────────
$compressedSize = (Get-Item $jpegPath).Length
$reduction = (1 - ($compressedSize / $origSize)) * 100
$origKB = [math]::Round($origSize / 1KB, 1)
$compKB = [math]::Round($compressedSize / 1KB, 1)
$resizeNote = if ($wasResized) { " (resized from ${origW}x${origH})" } else { "" }

Write-Host ""
Write-Host "RESULTS" -ForegroundColor Cyan
Write-Host "  Original PNG : ${origW}x${origH}  $origKB KB" -ForegroundColor Yellow
Write-Host "  Compressed   : ${newW}x${newH}$resizeNote  $compKB KB (JPEG q$quality)" -ForegroundColor Green
Write-Host "  Reduction    : $([math]::Round($reduction, 1))%" -ForegroundColor Green
Write-Host ""
Write-Host "  Files saved to: $OutDir" -ForegroundColor Gray
Write-Host "    uncompressed: $pngPathUncompressed"
Write-Host "    compressed  : $jpegPath"
Write-Host ""
Write-Host "Open both files in your image viewer to compare quality visually." -ForegroundColor Gray
Write-Host ""
