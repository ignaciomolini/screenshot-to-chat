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

/** Script to read+resize+encode the clipboard image (used by readCapturedImage). */
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

/** Script to clear the clipboard (used by spawnSnipping before each capture). */
const CLEAR_CLIPBOARD_PS_SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Clipboard]::Clear()
`.trim();

/** Best-effort clipboard clear. Failures are swallowed because we never want a
 *  clear-clipboard error to block the capture flow — worst case the previous
 *  image stays on the clipboard (the original stale-image bug). */
async function clearClipboard(): Promise<void> {
  try {
    const proc = Bun.spawn(
      ["powershell", "-NoProfile", "-NonInteractive", "-Command", CLEAR_CLIPBOARD_PS_SCRIPT],
      { stdout: "pipe", stderr: "pipe" },
    );
    await proc.exited;
  } catch {
    // intentional no-op
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ── Capture ──────────────────────────────────────────────────────────────────

/**
 * Spawn SnippingTool.exe in /clip mode and disambiguate capture from cancel.
 *
 * Flow:
 *   1. Clear the clipboard (best-effort) so a stale image from a previous
 *      capture cannot leak into a new attempt.
 *   2. Spawn SnippingTool. It exits 0 on both capture AND Escape — the OS
 *      does not treat Escape as an error — so we cannot rely on exit code
 *      to distinguish them.
 *   3. After the tool exits, do a few quick read attempts (300ms total) to
 *      give the OS a moment to write the captured image to the clipboard.
 *      - Image present → user captured something, return ok.
 *      - Image still absent → user pressed Escape, return user_cancelled.
 */
export async function spawnSnipping(): Promise<
  | { ok: true }
  | {
      ok: false;
      error:
        | { type: "user_cancelled" }
        | { type: "tool_unavailable" }
        | { type: "spawn_failed"; message: string };
    }
> {
  await clearClipboard();

  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([SNIPPING_TOOL, "/clip"], {
      stderr: "pipe",
      stdout: "pipe",
    });
  } catch (e) {
    return {
      ok: false,
      error: { type: "spawn_failed", message: (e as Error).message },
    };
  }

  await proc.exited;
  if (proc.exitCode !== 0) {
    return { ok: false, error: { type: "tool_unavailable" } };
  }

  // Quick checks: up to 3 attempts × 100ms = ~300ms. If a real capture is
  // happening, the image will be on the clipboard well within this window
  // (SnippingTool writes synchronously before exiting on Windows).
  for (let i = 0; i < 3; i++) {
    const base64 = await readCapturedImage();
    if (base64) return { ok: true };
    await sleep(100);
  }

  return { ok: false, error: { type: "user_cancelled" } };
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
