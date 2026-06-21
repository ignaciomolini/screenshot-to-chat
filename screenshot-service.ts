/**
 * Screenshot capture service — pure/async functions, types, and a platform
 * dispatcher. The dispatcher routes `spawnSnipping` and `readCapturedImage`
 * to the per-platform module matching `process.platform`. Shared helpers
 * (`validateSize`, `buildFilePart`, `encodeFileToBase64`, `pollClipboard`)
 * live here and are platform-agnostic.
 *
 * Extracted from the plugin entry point to enable unit/integration testing.
 */

// ── Constants ────────────────────────────────────────────────────────────────

/** Polling interval for clipboard checks (ms). */
export const POLL_INTERVAL_MS = 500;

/** Maximum time to wait for clipboard image (ms). */
export const POLL_TIMEOUT_MS = 30_000;

/** Maximum allowed image size in bytes (3 MB — safe-net limit; well above what JPEG q75 @ 1568px produces). */
export const MAX_IMAGE_BYTES = 3_145_728;

/** Maximum width/height in pixels — anything larger is downscaled preserving aspect ratio. */
export const MAX_DIMENSION = 1568;

/** JPEG quality (0-100). 75 is the sweet spot for screenshots: small files, readable text. */
export const JPEG_QUALITY = 75;

// ── Platform modules (re-exports) ────────────────────────────────────────────

// Phase 2 transitional shim — the Windows module owns the live implementation;
// the dispatcher in Phase 3 will pick the right platform module at module load.
// These re-exports keep the public surface (`spawnSnipping`, `readCapturedImage`)
// stable so the existing entry point and tests work without changes.
import { spawnSnipping, readCapturedImage } from "./screenshot-service.platforms/windows.ts";
export { spawnSnipping, readCapturedImage };

// ── Types ────────────────────────────────────────────────────────────────────

export type CaptureError =
  | { type: "platform_unsupported"; platform: string }
  | { type: "tool_unavailable" }
  | { type: "user_cancelled" }
  | { type: "poll_timeout" }
  | { type: "size_exceeded"; sizeBytes: number; limitBytes: number }
  | { type: "spawn_failed"; message: string }
  | { type: "permission_missing"; platform: "darwin"; fix: string };

export type CaptureResult =
  | { ok: true; base64: string; sizeBytes: number }
  | { ok: false; error: CaptureError };

export interface FilePart {
  type: "file";
  mime: "image/jpeg";
  url: string;
  filename: string;
}

// ── Pure functions ───────────────────────────────────────────────────────────

/**
 * Validate that a base64-encoded image does not exceed the size limit.
 * Checks the byte length of the base64 string (UTF-8 encoded ≈ raw size).
 * For JPEG at quality 75 with max 1568px, the result will be well under this limit.
 */
export function validateSize(base64: string): CaptureResult {
  const sizeBytes = new TextEncoder().encode(base64).byteLength;
  if (sizeBytes > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      error: { type: "size_exceeded", sizeBytes, limitBytes: MAX_IMAGE_BYTES },
    };
  }
  return { ok: true, base64, sizeBytes };
}

/**
 * Build a FilePart suitable for `session.prompt({ parts, noReply: true })`.
 * The `url` is a base64 data URL so the image travels inline — no temp files.
 */
export function buildFilePart(base64: string): FilePart {
  return {
    type: "file" as const,
    mime: "image/jpeg" as const,
    url: `data:image/jpeg;base64,${base64}`,
    filename: "screenshot.jpg",
  };
}

/**
 * Read a file from disk and return its base64-encoded contents.
 * Returns `null` if the file is missing, empty, or cannot be read.
 *
 * Does NOT delete the file — cleanup is the caller's responsibility (wrap
 * the call in a `try/finally` if the file is a temp artifact).
 */
export async function encodeFileToBase64(path: string): Promise<string | null> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    const buffer = await file.arrayBuffer();
    if (buffer.byteLength === 0) return null;
    return Buffer.from(buffer).toString("base64");
  } catch {
    return null;
  }
}

// ── Async functions (Bun.spawn) ──────────────────────────────────────────────

/**
 * Poll the clipboard for a new image after SnippingTool exits.
 * Checks every POLL_INTERVAL_MS up to POLL_TIMEOUT_MS.
 */
export async function pollClipboard(): Promise<CaptureResult> {
  const maxAttempts = POLL_TIMEOUT_MS / POLL_INTERVAL_MS;

  for (let i = 0; i < maxAttempts; i++) {
    const base64 = await readCapturedImage();
    if (base64) return { ok: true, base64, sizeBytes: base64.length };
    await sleep(POLL_INTERVAL_MS);
  }

  return { ok: false, error: { type: "poll_timeout" } };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
