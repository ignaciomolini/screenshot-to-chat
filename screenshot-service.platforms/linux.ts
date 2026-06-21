/**
 * Linux screenshot capture — session detection + headless rejection.
 *
 * Real capture chains (X11 scrot/maim, Wayland grim+slurp/gnome-screenshot/
 * spectacle) and ImageMagick processing land in subsequent commits of the
 * PR 3 chain. This commit adds the `detectSession()` helper and the
 * headless rejection path that must run BEFORE any capture tool is spawned.
 *
 * Capture flow (per design §3.7, §4.e):
 *   1. `Bun.spawn(["sh", "-c", SESSION_DETECT_SCRIPT])` — echoes "x11",
 *      "wayland", or "none" based on the precedence in the script.
 *   2. If "none" or "tty" → return `tool_unavailable` without spawning
 *      any capture subprocess (per design §3.7 / spec Req #7).
 *
 * The `sh -c` pattern matches `CLIPBOARD_PS_SCRIPT` in windows.ts and
 * `base64 -i | tr -d '\n'` in macos.ts — inline scripts invoked via
 * `Bun.spawn` (per design ADR-8).
 */

import type { CaptureError } from "../screenshot-service.ts";

/** Session types returned by the detection script. */
export type LinuxSession = "x11" | "wayland" | "none";

/**
 * Inline script that prints the current Linux session type. Mirrors the
 * precedence in the spec (Req #8) and design §4.e:
 *   - `$XDG_SESSION_TYPE` wins (set explicitly by most modern DEs)
 *   - else `$WAYLAND_DISPLAY` set → `wayland`
 *   - else `$DISPLAY` set → `x11`
 *   - else `none` (headless — no display server detected)
 */
const SESSION_DETECT_SCRIPT = `
if [ -n "$XDG_SESSION_TYPE" ]; then
  echo "$XDG_SESSION_TYPE"
elif [ -n "$WAYLAND_DISPLAY" ]; then
  echo "wayland"
elif [ -n "$DISPLAY" ]; then
  echo "x11"
else
  echo "none"
fi
`.trim();

/**
 * Read the session type by shelling out to the inline script. Returns one
 * of `"x11" | "wayland" | "none"`. Falls back to `"none"` if the script
 * fails or returns an unexpected value (e.g. "tty" from a manual override).
 */
export async function detectSession(): Promise<LinuxSession> {
  try {
    const proc = Bun.spawn(["sh", "-c", SESSION_DETECT_SCRIPT], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = (await new Response(proc.stdout).text()).trim();
    await proc.exited;
    if (output === "x11" || output === "wayland" || output === "none") {
      return output;
    }
    // "tty" or any other value → treat as headless (no display server).
    return "none";
  } catch {
    return "none";
  }
}

/**
 * Build a `tool_unavailable` error with the canonical "no display server"
 * message. Used by the headless rejection path. Exported for use by the
 * X11/Wayland capture chains when their tool probes fail (later commits).
 */
export function toolUnavailable(message: string): {
  ok: false;
  error: CaptureError;
} {
  return { ok: false, error: { type: "tool_unavailable", message } };
}

/**
 * Probe whether a tool is on `PATH` by running `which <tool>` and checking
 * the exit code. `which` exits 0 when found, 1 (or non-zero) when absent.
 * No fallback tool is spawned when the probe fails (cheap, per design §4.f).
 */
export async function probeTool(tool: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(["which", tool], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}

/** Per-distro install instructions for the X11 capture tools. */
function x11InstallMessage(): string {
  return (
    "Install a screenshot tool for X11:\n" +
    "  sudo apt install scrot\n" +
    "  sudo dnf install scrot\n" +
    "  sudo pacman -S scrot\n" +
    "  brew install scrot"
  );
}

/**
 * X11 capture chain (per design §4.f / spec Req #9):
 *   1. `which scrot` → if 0, run `scrot -s <tmp>` for interactive region.
 *   2. Else `which maim` → if 0, run `maim -s <tmp>`.
 *   3. Else `tool_unavailable` with per-distro install instructions.
 *
 * Success is disambiguated from user-cancellation by checking the output
 * file's existence after exit 0 (same pattern as the macOS path).
 */
export async function captureX11(
  tmpPng: string,
): Promise<{ ok: true } | { ok: false; error: CaptureError }> {
  if (await probeTool("scrot")) {
    const proc = Bun.spawn(["scrot", "-s", tmpPng], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    if (proc.exitCode === 0 && (await Bun.file(tmpPng).exists())) {
      return { ok: true };
    }
    return toolUnavailable("scrot exited without writing a screenshot.");
  }
  if (await probeTool("maim")) {
    const proc = Bun.spawn(["maim", "-s", tmpPng], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    if (proc.exitCode === 0 && (await Bun.file(tmpPng).exists())) {
      return { ok: true };
    }
    return toolUnavailable("maim exited without writing a screenshot.");
  }
  return toolUnavailable(x11InstallMessage());
}

/** Per-distro install instructions for the Wayland capture tools. */
function waylandInstallMessage(): string {
  return (
    "Install a screenshot tool for Wayland:\n" +
    "  wlroots (Sway/Hyprland/Niri): sudo apt install slurp grim\n" +
    "  GNOME:                        sudo apt install gnome-screenshot\n" +
    "  KDE:                          sudo apt install spectacle\n" +
    "  (also available via dnf / pacman / brew)"
  );
}

/**
 * Wayland capture chain (per design §4.g / spec Req #10):
 *   1. `which slurp` AND `which grim` (both must be present) → `sh -c "slurp | grim -g - <tmp>"`.
 *   2. Else `which gnome-screenshot` → if 0, `gnome-screenshot -a -f <tmp>`.
 *   3. Else `which spectacle` → if 0, `spectacle --region --output <tmp>`.
 *   4. Else `tool_unavailable` with per-chain install instructions.
 *
 * The slurp|grim chain needs `sh -c` because it's a pipeline (per design
 * §4.g). `-g -` tells grim to read geometry from stdin (slurp prints it).
 */
export async function captureWayland(
  tmpPng: string,
): Promise<{ ok: true } | { ok: false; error: CaptureError }> {
  if ((await probeTool("slurp")) && (await probeTool("grim"))) {
    const proc = Bun.spawn(["sh", "-c", `slurp | grim -g - ${tmpPng}`], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    if (proc.exitCode === 0 && (await Bun.file(tmpPng).exists())) {
      return { ok: true };
    }
    return toolUnavailable("slurp|grim exited without writing a screenshot.");
  }
  if (await probeTool("gnome-screenshot")) {
    const proc = Bun.spawn(["gnome-screenshot", "-a", "-f", tmpPng], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    if (proc.exitCode === 0 && (await Bun.file(tmpPng).exists())) {
      return { ok: true };
    }
    return toolUnavailable("gnome-screenshot exited without writing a screenshot.");
  }
  if (await probeTool("spectacle")) {
    const proc = Bun.spawn(["spectacle", "--region", "--output", tmpPng], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    if (proc.exitCode === 0 && (await Bun.file(tmpPng).exists())) {
      return { ok: true };
    }
    return toolUnavailable("spectacle exited without writing a screenshot.");
  }
  return toolUnavailable(waylandInstallMessage());
}

/** Directory for temp capture files. `/tmp` is world-writable on Linux. */
const TMP_DIR = "/tmp";

/** Resize target longest edge (px) — matches dispatcher `MAX_DIMENSION`. */
const MAX_DIMENSION = 1568;

/** JPEG quality (0-100) — matches dispatcher `JPEG_QUALITY`. */
const JPEG_QUALITY = 75;

/** Per-distro install instructions for ImageMagick. */
function imagemagickInstallMessage(): string {
  return (
    "Install ImageMagick:\n" +
    "  sudo apt install imagemagick\n" +
    "  sudo dnf install ImageMagick\n" +
    "  sudo pacman -S imagemagick\n" +
    "  brew install imagemagick"
  );
}

/**
 * Spawn an interactive region capture. After this commit: routes x11
 * sessions through captureX11 and wayland sessions through captureWayland,
 * with a headless rejection up front.
 */
export async function spawnSnipping(): Promise<
  { ok: true } | { ok: false; error: CaptureError }
> {
  const session = await detectSession();
  if (session === "none") {
    return toolUnavailable(
      "No display server detected. Set $DISPLAY (X11) or $WAYLAND_DISPLAY (Wayland).",
    );
  }
  const tmpPng = `/tmp/screenshot-to-chat-${crypto.randomUUID()}.png`;
  if (session === "x11") {
    return captureX11(tmpPng);
  }
  return captureWayland(tmpPng);
}

/**
 * Read the captured PNG, resize via ImageMagick, base64-encode, and
 * clean up the temp files in `finally` (per design §4.h, §4.i, §4.k;
 * spec Req #11).
 *
 *   1. `which magick` (ImageMagick v7) → `magick <png> -resize 1568x1568
 *      -quality 75 <jpg>` (preserves aspect ratio, no upscale).
 *   2. Else `which convert` (ImageMagick v6) → same argv with `convert`.
 *   3. Else `tool_unavailable` with per-distro install instructions.
 *   4. `base64 -w 0 <jpg>` (GNU form — `-w 0` disables line wrapping,
 *      no `tr -d '\n'` needed; macOS uses the BSD form per design §4.d).
 *   5. `rm -f <png> <jpg>` in `finally`, regardless of success/failure.
 */
export async function readCapturedImage(): Promise<
  string | null | { ok: false; error: CaptureError }
> {
  const tmpPng = `${TMP_DIR}/screenshot-to-chat-${crypto.randomUUID()}.png`;
  const tmpJpg = tmpPng.replace(/\.png$/, ".jpg");
  try {
    const file = Bun.file(tmpPng);
    if (!(await file.exists())) return null;

    // ImageMagick v7 → v6 probe. v6 (convert) and v7 (magick) accept the
    // same `-resize` / `-quality` flags, so the argv is identical except
    // for the binary name. Per design §4.h.
    let resizeTool: "magick" | "convert" | null = null;
    if (await probeTool("magick")) {
      resizeTool = "magick";
    } else if (await probeTool("convert")) {
      resizeTool = "convert";
    } else {
      return toolUnavailable(imagemagickInstallMessage());
    }

    const resize = Bun.spawn(
      [
        resizeTool,
        tmpPng,
        "-resize", `${MAX_DIMENSION}x${MAX_DIMENSION}`,
        "-quality", String(JPEG_QUALITY),
        tmpJpg,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const resizeExit = await resize.exited;
    if (resizeExit !== 0) return null;

    // GNU base64: `base64 -w 0 <file>` disables line wrapping. No `tr`
    // needed (the macOS path uses `base64 -i | tr -d '\n'` because BSD
    // lacks `-w 0` — per design §4.d / §4.i).
    const b64 = Bun.spawn(["base64", "-w", "0", tmpJpg], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [output, b64Exit] = await Promise.all([
      new Response(b64.stdout).text(),
      b64.exited,
    ]);
    if (b64Exit !== 0) return null;
    const base64 = output.trim();
    if (!base64) return null;
    return base64;
  } finally {
    // Best-effort cleanup: `rm -f` swallows missing files so partial-
    // failure paths (resize worked but base64 failed) still clean up
    // cleanly. A rm failure must not mask the real result.
    try {
      await Bun.spawn(["rm", "-f", tmpPng, tmpJpg]).exited;
    } catch {
      // ignore
    }
  }
}
