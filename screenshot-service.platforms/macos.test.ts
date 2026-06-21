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

  itMac("readCapturedImage uses the temp file path that spawnSnipping set", async () => {
    // Without the path-sharing fix, spawnSnipping and readCapturedImage each
    // call crypto.randomUUID() independently, so the file path spawnSnipping
    // writes to is NOT the path readCapturedImage looks at. We force two
    // distinct UUIDs here to expose the bug: spawnSnipping gets "spawn-uuid"
    // (and writes the file there), then readCapturedImage is called and
    // would otherwise get "read-uuid" (a path with no file). The fix makes
    // them share the path via module state.
    let uuidCount = 0;
    (crypto as any).randomUUID = () => {
      uuidCount++;
      return uuidCount === 1 ? "spawn-uuid" : "read-uuid";
    };
    const spawnPath = `/tmp/screenshot-to-chat-spawn-uuid.png`;
    const readPath = `/tmp/screenshot-to-chat-read-uuid.png`;
    // Pre-create the file only at the path spawnSnipping uses.
    await Bun.write(spawnPath, new Uint8Array(5000));

    const spawnCalls: string[][] = [];
    const sipsCalls: string[][] = [];
    (Bun as any).spawn = mock((argv: string[]) => {
      if (argv[0] === "screencapture") {
        spawnCalls.push(argv);
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
      if (argv[0] === "sips") {
        sipsCalls.push(argv);
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

    try {
      const spawnResult = await spawnSnipping();
      expect(spawnResult).toEqual({ ok: true });
      expect(spawnCalls[0][2]).toBe(spawnPath);

      const readResult = await readCapturedImage();
      expect(readResult).toBe("YWJj");
      // The sips call's input path must be the same one spawnSnipping used.
      // Without the fix, sips would receive readPath (no such file → fail
      // early) and the test would never reach the "YWJj" assertion.
      expect(sipsCalls[0]).toContain(spawnPath);
      expect(sipsCalls[0]).not.toContain("read-uuid");
    } finally {
      try { await Bun.spawn(["rm", "-f", spawnPath, readPath]).exited; } catch {}
    }
  });

  itMac("readCapturedImage is consume-on-read (path cleared after first read)", async () => {
    // After a successful read, the path is cleared from module state. The
    // next readCapturedImage call must NOT regenerate the same path and
    // re-find the file — it must return null until spawnSnipping sets a
    // fresh path. This is the consume-on-read pattern that keeps the
    // dispatcher single-shot per capture.
    const fixedUuid = "consume-uuid";
    (crypto as any).randomUUID = () => fixedUuid;
    const capturePath = `/tmp/screenshot-to-chat-${fixedUuid}.png`;
    await Bun.write(capturePath, new Uint8Array(5000));

    (Bun as any).spawn = mock((argv: string[]) => ({
      stdout:
        argv[0] === "sh"
          ? new Response("YWJj\n").body
          : new Response("").body,
      stderr: new Response("").body,
      exitCode: 0,
      exited: Promise.resolve(0),
      pid: 1234,
      kill: mock(() => {}),
      ref: mock(() => {}),
      unref: mock(() => {}),
    }));

    try {
      const spawnResult = await spawnSnipping();
      expect(spawnResult).toEqual({ ok: true });

      const firstRead = await readCapturedImage();
      expect(firstRead).toBe("YWJj");

      // Re-create the file to ensure the second read returns null because
      // the path state is cleared, not because the file is missing.
      await Bun.write(capturePath, new Uint8Array(5000));
      const secondRead = await readCapturedImage();
      expect(secondRead).toBeNull();
    } finally {
      try { await Bun.spawn(["rm", "-f", capturePath]).exited; } catch {}
    }
  });

  // ── readCapturedImage ──────────────────────────────────────────────────────

  itMac("readCapturedImage returns base64 on happy path", async () => {
    // Pre-create the file with > 4 KB to pass the permission check.
    await Bun.write(tmpPng, new Uint8Array(5000));

    (Bun as any).spawn = mock((argv: string[]) => {
      if (argv[0] === "screencapture") {
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

    // Pre-call spawnSnipping so the path-sharing state is set. The mock
    // makes screencapture succeed; the pre-created tmpPng satisfies the
    // post-spawn existence check.
    const spawnResult = await spawnSnipping();
    expect(spawnResult).toEqual({ ok: true });

    const result = await readCapturedImage();
    expect(result).toBe("YWJj");
  });

  itMac("readCapturedImage returns permission_missing when PNG is too small", async () => {
    // Pre-create a 2 KB file — below the 4 KB permission threshold.
    await Bun.write(tmpPng, new Uint8Array(2000));

    (Bun as any).spawn = mock((argv: string[]) => {
      if (argv[0] === "screencapture") {
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
      // sips/base64/rm are never reached — the size check short-circuits.
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

    // Pre-call spawnSnipping so the path is in module state.
    const spawnResult = await spawnSnipping();
    expect(spawnResult).toEqual({ ok: true });

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
      if (argv[0] === "screencapture") {
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

    // Pre-call spawnSnipping so the path is in module state.
    const spawnResult = await spawnSnipping();
    expect(spawnResult).toEqual({ ok: true });

    const result = await readCapturedImage();
    expect(result).toBeNull();
  });

  itMac("readCapturedImage cleans up temp files in finally", async () => {
    await Bun.write(tmpPng, new Uint8Array(5000));

    const spawnCalls: string[][] = [];
    (Bun as any).spawn = mock((argv: string[]) => {
      spawnCalls.push(argv);
      if (argv[0] === "screencapture") {
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

    // Pre-call spawnSnipping so the path is in module state.
    const spawnResult = await spawnSnipping();
    expect(spawnResult).toEqual({ ok: true });

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
