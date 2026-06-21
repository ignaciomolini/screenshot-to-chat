/**
 * Windows screenshot capture — SnippingTool /clip + PowerShell clipboard read.
 *
 * Exports `spawnSnipping` and `readCapturedImage`. The dispatcher in
 * `screenshot-service.ts` re-exports these (or routes to macOS / Linux on
 * other platforms). Until Phase 3, `screenshot-service.ts` shims the
 * Windows module as the default for backwards compatibility.
 *
 * The PowerShell script bakes MAX_DIMENSION (1568) and JPEG_QUALITY (75)
 * directly so the module has no dependency on `screenshot-service.ts`
 * (which would create a circular import). The dispatcher still exports
 * the same constants for external consumers.
 */

// ── Constants ────────────────────────────────────────────────────────────────

/** Windows snipping tool executable. */
export const SNIPPING_TOOL = "SnippingTool.exe";

/** Resize target longest edge (px) — matches dispatcher MAX_DIMENSION. */
const MAX_DIMENSION = 1568;

/** JPEG quality (0-100) — matches dispatcher JPEG_QUALITY. */
const JPEG_QUALITY = 75;

// ── PowerShell clipboard script ──────────────────────────────────────────────

const CLIPBOARD_PS_SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($img) {
    $maxDim = ${MAX_DIMENSION}
    $newW = $img.Width
    $newH = $img.Height
    if ($newW -gt $maxDim -or $newH -gt $maxDim) {
        $ratio = [Math]::Min($maxDim / $newW, $maxDim / $newH)
        $newW = [int]($newW * $ratio)
        $newH = [int]($newH * $ratio)
        $bmp = New-Object System.Drawing.Bitmap($newW, $newH)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.SmoothingMode = [System.Drawing.SmoothingMode]::HighQuality
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.DrawImage($img, 0, 0, $newW, $newH)
        $g.Dispose()
        $img.Dispose()
        $img = $bmp
    }
    $ms = New-Object System.IO.MemoryStream
    $jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
    $encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]${JPEG_QUALITY})
    $img.Save($ms, $jpegCodec, $encoderParams)
    [Convert]::ToBase64String($ms.ToArray())
    $ms.Dispose()
    $img.Dispose()
}
`.trim();

// ── Capture ──────────────────────────────────────────────────────────────────

/**
 * Spawn SnippingTool.exe in /clip mode.
 * Resolves when the process exits (user finishes or cancels capture).
 */
export async function spawnSnipping(): Promise<
  { ok: true } | { ok: false; error: { type: "tool_unavailable" } | { type: "spawn_failed"; message: string } }
> {
  try {
    const proc = Bun.spawn([SNIPPING_TOOL, "/clip"], {
      stderr: "pipe",
      stdout: "pipe",
    });
    await proc.exited;
    if (proc.exitCode !== 0) {
      return { ok: false, error: { type: "tool_unavailable" } };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: { type: "spawn_failed", message: (e as Error).message },
    };
  }
}

/**
 * Read an image from the Windows clipboard via PowerShell.
 * Returns base64-encoded JPEG string (resized to MAX_DIMENSION, quality JPEG_QUALITY),
 * or null if no image is on the clipboard.
 */
export async function readCapturedImage(): Promise<string | null> {
  try {
    const proc = Bun.spawn(
      ["powershell", "-NoProfile", "-NonInteractive", "-Command", CLIPBOARD_PS_SCRIPT],
      { stdout: "pipe", stderr: "pipe" },
    );
    const output = await new Response(proc.stdout).text();
    await proc.exited;

    const base64 = output.trim();
    if (!base64 || proc.exitCode !== 0) return null;
    return base64;
  } catch {
    return null;
  }
}
