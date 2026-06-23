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

/**
 * Returns a mock for `Bun.spawn` that hands out a sequence of pre-canned
 * responses. Each call to the mock pops the next response; if the test
 * exhausts the queue, an "empty stdout, exit 0" default is returned.
 *
 * `spawnSnipping` does N spawn calls (1 clear, 1 snipping, 0-3 read attempts),
 * so the queue is the cleanest way to fake the multi-step flow.
 */
function makeSequenceMock(
  responses: Array<Partial<{
    stdout: ReadableStream<Uint8Array> | null;
    stderr: ReadableStream<Uint8Array> | null;
    exitCode: number;
    throw: Error | null;
  }>>,
) {
  let i = 0;
  return mock((() => {
    const r = responses[i++] ?? {};
    if (r.throw) throw r.throw;
    return {
      stdout: r.stdout ?? new Response("").body,
      stderr: r.stderr ?? new Response("").body,
      exitCode: r.exitCode ?? 0,
      exited: Promise.resolve(r.exitCode ?? 0),
      pid: 1234,
      kill: mock(() => {}),
      ref: mock(() => {}),
      unref: mock(() => {}),
    };
  }) as typeof Bun.spawn);
}

describe("windows", () => {
  let originalSpawn: typeof Bun.spawn;

  beforeEach(() => {
    originalSpawn = Bun.spawn;
  });

  afterEach(() => {
    (Bun as any).spawn = originalSpawn;
  });

  // ── spawnSnipping ─────────────────────────────────────────────────────────

  itWin("spawnSnipping returns ok when an image lands on the clipboard", async () => {
    const fakeBase64 = "iVBORw0KGgoAAAANSUhEUg==";
    // Queue: [1] clear-clipboard, [2] SnippingTool, [3] read attempt 1 (image present)
    (Bun as any).spawn = makeSequenceMock([
      { exitCode: 0 },                                          // clearClipboard
      { exitCode: 0 },                                          // SnippingTool
      { stdout: new Response(fakeBase64 + "\n").body },         // readClipboard → image
    ]);

    const result = await spawnSnipping();
    expect(result).toEqual({ ok: true });
  });

  itWin("spawnSnipping returns user_cancelled when no image after SnippingTool exit", async () => {
    // Queue: [1] clear, [2] SnippingTool, [3..N] empty read attempts until poll times out.
    // The poll now runs for ~30s (was ~300ms); give the test a 35s timeout so the
    // full poll window can elapse. After the explicit mocks, the makeSequenceMock
    // default (empty stdout, exit 0) keeps returning "no image" until Date.now()
    // advances past the timeout.
    (Bun as any).spawn = makeSequenceMock([
      { exitCode: 0 },                              // clearClipboard
      { exitCode: 0 },                              // SnippingTool exits 0
      { stdout: new Response("\n").body },          // read attempt 1: empty
      { stdout: new Response("\n").body },          // read attempt 2: empty
      { stdout: new Response("\n").body },          // read attempt 3: empty
    ]);

    const result = await spawnSnipping();
    expect(result).toEqual({ ok: false, error: { type: "user_cancelled" } });
  }, 35_000);

  itWin("spawnSnipping returns tool_unavailable on non-zero exit", async () => {
    (Bun as any).spawn = makeSequenceMock([
      { exitCode: 0 },                              // clearClipboard (succeeds)
      { exitCode: 1 },                              // SnippingTool exits non-zero
    ]);

    const result = await spawnSnipping();
    expect(result).toEqual({ ok: false, error: { type: "tool_unavailable" } });
  });

  itWin("spawnSnipping returns spawn_failed when SnippingTool spawn throws", async () => {
    // clearClipboard succeeds; SnippingTool spawn throws (the catch around
    // the actual snipping spawn is the only place this can fail through).
    (Bun as any).spawn = makeSequenceMock([
      { exitCode: 0 },                              // clearClipboard
      { throw: new Error("ENOENT") },              // SnippingTool spawn throws
    ]);

    const result = await spawnSnipping();
    expect(result).toEqual({
      ok: false,
      error: { type: "spawn_failed", message: "ENOENT" },
    });
  });

  itWin("spawnSnipping does not block capture if clearClipboard fails", async () => {
    // If the clear-clipboard spawn itself throws, we swallow it and continue
    // (worst case: a stale image from a previous capture might be picked up —
    // that's the original bug, not a new one).
    (Bun as any).spawn = makeSequenceMock([
      { throw: new Error("clipboard locked") },    // clearClipboard throws
      { exitCode: 0 },                              // SnippingTool succeeds
      { stdout: new Response("YWJj").body },       // readClipboard returns image
    ]);

    const result = await spawnSnipping();
    expect(result).toEqual({ ok: true });
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
