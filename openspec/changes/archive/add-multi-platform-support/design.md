# Design: Multi-Platform Support

## 1. Overview

`screenshot-service.ts` becomes a thin dispatcher + shared layer. Per-platform code lives in `screenshot-service.platforms/`. At module load, the dispatcher binds `spawnSnipping` and `readCapturedImage` to the platform module matching `process.platform` (`win32` → Windows, `darwin` → macOS, `linux` → Linux). The Windows module preserves the current behavior bit-for-bit; the macOS module wraps `screencapture -i` + `sips`; the Linux module picks a capture tool from a fallback chain based on session type (X11 vs Wayland) and resizes with ImageMagick (v7 `magick` or v6 `convert`). Shared helpers — `validateSize`, `buildFilePart`, `pollClipboard`, the new `encodeFileToBase64`, and the `CaptureError`/`CaptureResult`/`FilePart` types — live in the dispatcher file and are platform-agnostic. The entry point drops its `process.platform !== "win32"` guard and becomes 100% platform-agnostic; routing is entirely internal to the service.

## 2. File Layout

| File | Action | Exports / Responsibility |
|------|--------|------------------------|
| `screenshot-service.ts` | Modify | Constants (`POLL_INTERVAL_MS`, `POLL_TIMEOUT_MS`, `MAX_IMAGE_BYTES`, `MAX_DIMENSION`, `JPEG_QUALITY`). Types (`CaptureError` + new `permission_missing` variant, `CaptureResult`, `FilePart`). Pure helpers: `validateSize`, `buildFilePart`, `encodeFileToBase64(path)`. Async: `pollClipboard` (calls dispatcher-bound `readCapturedImage`). Dispatcher: binds and re-exports `spawnSnipping` + `readCapturedImage` from per-platform module; throws on unsupported platform. |
| `screenshot-service.platforms/windows.ts` | Create | `SNIPPING_TOOL` constant. `CLIPBOARD_PS_SCRIPT` (moved verbatim from current service). `spawnSnipping()` (SnippingTool /clip). `readCapturedImage()` (PowerShell clipboard read; was `readClipboard`). |
| `screenshot-service.platforms/macos.ts` | Create | `spawnSnipping()` (screencapture -i → file-exists check). `readCapturedImage()` (permission check → sips resize → base64 encode). |
| `screenshot-service.platforms/linux.ts` | Create | `spawnSnipping()` (headless check → session detect → capture chain). `readCapturedImage()` (ImageMagick probe → resize → base64 encode). Internal helpers: `detectSession()`, `probeTool()`, `captureX11()`, `captureWayland()`. |
| `screenshot-service.test.ts` | Modify | Keep `validateSize`, `buildFilePart`, `pollClipboard` contract tests. Add `encodeFileToBase64` tests. Drop `readClipboard` block (relocated to `windows.test.ts`). |
| `screenshot-service.platforms/windows.test.ts` | Create | Tests for Windows `spawnSnipping` + `readCapturedImage` (moved from current `readClipboard` block, renamed to `readCapturedImage`). `test.skip()` outside `win32`. |
| `screenshot-service.platforms/macos.test.ts` | Create | Tests for macOS `spawnSnipping` + `readCapturedImage`, including permission detection. `test.skip()` outside `darwin`. |
| `screenshot-service.platforms/linux.test.ts` | Create | Tests for Linux chains (X11, Wayland, headless, ImageMagick probe). `test.skip()` outside `linux`. |
| `screenshot-to-chat.tsx` | Modify | Drop lines 51–57 (the `if (process.platform !== "win32")` guard and its toast). Import `readCapturedImage` is implicit (entry only uses `pollClipboard` + `spawnSnipping`; no clipboard rename in the entry). |

## 3. Sequence Diagrams

### 3.1 Cold-start: dispatcher binds platform module

```
[import screenshot-service.ts]
        │
        ▼
  process.platform ?  ──"win32"──► ./screenshot-service.platforms/windows.ts
                    ├──"darwin"──► ./screenshot-service.platforms/macos.ts
                    ├──"linux"───► ./screenshot-service.platforms/linux.ts
                    └──other─────► throw Error("Unsupported platform: <x>")
        │
        ▼
  M = { win32: w, darwin: m, linux: l }[process.platform]
  export spawnSnipping       = M.spawnSnipping
  export readCapturedImage   = M.readCapturedImage
```

### 3.2 Windows capture flow (unchanged)

```
[handleCapture] ─► spawnSnipping() ─► Bun.spawn([SnippingTool.exe, "/clip"])
                                              │
                                              ▼
                                         [user selects region]
                                              │
                                              ▼
                                  proc.exited (exitCode === 0)
                                              │
                                              ▼
                                       { ok: true }
                                              │
                                              ▼
[handleCapture] ─► pollClipboard() ─► readCapturedImage() ─► Bun.spawn([powershell, -NoProfile, -NonInteractive, -Command, CLIPBOARD_PS_SCRIPT])
                                                                      │
                                                                      ▼
                                                              [PS: System.Windows.Forms.Clipboard]
                                                                      │
                                                                      ▼
                                                              base64 JPEG (q75, ≤1568px)
                                                                      │
                                                                      ▼
                                                              { ok: true, base64, sizeBytes }
```

### 3.3 macOS capture flow (success)

```
[handleCapture] ─► spawnSnipping()
        │
        ▼
  Bun.spawn(["screencapture", "-i", "/tmp/screenshot-to-chat-<uuid>.png"])
        │
        ▼
  [user selects region OR window]
        │
        ├──Escape──► no file written
        │              └──► { ok: false, error: { type: "user_cancelled" } }
        │
        └──confirmed──► file exists, size > 0
                        └──► { ok: true }
                              │
                              ▼
[handleCapture] ─► pollClipboard() ─► readCapturedImage()
        │
        ▼
  stat tmp.png
        │
        ├──size < 4096 bytes──► return { ok: false, error: { type: "permission_missing", platform: "darwin", fix: <System Settings…> } }
        │
        └──size >= 4096──► Bun.spawn(["sips", "-Z", "1568", "-s", "format", "jpeg", "-s", "formatOptions", "75", tmp.png, "--out", tmp.jpg])
                              │
                              ▼
                         finally: rm tmp.png tmp.jpg
                              │
                              ▼
                          encodeFileToBase64(tmp.jpg)  // base64 -i tmp.jpg | tr -d '\n'
                              │
                              ▼
                          base64 JPEG
```

### 3.4 macOS permission denial flow

```
[readCapturedImage on macOS]
        │
        ▼
  stat /tmp/screenshot-to-chat-<uuid>.png
        │
        ├──ENENT (no file)──► return null  [handled in spawnSnipping as user_cancelled]
        │
        └──exists, size = e.g. 2.1 KB
                │
                ▼
        size < 4096 ──► return { ok: false, error: { type: "permission_missing", platform: "darwin", fix: "macOS Screen Recording permission required. Open System Settings → Privacy & Security → Screen Recording and enable access for this terminal." } }
        │
        ▼
[handleCapture] sees spawnResult.ok === true (file existed) but readCapturedImage returns permission_missing
        │
        ▼
  api.ui.toast({ variant: "error", message: error.fix })
```

Note: `permission_missing` is returned from `readCapturedImage` (not from `spawnSnipping`), and is propagated through the poll result because `pollClipboard` returns `{ ok: false, error }` when `readCapturedImage` returns `null`. To make `permission_missing` distinguishable from a `null` "no image yet", the macOS module returns a `{ ok: false, error }` object — the dispatcher contract widens: `readCapturedImage` may return `string | null | { ok: false; error: CaptureError }`. `pollClipboard` checks for the object form and surfaces it immediately instead of retrying. (See §5.4 for the rename rationale and §4.l for the `encodeFileToBase64` contract.)

### 3.5 Linux capture flow — X11

```
[handleCapture] ─► spawnSnipping() [linux]
        │
        ▼
  detectSession()
        │
        ├──$XDG_SESSION_TYPE == "x11"  ──► X11
        ├──$WAYLAND_DISPLAY set       ──► wayland
        ├──$DISPLAY set               ──► x11
        └──all unset                  ──► { ok: false, error: { type: "tool_unavailable", message: "no display server" } }
        │
        ▼ (X11)
  Bun.spawn(["which", "scrot"])  →  exitCode === 0 ?
        │
        ├──YES──► Bun.spawn(["scrot", "-s", "/tmp/screenshot-to-chat-<uuid>.png"])  ──► { ok: true }
        │
        └──NO──► Bun.spawn(["which", "maim"])  →  exitCode === 0 ?
                       │
                       ├──YES──► Bun.spawn(["maim", "-s", "/tmp/screenshot-to-chat-<uuid>.png"])  ──► { ok: true }
                       │
                       └──NO───► { ok: false, error: { type: "tool_unavailable", message: install instructions for scrot (and maim) via apt/dnf/pacman/brew } }
```

### 3.6 Linux capture flow — Wayland

```
[handleCapture] ─► spawnSnipping() [linux] ─► detectSession() == "wayland"
        │
        ▼
  Bun.spawn(["which", "slurp"]) && Bun.spawn(["which", "grim"])
        │
        ├──BOTH──► Bun.spawn(["sh", "-c", "slurp | grim -g - /tmp/screenshot-to-chat-<uuid>.png"])  ──► { ok: true }
        │
        └──any missing──► Bun.spawn(["which", "gnome-screenshot"])
                                │
                                ├──YES──► Bun.spawn(["gnome-screenshot", "-a", "-f", "/tmp/...png"])  ──► { ok: true }
                                │
                                └──NO──► Bun.spawn(["which", "spectacle"])
                                              │
                                              ├──YES──► Bun.spawn(["spectacle", "--region", "--output", "/tmp/...png"])  ──► { ok: true }
                                              │
                                              └──NO───► { ok: false, error: { type: "tool_unavailable", message: install instructions for all three chains } }
```

### 3.7 Linux headless rejection

```
[handleCapture] ─► spawnSnipping() [linux]
        │
        ▼
  env: $DISPLAY unset AND $WAYLAND_DISPLAY unset AND $XDG_SESSION_TYPE unset
        │
        ▼
  return { ok: false, error: { type: "tool_unavailable", message: "no display server — set $DISPLAY or $WAYLAND_DISPLAY" } }
        │
        ▼
  NO Bun.spawn calls made (zero subprocess overhead)
```

### 3.8 Shared error mapping (entry point toast)

```
[handleCapture]
        │
        ├──spawnResult.error.type
        │     ├──"tool_unavailable"  ─► toast(error)  // error.message has install hint
        │     ├──"spawn_failed"      ─► toast("Failed to launch capture tool: " + error.message)
        │     ├──"user_cancelled"    ─► silent (no toast)
        │     └──"permission_missing"──► toast(error.fix)  // system-settings string
        │
        ├──pollResult.error.type
        │     ├──"poll_timeout"      ─► toast("Capture timed out — no image detected")
        │     └──"tool_unavailable" / "permission_missing"  ─► toast(error.fix | error.message)
        │
        ├──sizeResult.error.type
        │     └──"size_exceeded"     ─► toast("Screenshot exceeds 3 MB limit — try a smaller region")
        │
        └──submit throws            ─► toast("Failed to send screenshot: " + err.message)
```

## 4. Implementation Details

### 4.a `sips` invocation for macOS

```
sips -Z 1568 -s format jpeg -s formatOptions 75 <input.png> --out <output.jpg>
```

- `-Z 1568` — fit longest edge to 1568px, preserving aspect ratio. Does NOT upscale if already smaller.
- `-s format jpeg` — output format JPEG.
- `-s formatOptions 75` — JPEG quality 75.
- `--out <output.jpg>` — output path.

`sips` is built into macOS (`/usr/bin/sips`); no install step. Exit code 0 on success.

### 4.b `screencapture` invocation for macOS

```
screencapture -i /tmp/screenshot-to-chat-<uuid>.png
```

- `-i` — interactive: capture a region OR a window (user clicks). Without `-i`, screencapture is silent/full-screen.
- User cancellation (Escape): no file is written. We detect this by `stat`-ing the path after exit; if `exists === false`, the user pressed Escape.
- Exit code 0 on success and on Escape. Exit code non-zero ⇒ `tool_unavailable`.

### 4.c macOS permission detection

After `screencapture` writes a file, we `Bun.file(path).size` it. If `size < 4096`, the file is suspiciously small and is treated as `permission_missing`.

Why 4 KB? When Screen Recording permission is denied, macOS's TCC stack returns a near-empty PNG (~200–3000 bytes) instead of the captured pixels. 4 KB is well above that ceiling but well below any real-region screenshot (a 200×100 region already produces >5 KB PNG).

**Rejected alternative**: all-black pixel check via `sips -g pixelWidth -g pixelHeight` + a small sampling script. Robust against cropped/empty regions but requires a second subprocess and image parsing. The size heuristic catches the permission case in practice (the screencapture binary writes the placeholder PNG and exits 0) and is much simpler. If false positives become a real issue, the design can be extended with the pixel check later.

### 4.d macOS base64 encoding

```
base64 -i /tmp/screenshot-to-chat-<uuid>.jpg | tr -d '\n'
```

- `base64` on macOS is BSD-derived; `-i` is the BSD flag for "read from file". GNU's `-w 0` is NOT available.
- `tr -d '\n'` strips the line-wrapping that BSD `base64` inserts every 76 chars.

Alternative considered: `base64 < file` (stdin redirect) works on both BSD and GNU, but with `Bun.spawn` the cleanest portable form is `-i file | tr -d '\n'`.

### 4.e Linux session detection

Invoked via a `Bun.spawn(["sh", "-c", '...'])` with this script:

```sh
if [ -n "$XDG_SESSION_TYPE" ]; then
  echo "$XDG_SESSION_TYPE"
elif [ -n "$WAYLAND_DISPLAY" ]; then
  echo "wayland"
elif [ -n "$DISPLAY" ]; then
  echo "x11"
else
  echo "none"
fi
```

Read stdout, `trim()`, compare to `"x11" | "wayland" | "none"`. The `sh -c` invocation is cheap (no `npm` deps, no native binary) and matches the existing `CLIPBOARD_PS_SCRIPT` pattern of inline string constants. For tests, `Bun.spawn` is mocked to return a string on stdout.

### 4.f Linux X11 capture chain

- `Bun.spawn(["which", "scrot"])` → check `exitCode === 0`. Cheap; no fallback tool spawned if absent.
- If scrot found: `Bun.spawn(["scrot", "-s", tmpPath])`. `scrot -s` = interactive selection.
- If not: `Bun.spawn(["which", "maim"])` → if found: `Bun.spawn(["maim", "-s", tmpPath])`. `maim -s` = interactive selection.
- If neither: `tool_unavailable` with a `message` containing install instructions:
  - apt: `sudo apt install scrot` (or `maim`)
  - dnf: `sudo dnf install scrot`
  - pacman: `sudo pacman -S scrot`
  - brew: `brew install scrot`

### 4.g Linux Wayland capture chain

- `Bun.spawn(["which", "slurp"])` AND `Bun.spawn(["which", "grim"])` — both must be present. If both: `Bun.spawn(["sh", "-c", `slurp | grim -g - ${tmpPath}`])`. The `-g -` tells grim to read geometry from stdin (slurp prints the geometry).
- Else: `Bun.spawn(["which", "gnome-screenshot"])` → if found: `Bun.spawn(["gnome-screenshot", "-a", "-f", tmpPath])`. `-a` = area, `-f` = file.
- Else: `Bun.spawn(["which", "spectacle"])` → if found: `Bun.spawn(["spectacle", "--region", "--output", tmpPath])`. `--region` is the interactive region mode for KDE.
- Else: `tool_unavailable` with install instructions for all three (slurp+grim, gnome-screenshot, spectacle).

### 4.h Linux ImageMagick detection

- `Bun.spawn(["which", "magick"])` → if found: `Bun.spawn(["magick", input, "-resize", "1568x1568", "-quality", "75", output])`.
- Else: `Bun.spawn(["which", "convert"])` → if found: `Bun.spawn(["convert", input, "-resize", "1568x1568", "-quality", "75", output])`.
- Else: `tool_unavailable` with install instructions:
  - apt: `sudo apt install imagemagick`
  - dnf: `sudo dnf install ImageMagick`
  - pacman: `sudo pacman -S imagemagick`
  - brew: `brew install imagemagick`

`-resize 1568x1568` shrinks to fit the bounding box, preserving aspect ratio, and does NOT upscale. Equivalent to macOS `sips -Z 1568`.

### 4.i Linux base64 encoding

```
base64 -w 0 /tmp/screenshot-to-chat-<uuid>.jpg
```

GNU coreutils `-w 0` disables line wrapping. Available on all Linux distros. (macOS uses the BSD form; see §4.d.)

### 4.j Temp file naming

```typescript
const tmpPath = `/tmp/screenshot-to-chat-${crypto.randomUUID()}.png`;
```

`crypto.randomUUID()` is part of Bun's Web Crypto; no import needed. Two temp files per capture: the raw capture (`.png`) and the resized output (`.jpg` for macOS, `.jpg` for Linux). Both are cleaned up in `finally`.

`chmod 600` is not required: on most distros `/tmp` is `1777` (sticky world-writable); per-file `chmod 600` would block other users' tools from reading the file mid-capture. The cleanup in `finally` is the security boundary.

### 4.k Temp file cleanup pattern

```typescript
const tmpPng = `/tmp/screenshot-to-chat-${crypto.randomUUID()}.png`;
const tmpJpg = tmpPng.replace(/\.png$/, ".jpg");
try {
  // spawn capture tool → tmpPng
  // spawn sips/magick → tmpJpg
  // base64 tmpJpg
  return base64;
} finally {
  await Bun.spawn(["rm", "-f", tmpPng, tmpJpg]).exited;
}
```

`rm -f` swallows missing files, so a partial-failure scenario (e.g., capture wrote but sips failed) still cleans up cleanly. The `await … .exited` keeps the process alive long enough for rm to finish; we do not need to capture stdout/stderr.

### 4.l Shared `encodeFileToBase64(path)`

```typescript
export async function encodeFileToBase64(path: string): Promise<string | null> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    const buffer = await file.arrayBuffer();
    return Buffer.from(buffer).toString("base64");
  } catch {
    return null;
  }
}
```

**Contract**:
- Returns the base64-encoded file contents on success.
- Returns `null` if the file does not exist, the read throws, or the buffer is empty.
- Does NOT delete the file. Cleanup is the caller's responsibility, in their own `try/finally`.

Rationale for `Buffer.from(...).toString("base64")` over `btoa()`: `btoa` is limited to binary strings and breaks on raw bytes; `Buffer.from(arrayBuffer).toString("base64")` handles arbitrary bytes including JPEG's binary content safely.

### 4.m `permission_missing` error variant

```typescript
| { type: "permission_missing"; platform: "darwin"; fix: string }
```

Default `fix` string (English, for direct display in a toast):

> "macOS Screen Recording permission required. Open System Settings → Privacy & Security → Screen Recording and enable access for this terminal."

Stored as a module-level `const MACOS_PERMISSION_FIX = "..."` in `screenshot-service.platforms/macos.ts` so it can be unit-tested and eventually localized.

### 4.n Entry point change (`screenshot-to-chat.tsx`)

Delete lines 51–57 verbatim:

```typescript
  if (process.platform !== "win32") {
    api.ui.toast({
      variant: "warning",
      message: "Screenshot capture is only supported on Windows in this version",
    });
    return;
  }
```

The resulting `handleCapture` is 100% platform-agnostic. The import block is unchanged (`spawnSnipping`, `pollClipboard`, `validateSize`, `buildFilePart`); `readCapturedImage` is not imported here because `pollClipboard` already calls it. The `api.ui.toast` calls for `permission_missing` and `tool_unavailable` (with install instructions) are added inside the existing error branches.

## 5. Architecture Decisions

| # | Decision | Choice | Alternatives | Rationale |
|---|----------|--------|--------------|-----------|
| ADR-1 | Platform routing | `process.platform` at module load | Runtime detection; user config | Single binary, zero user friction, sub-microsecond cost. Runtime detection is redundant (the OS doesn't change mid-process) and would slow every call. Config adds a setup step. |
| ADR-2 | Capture pipeline shape | File-based: tool → /tmp file → sips/convert → base64 | Clipboard path (osascript on Mac, xclip/wl-paste on Linux) | File-based is uniform across all three OSes, lets us `stat` for permission detection and user-cancel detection, and avoids clipboard encoding bugs (HTML vs PNG vs TIFF) that historically plague clipboard bridges. |
| ADR-3 | macOS permission detection | File-size heuristic (< 4 KB) | TCC db read; CGRequestScreenCaptureAccess | TCC db schema changes between macOS versions and requires entitlements we don't have. CGRequestScreenCaptureAccess isn't exposed to non-trusted apps. The 4 KB heuristic catches the placeholder PNG that screencapture writes when denied, in practice. |
| ADR-4 | Rename `readClipboard` → `readCapturedImage` | Rename everywhere; no alias | Keep name (misleading on Mac/Linux); add alias (extra API surface) | "Clipboard" is a Windows-specific artifact. Mac/Linux capture to a file, not a clipboard. The rename makes the contract accurate. An alias would tempt future consumers to depend on the old name. |
| ADR-5 | Linux tool fallback chains | X11: scrot → maim; Wayland: grim+slurp → gnome-screenshot → spectacle | Single tool per session type; auto-install | Single tool is fragile — if a user lacks that exact tool, the plugin is unusable. Auto-install requires root and is out of scope. Chains give every common desktop a working path: wlroots (Sway/Hyprland/Niri via slurp+grim), GNOME (Wayland or X11 via gnome-screenshot), KDE (Wayland or X11 via spectacle), bare X11 (scrot or maim). |
| ADR-6 | Per-platform test files with `test.skip` | `screenshot-service.platforms/{os}.test.ts`; skip outside host | One mega test file; no tests for non-host platforms | Mega file is unwieldy and hard to skip cleanly. No tests for non-host means CI on Mac has no Mac coverage. Per-platform files with `test.skip(process.platform !== "darwin")` at the top of `describe` blocks keep tests colocated with code and runnable when the host matches. |
| ADR-7 | `readCapturedImage` return type | `string \| null \| { ok: false; error: CaptureError }` | `string \| null` only (lose permission_missing); throw permission_missing (breaks existing poll contract) | The existing `pollClipboard` already inspects `readCapturedImage`'s return to decide whether to keep polling. Widening to include the error object lets `permission_missing` short-circuit the poll loop without throwing. The `null` case still means "no image yet, keep polling". |
| ADR-8 | Linux session detection via `sh -c` | Inline shell script invoked via `Bun.spawn(["sh", "-c", "..."])` | Pure JS env reads; native helper | Pure JS env reads (`process.env.XDG_SESSION_TYPE`) miss the precedence logic (XDG wins, then WAYLAND_DISPLAY, then DISPLAY). Native helper means a build dep. The `sh -c` pattern matches `CLIPBOARD_PS_SCRIPT` already in the codebase and is trivially mockable. |

## 6. Test Strategy

### 6.1 `screenshot-service.test.ts` (shared — runs on any platform)

| Block | What | Mock | Assert |
|-------|------|------|--------|
| `validateSize` | Unchanged — accept under/at limit, reject over, handle empty | none | Result shape, `sizeBytes` value, `limitBytes` on exceed |
| `buildFilePart` | Unchanged — shape + data URL | none | `type: "file"`, `mime: "image/jpeg"`, `url` prefix, `url` ends with base64 |
| `encodeFileToBase64` (NEW) | Returns base64 of file contents | `Bun.file` (or real fs in tmp dir) | Decoded buffer matches input; `null` for missing path; `null` when read throws |
| `pollClipboard` (contract) | Unchanged — result shape | none | `{ ok: true, base64, sizeBytes }` and `{ ok: false, error: { type: "poll_timeout" } }` shapes |

The existing `readClipboard` block (lines 73–148) is **removed** from this file. Its tests relocate to `windows.test.ts` (renamed to `readCapturedImage`).

### 6.2 `screenshot-service.platforms/windows.test.ts`

Skip pattern at top:
```typescript
const itWin = process.platform === "win32" ? it : it.skip;
```

| Test | Mock `Bun.spawn` to return | Assert |
|------|---------------------------|--------|
| `spawnSnipping` → exit 0 | `{ exitCode: 0, exited: Promise.resolve(0), … }` | `{ ok: true }` |
| `spawnSnipping` → exit 1 | `{ exitCode: 1, … }` | `{ ok: false, error: { type: "tool_unavailable" } }` |
| `spawnSnipping` → throws | `throw new Error("ENOENT")` | `{ ok: false, error: { type: "spawn_failed", message: "ENOENT" } }` |
| `readCapturedImage` → has image | `{ stdout: <base64 stream>, exitCode: 0, … }` | Returns trimmed base64 |
| `readCapturedImage` → empty stdout | `{ stdout: "", exitCode: 0, … }` | Returns `null` |
| `readCapturedImage` → non-zero exit | `{ stdout: "", exitCode: 1, … }` | Returns `null` |
| `readCapturedImage` → throws | `throw` | Returns `null` |

### 6.3 `screenshot-service.platforms/macos.test.ts`

Skip pattern: `process.platform === "darwin"` guard.

| Test | Mock | Assert |
|------|------|--------|
| `spawnSnipping` → file written | Spawn `screencapture` succeeds; `Bun.file(tmp).exists` true; size > 0 | `{ ok: true }`; argv contains `["screencapture", "-i", tmpPath]` |
| `spawnSnipping` → no file (Escape) | `Bun.file(tmp).exists` false | `{ ok: false, error: { type: "user_cancelled" } }` |
| `readCapturedImage` → success | `Bun.file(tmp).size` ≥ 4096; sips spawn exits 0; base64 spawn returns "abc==" | Returns "abc==" |
| `readCapturedImage` → small file (permission) | `Bun.file(tmp).size` = 2000 | Returns `{ ok: false, error: { type: "permission_missing", platform: "darwin", fix: <MACOS_PERMISSION_FIX> } }` |
| `readCapturedImage` → cleanup | Real `rm` invocation in finally | `Bun.spawn` called with `["rm", "-f", tmpPng, tmpJpg]` |

### 6.4 `screenshot-service.platforms/linux.test.ts`

Skip pattern: `process.platform === "linux"` guard.

| Test | Mock | Assert |
|------|------|--------|
| `spawnSnipping` headless | All `process.env` reads return undefined | `{ ok: false, error: { type: "tool_unavailable" } }`; no `Bun.spawn` for capture tools |
| `spawnSnipping` X11 — scrot found | `which scrot` exitCode 0; `scrot -s` writes file | `{ ok: true }`; maim never invoked |
| `spawnSnipping` X11 — maim fallback | `which scrot` exitCode 1; `which maim` exitCode 0; maim writes | `{ ok: true }` |
| `spawnSnipping` X11 — neither | Both `which` exitCode 1 | `{ ok: false, error: { type: "tool_unavailable", message: includes "apt", "dnf", "pacman", "brew" } }` |
| `spawnSnipping` Wayland — grim+slurp | Both `which` exitCode 0; `sh -c "slurp \| grim …"` writes | `{ ok: true }` |
| `spawnSnipping` Wayland — gnome-screenshot | `which slurp` fails, `which grim` ok, `which gnome-screenshot` ok | `{ ok: true }`; uses gnome-screenshot |
| `spawnSnipping` Wayland — spectacle | All above fail, `which spectacle` ok | `{ ok: true }`; uses spectacle |
| `spawnSnipping` Wayland — none | All `which` fail | `{ ok: false, error: { type: "tool_unavailable" } }` |
| `readCapturedImage` — magick v7 | `which magick` ok; magick resize exits 0; base64 returns string | Returns base64 |
| `readCapturedImage` — convert v6 | `which magick` fails; `which convert` ok; convert resize exits 0 | Returns base64 |
| `readCapturedImage` — neither | Both `which` fail | `{ ok: false, error: { type: "tool_unavailable" } }` |
| `readCapturedImage` — cleanup | n/a | `rm` invoked with both tmp paths |

### 6.5 Mock pattern (replicated in every new test file)

```typescript
let originalSpawn: typeof Bun.spawn;

beforeEach(() => {
  originalSpawn = Bun.spawn;
});

afterEach(() => {
  (Bun as any).spawn = originalSpawn;
});

(Bun as any).spawn = mock(() => ({
  stdout: new Response("base64string\n").body,
  stderr: new Response("").body,
  exitCode: 0,
  exited: Promise.resolve(0),
  pid: 1234,
  kill: mock(() => {}),
  ref: mock(() => {}),
  unref: mock(() => {}),
}));
```

For `Bun.file(...).exists` and `.size`, the tests use a real temp file (`os.tmpdir()/test-<uuid>.bin`) when possible (deterministic size from `Bun.write`) and mock only when the test needs a specific size (e.g., 2000 bytes for the permission case). This avoids mocking the entire `Bun.file` surface.

For env-var reads (Linux session detection), tests use `process.env = { …originals, XDG_SESSION_TYPE: "x11" }` with restoration in `afterEach`.

## 7. Open Questions

None — the 7 locked decisions from the proposal cover all implementation forks. ADR-7 (widening the `readCapturedImage` return type to include the error object) is a new decision surfaced by the design phase; it does not contradict any locked decision and the spec's "scenarios" pass against either implementation as long as the `permission_missing` error reaches the toast.
