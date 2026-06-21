/**
 * Windows-specific tests for the platform module.
 *
 * The `itWin` guard makes the suite skip cleanly on non-Windows hosts —
 * `it.skip` keeps the test count and the failure count stable, so CI on
 * Mac/Linux does not see phantom failures.
 */

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

const itWin = process.platform === "win32" ? it : it.skip;

import { spawnSnipping, readCapturedImage } from "./windows.ts";

describe("windows", () => {
  let originalSpawn: typeof Bun.spawn;

  beforeEach(() => {
    originalSpawn = Bun.spawn;
  });

  afterEach(() => {
    (Bun as any).spawn = originalSpawn;
  });

  // ── spawnSnipping ─────────────────────────────────────────────────────────

  itWin("spawnSnipping returns ok when SnippingTool exits 0", async () => {
    (Bun as any).spawn = mock(() => ({
      stdout: new Response("").body,
      stderr: new Response("").body,
      exitCode: 0,
      exited: Promise.resolve(0),
      pid: 1234,
      kill: mock(() => {}),
      ref: mock(() => {}),
      unref: mock(() => {}),
    }));

    const result = await spawnSnipping();
    expect(result).toEqual({ ok: true });
  });

  itWin("spawnSnipping returns tool_unavailable on non-zero exit", async () => {
    (Bun as any).spawn = mock(() => ({
      stdout: new Response("").body,
      stderr: new Response("").body,
      exitCode: 1,
      exited: Promise.resolve(1),
      pid: 1234,
      kill: mock(() => {}),
      ref: mock(() => {}),
      unref: mock(() => {}),
    }));

    const result = await spawnSnipping();
    expect(result).toEqual({ ok: false, error: { type: "tool_unavailable" } });
  });

  itWin("spawnSnipping returns spawn_failed when Bun.spawn throws", async () => {
    (Bun as any).spawn = mock(() => {
      throw new Error("ENOENT");
    });

    const result = await spawnSnipping();
    expect(result).toEqual({
      ok: false,
      error: { type: "spawn_failed", message: "ENOENT" },
    });
  });

  // ── readCapturedImage ─────────────────────────────────────────────────────

  itWin("readCapturedImage returns base64 string when clipboard has image", async () => {
    const fakeBase64 = "iVBORw0KGgoAAAANSUhEUg==";
    const fakeStdout = new Response(fakeBase64 + "\n").body;

    (Bun as any).spawn = mock(() => ({
      stdout: fakeStdout,
      stderr: new Response("").body,
      exitCode: 0,
      exited: Promise.resolve(0),
      pid: 1234,
      kill: mock(() => {}),
      ref: mock(() => {}),
      unref: mock(() => {}),
    }));

    const result = await readCapturedImage();
    expect(result).toBe(fakeBase64);
  });

  itWin("readCapturedImage returns null when clipboard has no image", async () => {
    const fakeStdout = new Response("\n").body;

    (Bun as any).spawn = mock(() => ({
      stdout: fakeStdout,
      stderr: new Response("").body,
      exitCode: 0,
      exited: Promise.resolve(0),
      pid: 1234,
      kill: mock(() => {}),
      ref: mock(() => {}),
      unref: mock(() => {}),
    }));

    const result = await readCapturedImage();
    expect(result).toBeNull();
  });

  itWin("readCapturedImage returns null when PowerShell fails", async () => {
    const fakeStdout = new Response("").body;

    (Bun as any).spawn = mock(() => ({
      stdout: fakeStdout,
      stderr: new Response("error").body,
      exitCode: 1,
      exited: Promise.resolve(1),
      pid: 1234,
      kill: mock(() => {}),
      ref: mock(() => {}),
      unref: mock(() => {}),
    }));

    const result = await readCapturedImage();
    expect(result).toBeNull();
  });

  itWin("readCapturedImage returns null when spawn throws", async () => {
    (Bun as any).spawn = mock(() => {
      throw new Error("ENOENT");
    });

    const result = await readCapturedImage();
    expect(result).toBeNull();
  });
});
