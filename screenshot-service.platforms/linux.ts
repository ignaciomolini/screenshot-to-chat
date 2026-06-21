/**
 * Linux screenshot capture — STUB.
 *
 * Real implementation lands in Phase 3 of the multi-platform chain
 * (PR 3) with X11/Wayland session detection, scrot/maim/grim+slurp/
 * gnome-screenshot/spectacle fallback chain, and ImageMagick resize.
 * This file exists so the dispatcher can resolve the import on every
 * host.
 *
 * If the dispatcher ever routes to this stub at runtime, it means the
 * real Linux implementation has not landed yet.
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
