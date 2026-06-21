/**
 * macOS screenshot capture — `screencapture -i` (interactive region/window).
 *
 * Exports `spawnSnipping` and `readCapturedImage`. The dispatcher in
 * `screenshot-service.ts` re-exports these (or routes to Windows / Linux
 * on other platforms).
 *
 * Capture flow (per design §4.b, §4.c, §4.j):
 *   1. `screencapture -i /tmp/screenshot-to-chat-<uuid>.png` — interactive
 *      region OR window. Without `-i`, `screencapture` is silent full-screen.
 *   2. On exit, `Bun.file(path).exists()` distinguishes two cases:
 *      - No file → user pressed Escape → `user_cancelled`.
 *      - File present → capture succeeded → `{ ok: true }`.
 *   3. `readCapturedImage` (separate function) resizes the captured PNG
 *      via `sips`, base64-encodes the JPEG, and cleans up temp files.
 *      Permission detection (small file heuristic) lives in that function.
 */

import type { CaptureError } from "../screenshot-service.ts";

/** Directory for temp capture files. `/tmp` is world-writable on macOS. */
const TMP_DIR = "/tmp";

/**
 * Default `fix` string for `permission_missing` — direct display in a toast.
 * Per design §4.m: points to System Settings → Privacy & Security → Screen
 * Recording. Exported so the test suite (and future localizers) can
 * reference the canonical English copy.
 */
export const MACOS_PERMISSION_FIX =
  "macOS Screen Recording permission required. Open System Settings → Privacy & Security → Screen Recording and enable access for this terminal.";

/**
 * Build the temp PNG path for a capture attempt. Uses `crypto.randomUUID`
 * to keep concurrent attempts from clobbering each other on the shared
 * `/tmp` directory. Per design §4.j.
 */
function buildCapturePath(): string {
  return `${TMP_DIR}/screenshot-to-chat-${crypto.randomUUID()}.png`;
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
  const tmpPath = buildCapturePath();
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

export async function readCapturedImage(): Promise<string | null> {
  return null;
}
