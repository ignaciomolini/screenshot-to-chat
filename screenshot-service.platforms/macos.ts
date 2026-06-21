/**
 * macOS screenshot capture — `screencapture -i` + `sips` resize + base64.
 *
 * Exports `spawnSnipping` and `readCapturedImage`. The dispatcher in
 * `screenshot-service.ts` re-exports these (or routes to Windows / Linux
 * on other platforms).
 *
 * Capture flow (per design §4.b, §4.c, §4.j, §4.k):
 *   1. `screencapture -i /tmp/screenshot-to-chat-<uuid>.png` — interactive
 *      region OR window. Without `-i`, `screencapture` is silent full-screen.
 *   2. On exit, `Bun.file(path).exists()` distinguishes two cases:
 *      - No file → user pressed Escape → `user_cancelled`.
 *      - File present → capture succeeded → `{ ok: true }`.
 *   3. `readCapturedImage` reads the captured PNG, detects Screen
 *      Recording permission denial (size < 4 KB), resizes to JPEG via
 *      `sips`, base64-encodes, and cleans up temp files in `finally`.
 */

import type { CaptureError } from "../screenshot-service.ts";

/** Directory for temp capture files. `/tmp` is world-writable on macOS. */
const TMP_DIR = "/tmp";

/**
 * Captured PNG below this byte size is treated as a TCC permission
 * denial. When Screen Recording is denied, macOS's TCC stack writes a
 * near-empty placeholder PNG (~200–3000 bytes) instead of the real
 * pixels. 4 KB is well above that ceiling but well below any real-region
 * screenshot (per design §4.c).
 */
const MIN_CAPTURE_BYTES = 4096;

/** Resize target longest edge (px) — matches dispatcher `MAX_DIMENSION`. */
const MAX_DIMENSION = 1568;

/** JPEG quality (0-100) — matches dispatcher `JPEG_QUALITY`. */
const JPEG_QUALITY = 75;

/**
 * Default `fix` string for `permission_missing` — direct display in a toast.
 * Per design §4.m: points to System Settings → Privacy & Security → Screen
 * Recording. Exported so the test suite (and future localizers) can
 * reference the canonical English copy.
 */
export const MACOS_PERMISSION_FIX =
  "macOS Screen Recording permission required. Open System Settings → Privacy & Security → Screen Recording and enable access for this terminal.";

/**
 * Build the temp PNG + JPEG paths for a capture attempt. Uses
 * `crypto.randomUUID` to keep concurrent attempts from clobbering each
 * other on the shared `/tmp` directory. Per design §4.j.
 */
function buildCapturePaths(): { png: string; jpg: string } {
  const png = `${TMP_DIR}/screenshot-to-chat-${crypto.randomUUID()}.png`;
  const jpg = png.replace(/\.png$/, ".jpg");
  return { png, jpg };
}

/**
 * Spawn `screencapture -i` for an interactive region / window capture.
 * Resolves when the process exits.
 *
 * Outcomes:
 * - exit 0 + file written  → `{ ok: true }`
 * - exit 0 + no file        → `{ ok: false, error: { type: "user_cancelled" } }` (Escape)
 * - non-zero exit           → `{ ok: false, error: { type: "tool_unavailable" } }`
 * - `Bun.spawn` throws      → `{ ok: false, error: { type: "spawn_failed", message } }`
 */
export async function spawnSnipping(): Promise<
  { ok: true } | { ok: false; error: CaptureError }
> {
  const tmpPath = buildCapturePaths().png;
  try {
    const proc = Bun.spawn(["screencapture", "-i", tmpPath], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    if (proc.exitCode !== 0) {
      return { ok: false, error: { type: "tool_unavailable" } };
    }
    // Exit 0 is ambiguous: success OR user pressed Escape. The presence
    // of the output file disambiguates — `screencapture` only writes on
    // a confirmed capture (per design §4.b).
    const exists = await Bun.file(tmpPath).exists();
    if (!exists) {
      return { ok: false, error: { type: "user_cancelled" } };
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
 * Read the captured PNG: detect permission denial, resize to JPEG via
 * `sips`, base64-encode, and clean up temp files in `finally`.
 *
 * Return shape (per design ADR-7):
 * - `string` — base64-encoded JPEG.
 * - `null`   — no capture file present (nothing to read).
 * - `{ ok: false; error: { type: "permission_missing", ... } }` — Screen
 *   Recording permission was denied; the placeholder PNG was detected
 *   by the size heuristic. The dispatcher's `pollClipboard` recognizes
 *   this form and short-circuits instead of waiting for `poll_timeout`.
 */
export async function readCapturedImage(): Promise<
  string | null | { ok: false; error: CaptureError }
> {
  const { png, jpg } = buildCapturePaths();
  try {
    const file = Bun.file(png);
    if (!(await file.exists())) return null;

    // Permission heuristic: a real-region screenshot is always > 4 KB.
    // Anything smaller is the TCC placeholder PNG (per design §4.c).
    if (file.size < MIN_CAPTURE_BYTES) {
      return {
        ok: false,
        error: {
          type: "permission_missing",
          platform: "darwin",
          fix: MACOS_PERMISSION_FIX,
        },
      };
    }

    // Resize + encode: sips -Z 1568 -s format jpeg -s formatOptions 75
    // fits the longest edge to 1568px without upscaling, outputs JPEG q75
    // (per design §4.a).
    const sips = Bun.spawn(
      [
        "sips",
        "-Z", String(MAX_DIMENSION),
        "-s", "format", "jpeg",
        "-s", "formatOptions", String(JPEG_QUALITY),
        png,
        "--out", jpg,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const sipsExit = await sips.exited;
    if (sipsExit !== 0) return null;

    // Base64-encode the JPEG. BSD's `base64` lacks GNU's `-w 0` flag for
    // disabling line wrapping, so we pipe through `tr -d '\n'` (per
    // design §4.d). `sh -c` keeps the pipeline as a single Bun.spawn call.
    const b64 = Bun.spawn(
      ["sh", "-c", `base64 -i ${jpg} | tr -d '\\n'`],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [output, b64Exit] = await Promise.all([
      new Response(b64.stdout).text(),
      b64.exited,
    ]);
    if (b64Exit !== 0) return null;
    const base64 = output.trim();
    if (!base64) return null;
    return base64;
  } finally {
    // Cleanup both temp files in a single rm, regardless of which branch
    // returned. `rm -f` swallows missing files so partial-failure paths
    // still clean up cleanly (per design §4.k). The input PNG is cleaned
    // here per task 4.3; the jpg is cleaned in the same call.
    try {
      await Bun.spawn(["rm", "-f", png, jpg]).exited;
    } catch {
      // Best-effort: a rm failure must not mask the real result.
    }
  }
}
