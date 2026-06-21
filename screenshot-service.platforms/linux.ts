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

/**
 * Spawn an interactive region capture. After this commit: performs session
 * detection, rejects headless sessions, and runs the X11 capture chain
 * (scrot → maim) when the session is X11. The Wayland chain lands in the
 * next commit.
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
  // Wayland chain lands in the next commit. Until then, the dispatcher
  // would reach this on a Wayland host and return tool_unavailable as a
  // placeholder.
  return toolUnavailable(
    "Linux Wayland capture chain not yet implemented in this build.",
  );
}

/**
 * Read the captured PNG, resize via ImageMagick, base64-encode. Lands in
 * a later commit (Phase 5.3 / 5.4 in tasks.md). Until then: returns null
 * so the dispatcher's poll loop backs off without burning the budget.
 */
export async function readCapturedImage(): Promise<string | null> {
  return null;
}
