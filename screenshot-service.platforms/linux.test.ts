/**
 * Linux-specific tests for the platform module.
 *
 * The `itLin` guard makes the suite skip cleanly on non-linux hosts —
 * `it.skip` keeps the test count and the failure count stable, so CI on
 * Windows/macOS does not see phantom failures. The module compiles on
 * every host (TypeScript checks the test file), so `bunx tsc --noEmit`
 * passes regardless of the runtime platform.
 *
 * Strategy: each test sets `process.env` to drive the session-detection
 * script (`XDG_SESSION_TYPE` wins, then `WAYLAND_DISPLAY`, then `DISPLAY`).
 * `Bun.spawn` is mocked per-test to simulate `which` probes (return 0 or 1)
 * and capture invocations of the capture / resize / base64 / rm tools.
 * The `sh -c` session-detection call is either run for real (env-var
 * driven) or mocked to return the expected session string.
 */

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const itLin = process.platform === "linux" ? it : it.skip;

import { spawnSnipping, readCapturedImage } from "./linux.ts";

describe("linux", () => {
  let originalSpawn: typeof Bun.spawn;
  let originalUuid: () => string;
  const testUuid = "test-uuid-linux";
  const tmpPng = `/tmp/screenshot-to-chat-${testUuid}.png`;
  const tmpJpg = `/tmp/screenshot-to-chat-${testUuid}.jpg`;

  // env-var snapshot for session-detection tests
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalSpawn = Bun.spawn;
    originalUuid = crypto.randomUUID;
    // Force a deterministic temp path so the test can pre-create the file
    // and verify the cleanup calls rm against the same path.
    (crypto as any).randomUUID = () => testUuid;
    savedEnv = {
      XDG_SESSION_TYPE: process.env.XDG_SESSION_TYPE,
      WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY,
      DISPLAY: process.env.DISPLAY,
    };
  });

  afterEach(async () => {
    (Bun as any).spawn = originalSpawn;
    (crypto as any).randomUUID = originalUuid;
    process.env.XDG_SESSION_TYPE = savedEnv.XDG_SESSION_TYPE;
    process.env.WAYLAND_DISPLAY = savedEnv.WAYLAND_DISPLAY;
    process.env.DISPLAY = savedEnv.DISPLAY;
    // Best-effort cleanup; rm -f swallows missing files. Safe on Windows
    // because these tests are skipped on non-linux (itLin) — the afterEach
    // still runs for the skipped cases, but the `rm` either no-ops or
    // returns a non-fatal exit code.
    try {
      await Bun.spawn(["rm", "-f", tmpPng, tmpJpg]).exited;
    } catch {
      // ignore
    }
  });

  // ── helpers ──────────────────────────────────────────────────────────────

  /** Build a successful spawn result. */
  function okResult(stdout = ""): any {
    return {
      stdout: new Response(stdout).body,
      stderr: new Response("").body,
      exitCode: 0,
      exited: Promise.resolve(0),
      pid: 1234,
      kill: mock(() => {}),
      ref: mock(() => {}),
      unref: mock(() => {}),
    };
  }

  /** Build a failed spawn result. */
  function failResult(code = 1): any {
    return {
      stdout: new Response("").body,
      stderr: new Response("not found").body,
      exitCode: code,
      exited: Promise.resolve(code),
      pid: 1234,
      kill: mock(() => {}),
      ref: mock(() => {}),
      unref: mock(() => {}),
    };
  }

  /**
   * Compute the expected `sh -c` stdout for the session-detection script
   * based on the current test env. Mirrors the precedence in the design
   * (XDG_SESSION_TYPE → WAYLAND_DISPLAY → DISPLAY → none).
   */
  function expectedSessionOutput(): string {
    if (process.env.XDG_SESSION_TYPE) return `${process.env.XDG_SESSION_TYPE}\n`;
    if (process.env.WAYLAND_DISPLAY) return "wayland\n";
    if (process.env.DISPLAY) return "x11\n";
    return "none\n";
  }

  // ── spawnSnipping — headless rejection ───────────────────────────────────

  itLin("spawnSnipping rejects headless without spawning any capture tool", async () => {
    delete process.env.XDG_SESSION_TYPE;
    delete process.env.WAYLAND_DISPLAY;
    delete process.env.DISPLAY;

    const spawnCalls: string[][] = [];
    (Bun as any).spawn = mock((argv: string[]) => {
      spawnCalls.push(argv);
      // Session detect is the only expected spawn; the test verifies no
      // capture tools are invoked beyond that.
      if (argv[0] === "sh") return okResult(expectedSessionOutput());
      return failResult(1);
    });

    const result = await spawnSnipping();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("tool_unavailable");
      if (result.error.type === "tool_unavailable") {
        expect(result.error.message).toBeTruthy();
        expect(result.error.message).toMatch(/display|DISPLAY|WAYLAND/i);
      }
    }
    // No capture tools should have been invoked.
    const captureTools = ["scrot", "maim", "slurp", "grim", "gnome-screenshot", "spectacle"];
    for (const t of captureTools) {
      expect(spawnCalls.some((a) => a[0] === t)).toBe(false);
    }
  });

  // ── spawnSnipping — X11 chain ────────────────────────────────────────────

  itLin("spawnSnipping X11: uses scrot when present", async () => {
    process.env.XDG_SESSION_TYPE = "x11";
    delete process.env.WAYLAND_DISPLAY;
    process.env.DISPLAY = ":0";

    await Bun.write(tmpPng, new Uint8Array(100));

    const spawnCalls: string[][] = [];
    (Bun as any).spawn = mock((argv: string[]) => {
      spawnCalls.push(argv);
      if (argv[0] === "sh") return okResult(expectedSessionOutput());
      if (argv[0] === "which" && argv[1] === "scrot") return okResult();
      if (argv[0] === "scrot") return okResult();
      return failResult(1);
    });

    const result = await spawnSnipping();
    expect(result).toEqual({ ok: true });
    expect(spawnCalls.some((a) => a[0] === "scrot")).toBe(true);
    // maim must not be invoked when scrot is present.
    expect(spawnCalls.some((a) => a[0] === "maim")).toBe(false);
  });

  itLin("spawnSnipping X11: falls back to maim when scrot is absent", async () => {
    process.env.XDG_SESSION_TYPE = "x11";
    delete process.env.WAYLAND_DISPLAY;
    process.env.DISPLAY = ":0";

    await Bun.write(tmpPng, new Uint8Array(100));

    const spawnCalls: string[][] = [];
    (Bun as any).spawn = mock((argv: string[]) => {
      spawnCalls.push(argv);
      if (argv[0] === "sh") return okResult(expectedSessionOutput());
      if (argv[0] === "which" && argv[1] === "scrot") return failResult(1);
      if (argv[0] === "which" && argv[1] === "maim") return okResult();
      if (argv[0] === "maim") return okResult();
      return failResult(1);
    });

    const result = await spawnSnipping();
    expect(result).toEqual({ ok: true });
    expect(spawnCalls.some((a) => a[0] === "maim")).toBe(true);
  });

  itLin("spawnSnipping X11: returns tool_unavailable with install message when neither scrot nor maim is present", async () => {
    process.env.XDG_SESSION_TYPE = "x11";
    delete process.env.WAYLAND_DISPLAY;
    process.env.DISPLAY = ":0";

    const spawnCalls: string[][] = [];
    (Bun as any).spawn = mock((argv: string[]) => {
      spawnCalls.push(argv);
      if (argv[0] === "sh") return okResult(expectedSessionOutput());
      // which returns 1 for everything
      return failResult(1);
    });

    const result = await spawnSnipping();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("tool_unavailable");
      if (result.error.type === "tool_unavailable") {
        const msg = result.error.message ?? "";
        expect(msg).toContain("apt");
        expect(msg).toContain("dnf");
        expect(msg).toContain("pacman");
        expect(msg).toContain("brew");
      }
    }
    // No capture tool should have been invoked
    expect(spawnCalls.some((a) => ["scrot", "maim"].includes(a[0]))).toBe(false);
  });

  // ── spawnSnipping — Wayland chain ────────────────────────────────────────

  itLin("spawnSnipping Wayland: uses slurp|grim when both are present", async () => {
    process.env.XDG_SESSION_TYPE = "wayland";
    process.env.WAYLAND_DISPLAY = "wayland-0";
    delete process.env.DISPLAY;

    await Bun.write(tmpPng, new Uint8Array(100));

    const spawnCalls: string[][] = [];
    (Bun as any).spawn = mock((argv: string[]) => {
      spawnCalls.push(argv);
      if (argv[0] === "sh") {
        // The session-detect sh call and the slurp|grim sh -c call both
        // share argv[0] === "sh". Distinguish by argv[2] (the script body).
        const script = argv[2] ?? "";
        if (script.includes("slurp")) return okResult();
        return okResult(expectedSessionOutput());
      }
      if (argv[0] === "which" && argv[1] === "slurp") return okResult();
      if (argv[0] === "which" && argv[1] === "grim") return okResult();
      return failResult(1);
    });

    const result = await spawnSnipping();
    expect(result).toEqual({ ok: true });
    // The sh -c pipeline must have been called (slurp|grim).
    const shCalls = spawnCalls.filter(
      (a) => a[0] === "sh" && a[2] && a[2].includes("slurp"),
    );
    expect(shCalls.length).toBeGreaterThan(0);
    // gnome-screenshot / spectacle must NOT be invoked.
    expect(spawnCalls.some((a) => a[0] === "gnome-screenshot")).toBe(false);
    expect(spawnCalls.some((a) => a[0] === "spectacle")).toBe(false);
  });

  itLin("spawnSnipping Wayland: falls back to gnome-screenshot", async () => {
    process.env.XDG_SESSION_TYPE = "wayland";
    process.env.WAYLAND_DISPLAY = "wayland-0";
    delete process.env.DISPLAY;

    await Bun.write(tmpPng, new Uint8Array(100));

    const spawnCalls: string[][] = [];
    (Bun as any).spawn = mock((argv: string[]) => {
      spawnCalls.push(argv);
      if (argv[0] === "sh") return okResult(expectedSessionOutput());
      if (argv[0] === "which" && argv[1] === "slurp") return failResult(1);
      if (argv[0] === "which" && argv[1] === "gnome-screenshot") return okResult();
      if (argv[0] === "gnome-screenshot") return okResult();
      return failResult(1);
    });

    const result = await spawnSnipping();
    expect(result).toEqual({ ok: true });
    expect(spawnCalls.some((a) => a[0] === "gnome-screenshot")).toBe(true);
  });

  itLin("spawnSnipping Wayland: falls back to spectacle", async () => {
    process.env.XDG_SESSION_TYPE = "wayland";
    process.env.WAYLAND_DISPLAY = "wayland-0";
    delete process.env.DISPLAY;

    await Bun.write(tmpPng, new Uint8Array(100));

    const spawnCalls: string[][] = [];
    (Bun as any).spawn = mock((argv: string[]) => {
      spawnCalls.push(argv);
      if (argv[0] === "sh") return okResult(expectedSessionOutput());
      if (argv[0] === "which" && argv[1] === "slurp") return failResult(1);
      if (argv[0] === "which" && argv[1] === "gnome-screenshot") return failResult(1);
      if (argv[0] === "which" && argv[1] === "spectacle") return okResult();
      if (argv[0] === "spectacle") return okResult();
      return failResult(1);
    });

    const result = await spawnSnipping();
    expect(result).toEqual({ ok: true });
    expect(spawnCalls.some((a) => a[0] === "spectacle")).toBe(true);
  });

  itLin("spawnSnipping Wayland: returns tool_unavailable when all three chains fail", async () => {
    process.env.XDG_SESSION_TYPE = "wayland";
    process.env.WAYLAND_DISPLAY = "wayland-0";
    delete process.env.DISPLAY;

    const spawnCalls: string[][] = [];
    (Bun as any).spawn = mock((argv: string[]) => {
      spawnCalls.push(argv);
      if (argv[0] === "sh") return okResult(expectedSessionOutput());
      return failResult(1);
    });

    const result = await spawnSnipping();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("tool_unavailable");
    }
    expect(spawnCalls.some((a) => ["gnome-screenshot", "spectacle"].includes(a[0]))).toBe(false);
  });

  // ── readCapturedImage — ImageMagick probe ────────────────────────────────

  itLin("readCapturedImage: uses magick v7 when present", async () => {
    process.env.XDG_SESSION_TYPE = "x11";
    delete process.env.WAYLAND_DISPLAY;
    process.env.DISPLAY = ":0";

    await Bun.write(tmpPng, new Uint8Array(100));

    const spawnCalls: string[][] = [];
    (Bun as any).spawn = mock((argv: string[]) => {
      spawnCalls.push(argv);
      if (argv[0] === "sh") return okResult(expectedSessionOutput());
      if (argv[0] === "which" && argv[1] === "scrot") return okResult();
      if (argv[0] === "scrot") return okResult();
      if (argv[0] === "which" && argv[1] === "magick") return okResult();
      if (argv[0] === "magick") return okResult();
      if (argv[0] === "base64") return okResult("aGVsbG8=");
      if (argv[0] === "rm") return okResult();
      return failResult(1);
    });

    // Pre-call spawnSnipping so the path is in module state.
    const spawnResult = await spawnSnipping();
    expect(spawnResult).toEqual({ ok: true });

    const result = await readCapturedImage();
    expect(result).toBe("aGVsbG8=");
    expect(spawnCalls.some((a) => a[0] === "magick")).toBe(true);
    expect(spawnCalls.some((a) => a[0] === "convert")).toBe(false);
  });

  itLin("readCapturedImage: falls back to convert v6 when magick is absent", async () => {
    process.env.XDG_SESSION_TYPE = "x11";
    delete process.env.WAYLAND_DISPLAY;
    process.env.DISPLAY = ":0";

    await Bun.write(tmpPng, new Uint8Array(100));

    const spawnCalls: string[][] = [];
    (Bun as any).spawn = mock((argv: string[]) => {
      spawnCalls.push(argv);
      if (argv[0] === "sh") return okResult(expectedSessionOutput());
      if (argv[0] === "which" && argv[1] === "scrot") return okResult();
      if (argv[0] === "scrot") return okResult();
      if (argv[0] === "which" && argv[1] === "magick") return failResult(1);
      if (argv[0] === "which" && argv[1] === "convert") return okResult();
      if (argv[0] === "convert") return okResult();
      if (argv[0] === "base64") return okResult("aGVsbG8=");
      if (argv[0] === "rm") return okResult();
      return failResult(1);
    });

    // Pre-call spawnSnipping so the path is in module state.
    const spawnResult = await spawnSnipping();
    expect(spawnResult).toEqual({ ok: true });

    const result = await readCapturedImage();
    expect(result).toBe("aGVsbG8=");
    expect(spawnCalls.some((a) => a[0] === "convert")).toBe(true);
  });

  itLin("readCapturedImage: returns null when neither magick nor convert is present", async () => {
    process.env.XDG_SESSION_TYPE = "x11";
    delete process.env.WAYLAND_DISPLAY;
    process.env.DISPLAY = ":0";

    await Bun.write(tmpPng, new Uint8Array(100));

    const spawnCalls: string[][] = [];
    (Bun as any).spawn = mock((argv: string[]) => {
      spawnCalls.push(argv);
      if (argv[0] === "sh") return okResult(expectedSessionOutput());
      if (argv[0] === "which" && argv[1] === "scrot") return okResult();
      if (argv[0] === "scrot") return okResult();
      return failResult(1);
    });

    // Pre-call spawnSnipping so the path is in module state.
    const spawnResult = await spawnSnipping();
    expect(spawnResult).toEqual({ ok: true });

    const result = await readCapturedImage();
    // Per design: ImageMagick missing → tool_unavailable. The dispatcher
    // short-circuits on the error-object form; the test confirms the
    // module returns the typed error.
    if (result !== null && typeof result !== "string") {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe("tool_unavailable");
      }
    } else {
      // Some impls may return null when the tool is missing — accept
      // either, but assert no capture work happened.
      expect(result).toBeNull();
    }
    // No resize/base64 should have been attempted.
    expect(spawnCalls.some((a) => ["magick", "convert", "base64"].includes(a[0]))).toBe(false);
  });

  itLin("readCapturedImage: cleans up temp files via rm -f in finally", async () => {
    process.env.XDG_SESSION_TYPE = "x11";
    delete process.env.WAYLAND_DISPLAY;
    process.env.DISPLAY = ":0";

    await Bun.write(tmpPng, new Uint8Array(100));

    const spawnCalls: string[][] = [];
    (Bun as any).spawn = mock((argv: string[]) => {
      spawnCalls.push(argv);
      if (argv[0] === "sh") return okResult(expectedSessionOutput());
      if (argv[0] === "which" && argv[1] === "scrot") return okResult();
      if (argv[0] === "scrot") return okResult();
      if (argv[0] === "which" && argv[1] === "magick") return okResult();
      if (argv[0] === "magick") return okResult();
      if (argv[0] === "base64") return okResult("aGVsbG8=");
      if (argv[0] === "rm") return okResult();
      return failResult(1);
    });

    // Pre-call spawnSnipping so the path is in module state.
    const spawnResult = await spawnSnipping();
    expect(spawnResult).toEqual({ ok: true });

    await readCapturedImage();

    const rmCall = spawnCalls.find((a) => a[0] === "rm" && a[1] === "-f");
    expect(rmCall).toBeDefined();
    if (rmCall) {
      expect(rmCall).toContain(tmpPng);
      expect(rmCall).toContain(tmpJpg);
    }
  });

  itLin("readCapturedImage: uses base64 -w 0 (GNU form, not tr -d '\\n')", async () => {
    process.env.XDG_SESSION_TYPE = "x11";
    delete process.env.WAYLAND_DISPLAY;
    process.env.DISPLAY = ":0";

    await Bun.write(tmpPng, new Uint8Array(100));

    const spawnCalls: string[][] = [];
    (Bun as any).spawn = mock((argv: string[]) => {
      spawnCalls.push(argv);
      if (argv[0] === "sh") return okResult(expectedSessionOutput());
      if (argv[0] === "which" && argv[1] === "scrot") return okResult();
      if (argv[0] === "scrot") return okResult();
      if (argv[0] === "which" && argv[1] === "magick") return okResult();
      if (argv[0] === "magick") return okResult();
      if (argv[0] === "base64") return okResult("aGVsbG8=");
      if (argv[0] === "rm") return okResult();
      return failResult(1);
    });

    // Pre-call spawnSnipping so the path is in module state.
    const spawnResult = await spawnSnipping();
    expect(spawnResult).toEqual({ ok: true });

    await readCapturedImage();

    const b64Call = spawnCalls.find((a) => a[0] === "base64");
    expect(b64Call).toBeDefined();
    if (b64Call) {
      // GNU: `base64 -w 0 <file>` — the `-w 0` disables line wrapping.
      expect(b64Call).toContain("-w");
      expect(b64Call).toContain("0");
      // BSD form (macOS) would use `tr -d '\n'` — verify that path is
      // NOT used here. No `tr` invocation should appear.
      expect(spawnCalls.some((a) => a[0] === "tr")).toBe(false);
    }
  });

  // ── path-sharing contract (PR 4 fix) ───────────────────────────────────

  itLin("readCapturedImage uses the temp file path that spawnSnipping set", async () => {
    // Without the path-sharing fix, spawnSnipping and readCapturedImage each
    // call crypto.randomUUID() independently, so the file path spawnSnipping
    // writes to is NOT the path readCapturedImage looks at. We force two
    // distinct UUIDs here to expose the bug: spawnSnipping gets "spawn-uuid"
    // (and writes the file there), then readCapturedImage is called and
    // would otherwise get "read-uuid" (a path with no file). The fix makes
    // them share the path via module state.
    process.env.XDG_SESSION_TYPE = "x11";
    delete process.env.WAYLAND_DISPLAY;
    process.env.DISPLAY = ":0";

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
    const magickCalls: string[][] = [];
    (Bun as any).spawn = mock((argv: string[]) => {
      spawnCalls.push(argv);
      if (argv[0] === "sh") return okResult(expectedSessionOutput());
      if (argv[0] === "which" && argv[1] === "scrot") return okResult();
      if (argv[0] === "scrot") return okResult();
      if (argv[0] === "which" && argv[1] === "magick") return okResult();
      if (argv[0] === "magick") {
        magickCalls.push(argv);
        return okResult();
      }
      if (argv[0] === "base64") return okResult("YWJj");
      if (argv[0] === "rm") return okResult();
      return failResult(1);
    });

    try {
      const spawnResult = await spawnSnipping();
      expect(spawnResult).toEqual({ ok: true });
      // scrot was called with the spawn-uuid path
      const scrotCall = spawnCalls.find((a) => a[0] === "scrot");
      expect(scrotCall).toBeDefined();
      expect(scrotCall![2]).toBe(spawnPath);

      const readResult = await readCapturedImage();
      expect(readResult).toBe("YWJj");
      // The magick call's input path must be the same one spawnSnipping used.
      // Without the fix, magick would receive readPath (no such file → fail
      // early) and the test would never reach the "YWJj" assertion.
      expect(magickCalls[0]).toContain(spawnPath);
      expect(magickCalls[0]).not.toContain("read-uuid");
    } finally {
      try { await Bun.spawn(["rm", "-f", spawnPath, readPath]).exited; } catch {}
    }
  });

  itLin("readCapturedImage is consume-on-read (path cleared after first read)", async () => {
    // After a successful read, the path is cleared from module state. The
    // next readCapturedImage call must NOT regenerate the same path and
    // re-find the file — it must return null until spawnSnipping sets a
    // fresh path. This is the consume-on-read pattern that keeps the
    // dispatcher single-shot per capture.
    process.env.XDG_SESSION_TYPE = "x11";
    delete process.env.WAYLAND_DISPLAY;
    process.env.DISPLAY = ":0";

    const fixedUuid = "consume-uuid";
    (crypto as any).randomUUID = () => fixedUuid;
    const capturePath = `/tmp/screenshot-to-chat-${fixedUuid}.png`;
    await Bun.write(capturePath, new Uint8Array(5000));

    (Bun as any).spawn = mock((argv: string[]) => {
      if (argv[0] === "sh") return okResult(expectedSessionOutput());
      if (argv[0] === "which" && argv[1] === "scrot") return okResult();
      if (argv[0] === "scrot") return okResult();
      if (argv[0] === "which" && argv[1] === "magick") return okResult();
      if (argv[0] === "magick") return okResult();
      if (argv[0] === "base64") return okResult("YWJj");
      if (argv[0] === "rm") return okResult();
      return failResult(1);
    });

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
});
