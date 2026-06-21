/**
 * macOS screenshot capture — STUB.
 *
 * Real implementation lands in Phase 2 of the multi-platform chain
 * (PR 2). This file exists so the dispatcher in `screenshot-service.ts`
 * can `import * as macos from "./macos.ts"` and resolve on every host.
 *
 * If `screencapture`/`sips` capture ever runs in this stub, it means
 * someone forgot to replace this with the real macOS implementation.
 */

import type { CaptureError } from "../screenshot-service.ts";

export async function spawnSnipping(): Promise<
  { ok: true } | { ok: false; error: CaptureError }
> {
  return {
    ok: false,
    error: { type: "tool_unavailable" },
  };
}

export async function readCapturedImage(): Promise<string | null> {
  return null;
}
