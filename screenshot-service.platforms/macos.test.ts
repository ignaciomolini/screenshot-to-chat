/**
 * macOS-specific tests for the platform module.
 *
 * The `itMac` guard makes the suite skip cleanly on non-darwin hosts —
 * `it.skip` keeps the test count and the failure count stable, so CI on
 * Windows/Linux does not see phantom failures. The module compiles on
 * every host (TypeScript checks the test file), so `bunx tsc --noEmit`
 * passes regardless of the runtime platform.
 */

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

const itMac = process.platform === "darwin" ? it : it.skip;

import {
  spawnSnipping,
  readCapturedImage,
  MACOS_PERMISSION_FIX,
} from "./macos.ts";

describe("macos", () => {
  let originalSpawn: typeof Bun.spawn;
  let originalUuid: () => string;
  const testUuid = "test-uuid-mac";
  const tmpPng = `/tmp/screenshot-to-chat-${testUuid}.png`;
  const tmpJpg = `/tmp/screenshot-to-chat-${testUuid}.jpg`;

  beforeEach(() => {
    originalSpawn = Bun.spawn;
    originalUuid = crypto.randomUUID;
    // Force a deterministic temp path so the test can pre-create the file
    // and verify the cleanup calls rm against the same path.
    (crypto as any).randomUUID = () => testUuid;
  });

  afterEach(() => {
    (Bun as any).spawn = originalSpawn;
    (crypto as any).randomUUID = originalUuid;
  });

  // ── spawnSnipping ──────────────────────────────────────────────────────────

  itMac("spawnSnipping returns ok when file is written", async () => {
    // Pre-create the file with > 0 bytes to simulate a successful capture.
    await Bun.write(tmpPng, new Uint8Array(5000));

    let capturedArgv: string[] = [];
    (Bun as any).spawn = mock((argv: string[]) => {
      capturedArgv = argv;
      return {
        stdout: new Response("").body,
        stderr: new Response("").body,
        exitCode: 0,
        exited: Promise.resolve(0),
        pid: 1234,
        kill: mock(() => {}),
        ref: mock(() => {}),
        unref: mock(() => {}),
      };
    });

    try {
      const result = await spawnSnipping();
      expect(result).toEqual({ ok: true });
      expect(capturedArgv[0]).toBe("screencapture");
      expect(capturedArgv[1]).toBe("-i");
      expect(capturedArgv[2]).toBe(tmpPng);
    } finally {
      await Bun.spawn(["rm", "-f", tmpPng]).exited;
    }
  });

  itMac("spawnSnipping returns user_cancelled when no file is written", async () => {
    // No pre-create — file does not exist (user pressed Escape).
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
    expect(result).toEqual({ ok: false, error: { type: "user_cancelled" } });
  });

  // ── readCapturedImage ──────────────────────────────────────────────────────

  itMac("readCapturedImage returns base64 on happy path", async () => {
    // Pre-create the file with > 4 KB to pass the permission check.
    await Bun.write(tmpPng, new Uint8Array(5000));

    (Bun as any).spawn = mock((argv: string[]) => {
      if (argv[0] === "sips") {
        return {
          stdout: new Response("").body,
          stderr: new Response("").body,
          exitCode: 0,
          exited: Promise.resolve(0),
          pid: 1234,
          kill: mock(() => {}),
          ref: mock(() => {}),
          unref: mock(() => {}),
        };
      }
      if (argv[0] === "sh") {
        // base64("abc") = "YWJj"
        return {
          stdout: new Response("YWJj\n").body,
          stderr: new Response("").body,
          exitCode: 0,
          exited: Promise.resolve(0),
          pid: 1234,
          kill: mock(() => {}),
          ref: mock(() => {}),
          unref: mock(() => {}),
        };
      }
      // rm in finally
      return {
        stdout: new Response("").body,
        stderr: new Response("").body,
        exitCode: 0,
        exited: Promise.resolve(0),
        pid: 1234,
        kill: mock(() => {}),
        ref: mock(() => {}),
        unref: mock(() => {}),
      };
    });

    const result = await readCapturedImage();
    expect(result).toBe("YWJj");
  });

  itMac("readCapturedImage returns permission_missing when PNG is too small", async () => {
    // Pre-create a 2 KB file — below the 4 KB permission threshold.
    await Bun.write(tmpPng, new Uint8Array(2000));

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

    const result = await readCapturedImage();
    expect(result).toEqual({
      ok: false,
      error: {
        type: "permission_missing",
        platform: "darwin",
        fix: MACOS_PERMISSION_FIX,
      },
    });
  });

  itMac("readCapturedImage returns null when sips fails", async () => {
    await Bun.write(tmpPng, new Uint8Array(5000));

    (Bun as any).spawn = mock((argv: string[]) => {
      if (argv[0] === "sips") {
        return {
          stdout: new Response("").body,
          stderr: new Response("sips error").body,
          exitCode: 1,
          exited: Promise.resolve(1),
          pid: 1234,
          kill: mock(() => {}),
          ref: mock(() => {}),
          unref: mock(() => {}),
        };
      }
      return {
        stdout: new Response("").body,
        stderr: new Response("").body,
        exitCode: 0,
        exited: Promise.resolve(0),
        pid: 1234,
        kill: mock(() => {}),
        ref: mock(() => {}),
        unref: mock(() => {}),
      };
    });

    const result = await readCapturedImage();
    expect(result).toBeNull();
  });

  itMac("readCapturedImage cleans up temp files in finally", async () => {
    await Bun.write(tmpPng, new Uint8Array(5000));

    const spawnCalls: string[][] = [];
    (Bun as any).spawn = mock((argv: string[]) => {
      spawnCalls.push(argv);
      if (argv[0] === "sips") {
        // Fail sips so the test goes through the cleanup path even if the
        // happy-path mocks aren't in place. The contract under test is the
        // cleanup, not the sips success path (covered by the happy-path test).
        return {
          stdout: new Response("").body,
          stderr: new Response("").body,
          exitCode: 1,
          exited: Promise.resolve(1),
          pid: 1234,
          kill: mock(() => {}),
          ref: mock(() => {}),
          unref: mock(() => {}),
        };
      }
      return {
        stdout: new Response("").body,
        stderr: new Response("").body,
        exitCode: 0,
        exited: Promise.resolve(0),
        pid: 1234,
        kill: mock(() => {}),
        ref: mock(() => {}),
        unref: mock(() => {}),
      };
    });

    await readCapturedImage();

    // The cleanup must have invoked `rm -f` with both temp paths, regardless
    // of which path the impl took (sips fail, permission_missing, etc.).
    const rmCall = spawnCalls.find(
      (argv) => argv[0] === "rm" && argv[1] === "-f",
    );
    expect(rmCall).toBeDefined();
    expect(rmCall).toContain(tmpPng);
    expect(rmCall).toContain(tmpJpg);
  });
});
