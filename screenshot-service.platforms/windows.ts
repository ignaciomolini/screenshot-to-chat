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
 *
 * Two capture paths are supported and selected at module-load time:
 *   - Legacy: `C:\Windows\System32\SnippingTool.exe /clip` — the classic
 *     Windows snipping tool. Exits 0 on both capture and Escape; the
 *     plugin distinguishes the two via clipboard polling (short window
 *     because the tool writes synchronously). Preferred on Windows 10
 *     and on Windows 11 builds that still ship the legacy binary —
 *     gives a familiar UI and no OS notification overlay.
 *   - Native: synthesises `Win+Shift+S` via keybd_event so the OS's
 *     own region selector appears (the modern experience, available on
 *     every Windows 10/11/Server build, including W11 24H2 where the
 *     legacy binary was removed from System32). Polls the clipboard
 *     for up to 10s.
 */

import { existsSync } from "node:fs";

// ── Constants ────────────────────────────────────────────────────────────────

/** Path to the legacy SnippingTool.exe binary (Windows 10 and some W11 builds). */
const LEGACY_SNIPPING_TOOL = "C:\\Windows\\System32\\SnippingTool.exe";

/** Whether the legacy snipping tool is available on this machine. Decided once at
 *  module load. On W11 24H2 (and any build where the legacy was removed) this
 *  is false and we use the native Win+Shift+S path instead. */
const USE_LEGACY = existsSync(LEGACY_SNIPPING_TOOL);

/**
 * PowerShell script that triggers the system-wide region-select capture via
 * `Win+Shift+S`. Works on every Windows build (10/11/Server) regardless of
 * whether the legacy SnippingTool.exe is in System32 or only the UWP
 * Microsoft.ScreenSketch app is installed — the Win+Shift+S shortcut is
 * handled by the OS itself and produces the same clipboard image either
 * way. The script simulates the keystroke with P/Invoke to user32.dll's
 * keybd_event and exits immediately (~100ms); the actual selection is done
 * by the user in the OS-provided region selector.
 */
const SCREEN_CAPTURE_PS_SCRIPT = `
Add-Type -MemberDefinition @"
[DllImport("user32.dll", SetLastError = true)]
public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, IntPtr dwExtraInfo);
"@ -Name "Win32User32" -Namespace "Native" -PassThru | Out-Null

$VK_LWIN = 0x5B
$VK_LSHIFT = 0xA0
$VK_S = 0x53
$KEYEVENTF_KEYUP = 0x0002

# Key down: Win+Shift+S
[Native.Win32User32]::keybd_event($VK_LWIN, 0, 0, [IntPtr]::Zero)
[Native.Win32User32]::keybd_event($VK_LSHIFT, 0, 0, [IntPtr]::Zero)
[Native.Win32User32]::keybd_event($VK_S, 0, 0, [IntPtr]::Zero)

# Brief delay so the OS registers the combo and opens the selector
Start-Sleep -Milliseconds 150

# Key up
[Native.Win32User32]::keybd_event($VK_S, 0, $KEYEVENTF_KEYUP, [IntPtr]::Zero)
[Native.Win32User32]::keybd_event($VK_LSHIFT, 0, $KEYEVENTF_KEYUP, [IntPtr]::Zero)
[Native.Win32User32]::keybd_event($VK_LWIN, 0, $KEYEVENTF_KEYUP, [IntPtr]::Zero)

exit 0
`.trim();

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
 * Spawn the snipping tool and disambiguate capture from cancel.
 *
 * Picks the legacy or native path at module load based on whether
 * `C:\Windows\System32\SnippingTool.exe` exists (see `USE_LEGACY`).
 *
 * Legacy path (when USE_LEGACY = true):
 *   1. Clear the clipboard (best-effort).
 *   2. Spawn SnippingTool.exe in /clip mode. It exits 0 on both capture
 *      AND Escape — the OS does not treat Escape as an error — so we
 *      cannot use exit code to distinguish them.
 *   3. After the tool exits, do a few quick read attempts (~300ms total)
 *      to give the OS a moment to write the captured image to the
 *      clipboard.
 *      - Image present → user captured something, return ok.
 *      - Image still absent → user pressed Escape, return user_cancelled.
 *
 * Native path (when USE_LEGACY = false, e.g. W11 24H2 with no legacy):
 *   1. Clear the clipboard (best-effort).
 *   2. Spawn a PowerShell process that synthesises `Win+Shift+S` via
 *      keybd_event. The OS opens the region selector; the user selects.
 *      The script exits ~150ms after the keystroke — we cannot use exit
 *      code to distinguish capture from cancel, so:
 *   3. Poll the clipboard for up to 10s. Image present → ok; empty after
 *      10s → user_cancelled. (10s is shorter than the 30s we used before
 *      because the user reported the long wait after Escape was painful;
 *      10s is still plenty for a normal selection.)
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

  if (USE_LEGACY) {
    return spawnSnippingLegacy();
  } else {
    return spawnSnippingNative();
  }
}

/** Legacy capture path: spawn SnippingTool.exe /clip directly. */
async function spawnSnippingLegacy(): Promise<
  | { ok: true }
  | {
      ok: false;
      error:
        | { type: "user_cancelled" }
        | { type: "tool_unavailable" }
        | { type: "spawn_failed"; message: string };
    }
> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([LEGACY_SNIPPING_TOOL, "/clip"], {
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

  // Legacy tool writes synchronously before exiting. A few short polls
  // (~300ms total) is enough to detect capture vs cancel.
  for (let i = 0; i < 3; i++) {
    const base64 = await readCapturedImage();
    if (base64) return { ok: true };
    await sleep(100);
  }

  return { ok: false, error: { type: "user_cancelled" } };
}

/** Native capture path: synthesise Win+Shift+S via keybd_event, then poll
 *  the clipboard for up to 10s for the captured image. */
async function spawnSnippingNative(): Promise<
  | { ok: true }
  | {
      ok: false;
      error:
        | { type: "user_cancelled" }
        | { type: "tool_unavailable" }
        | { type: "spawn_failed"; message: string };
    }
> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(
      ["powershell", "-NoProfile", "-NonInteractive", "-Command", SCREEN_CAPTURE_PS_SCRIPT],
      { stderr: "pipe", stdout: "pipe" },
    );
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

  const pollStart = Date.now();
  const pollTimeoutMs = 10_000;
  while (Date.now() - pollStart < pollTimeoutMs) {
    const base64 = await readCapturedImage();
    if (base64) return { ok: true };
    await sleep(500);
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
