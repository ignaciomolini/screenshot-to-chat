# Spec: screenshot-capture

## Purpose

Cross-platform screenshot capture pipeline. A dispatcher routes capture calls to a per-platform module (Windows, macOS, Linux), produces a base64-encoded JPEG resized to fit within `MAX_DIMENSION` (1568px) on its longest edge at `JPEG_QUALITY` (75), and surfaces a typed `CaptureError` union on failure.

## Requirements

### Requirement: Platform Routing

The dispatcher SHALL bind `spawnSnipping` and `readCapturedImage` to the per-platform module matching `process.platform` (`win32` → Windows, `darwin` → macOS, `linux` → Linux), and SHALL throw an `Error` for any other value of `process.platform`.

#### Scenario: Supported platform is bound

- GIVEN `process.platform` is `"win32"`, `"darwin"`, or `"linux"`
- WHEN the dispatcher module is imported
- THEN `spawnSnipping` and `readCapturedImage` SHALL be functions bound to that platform's module

#### Scenario: Unsupported platform throws

- GIVEN `process.platform` is any value other than `win32`/`darwin`/`linux` (e.g. `"freebsd"`)
- WHEN the dispatcher module is imported
- THEN it SHALL throw an `Error` whose message contains the unsupported platform string

### Requirement: Renamed Export

The dispatcher module SHALL export a function named `readCapturedImage`. It SHALL NOT export a function named `readClipboard`.

#### Scenario: Old name is no longer exported

- GIVEN the dispatcher module is imported
- WHEN a consumer reads `readCapturedImage` and `readClipboard` from it
- THEN `readCapturedImage` SHALL be a function and `readClipboard` SHALL be `undefined`

### Requirement: Windows Capture

On Windows, `spawnSnipping` SHALL launch `SnippingTool /clip` and resolve `{ ok: true }` on exit code 0, `{ ok: false, error: { type: "tool_unavailable" } }` on any other exit code, and `{ ok: false, error: { type: "spawn_failed", message } }` if `Bun.spawn` throws.

On Windows, `readCapturedImage` SHALL read the clipboard via PowerShell and return a base64-encoded JPEG resized to `MAX_DIMENSION` at `JPEG_QUALITY`, or `null` if the clipboard has no image, PowerShell exits non-zero, or `Bun.spawn` throws.

#### Scenario: SnippingTool exits cleanly

- GIVEN `Bun.spawn` for `SnippingTool /clip` resolves with `exitCode = 0`
- WHEN `spawnSnipping()` is called
- THEN it SHALL resolve `{ ok: true }`

#### Scenario: SnippingTool exits non-zero

- GIVEN `Bun.spawn` for `SnippingTool /clip` resolves with `exitCode = 1`
- WHEN `spawnSnipping()` is called
- THEN it SHALL resolve `{ ok: false, error: { type: "tool_unavailable" } }`

#### Scenario: Clipboard has an image

- GIVEN PowerShell returns a non-empty base64 string and exits 0
- WHEN `readCapturedImage()` is called
- THEN it SHALL resolve with that trimmed base64 string

### Requirement: macOS Capture

On macOS, `spawnSnipping` SHALL run `screencapture -i /tmp/<file>.png` and resolve `{ ok: true }` when the file exists with non-zero size, `{ ok: false, error: { type: "user_cancelled" } }` when no file is written (Escape), and `{ ok: false, error: { type: "tool_unavailable" } }` when `screencapture` is missing or exits non-zero.

#### Scenario: User finishes capture

- GIVEN `screencapture` exits 0 and `/tmp/<file>.png` exists with size > 0
- WHEN `spawnSnipping()` is called
- THEN it SHALL resolve `{ ok: true }`

#### Scenario: User presses Escape

- GIVEN `screencapture` exits 0 but `/tmp/<file>.png` does not exist
- WHEN `spawnSnipping()` is called
- THEN it SHALL resolve `{ ok: false, error: { type: "user_cancelled" } }`

### Requirement: macOS Permission Detection

On macOS, after a successful capture, the system SHALL inspect the captured PNG. If the file is smaller than 4 KB or is detected as all-black, the capture SHALL be rejected with `{ type: "permission_missing", platform: "darwin", fix: <System Settings instructions> }` where `fix` is suitable for direct display in a toast.

#### Scenario: Small PNG (Screen Recording denied)

- GIVEN a captured file whose size is 3 KB (below the 4 KB threshold)
- WHEN the post-capture check runs
- THEN it SHALL return a `permission_missing` error whose `fix` string points to System Settings → Privacy & Security → Screen Recording

### Requirement: macOS Image Processing

On macOS, `readCapturedImage` SHALL resize the captured PNG to fit within `MAX_DIMENSION` preserving aspect ratio and encode it as JPEG at `JPEG_QUALITY` using `sips`, then base64-encode the result. The intermediate temp file SHALL be removed in a `finally` block regardless of success or failure.

#### Scenario: PNG resized and base64-encoded

- GIVEN a valid PNG at `/tmp/<file>.png` larger than 1568px on the long edge
- WHEN `readCapturedImage()` is called
- THEN it SHALL resolve with a base64-encoded JPEG whose decoded dimensions are ≤ 1568px on the long edge
- AND THEN the temp file SHALL no longer exist

### Requirement: Linux Headless Detection

On Linux, before any capture attempt, the system SHALL return `{ ok: false, error: { type: "tool_unavailable" } }` with a "no display server" message if neither `$DISPLAY` nor `$WAYLAND_DISPLAY` is set. No capture tool SHALL be spawned in this state.

#### Scenario: No display server

- GIVEN `$DISPLAY` and `$WAYLAND_DISPLAY` are both unset
- WHEN the Linux capture entry is invoked
- THEN it SHALL return a `tool_unavailable` error without spawning any capture subprocess

### Requirement: Linux Session Detection

On Linux, the system SHALL determine the session type by reading `$XDG_SESSION_TYPE` first. If empty or unset, it SHALL fall back to `$WAYLAND_DISPLAY` set → `wayland`, otherwise to `$DISPLAY` set → `x11`, otherwise treat as headless.

#### Scenario: XDG_SESSION_TYPE wins over env vars

- GIVEN `$XDG_SESSION_TYPE=wayland`, `$WAYLAND_DISPLAY=""`, `$DISPLAY=:0`
- WHEN session detection runs
- THEN the detected session type SHALL be `wayland`

#### Scenario: Fallback to WAYLAND_DISPLAY

- GIVEN `$XDG_SESSION_TYPE=""`, `$WAYLAND_DISPLAY=wayland-0`, `$DISPLAY=""`
- WHEN session detection runs
- THEN the detected session type SHALL be `wayland`

### Requirement: Linux X11 Capture Chain

On Linux under X11, the system SHALL attempt capture in order: (1) `scrot -s /tmp/<file>.png`; (2) if `scrot` is missing, `maim -s /tmp/<file>.png`; (3) if both are missing or both fail, return `tool_unavailable` whose message includes per-distro install instructions for `scrot` (and `maim`) covering `apt`, `dnf`, `pacman`, and `brew`.

#### Scenario: scrot captures successfully

- GIVEN `scrot` is installed and writes a valid PNG on exit
- WHEN the X11 capture runs
- THEN `scrot` SHALL be the tool used and `maim` SHALL NOT be invoked

#### Scenario: Neither tool installed

- GIVEN neither `scrot` nor `maim` are on `PATH`
- WHEN the X11 capture runs
- THEN it SHALL return a `tool_unavailable` error whose message includes install instructions for `apt`, `dnf`, `pacman`, and `brew`

### Requirement: Linux Wayland Capture Chain

On Linux under Wayland, the system SHALL attempt capture in order: (1) `slurp | grim -g - /tmp/<file>.png`; (2) if either tool is missing or the pipeline fails, `gnome-screenshot -a -f /tmp/<file>.png`; (3) if that fails, `spectacle --region --output /tmp/<file>.png`; (4) if all fail, return `tool_unavailable` with install instructions for the failed tools.

#### Scenario: grim+slurp succeeds

- GIVEN `slurp` and `grim` are installed and produce a valid PNG
- WHEN the Wayland capture runs
- THEN the PNG SHALL be the result and no fallback tool SHALL be invoked

#### Scenario: All three fallbacks fail

- GIVEN none of `slurp`/`grim`, `gnome-screenshot`, or `spectacle` are on `PATH`
- WHEN the Wayland capture runs
- THEN it SHALL return a `tool_unavailable` error whose message includes install instructions for each tool

### Requirement: Linux Image Processing

On Linux, the system SHALL probe for `magick` (ImageMagick v7); if missing, probe for `convert` (ImageMagick v6); if neither is found, return `tool_unavailable`. The detected tool SHALL resize the captured image to fit within 1568×1568 preserving aspect ratio and encode JPEG at quality 75 to a temp file, which is then base64-encoded.

#### Scenario: ImageMagick v7 available

- GIVEN `magick` is on `PATH` and exits 0 on the resize/encode command
- WHEN the resize runs
- THEN `magick` SHALL be the tool used and the output SHALL be a base64-encoded JPEG

#### Scenario: Neither ImageMagick version installed

- GIVEN neither `magick` nor `convert` are on `PATH`
- WHEN the Linux capture+processing pipeline runs
- THEN it SHALL return a `tool_unavailable` error with install instructions

### Requirement: Shared `encodeFileToBase64`

The system SHALL provide a shared helper `encodeFileToBase64(path)` that reads the file at `path`, returns its base64-encoded contents, and returns `null` if the file does not exist or cannot be read. The input file SHALL be removed in a `finally` block regardless of success or failure.

#### Scenario: Reads a file and returns base64

- GIVEN a file at `/tmp/img.jpg` whose raw bytes are `b"hello"`
- WHEN `encodeFileToBase64("/tmp/img.jpg")` is called
- THEN it SHALL resolve with the base64 encoding of `b"hello"`
- AND THEN the file at `/tmp/img.jpg` SHALL no longer exist

#### Scenario: Missing file returns null

- GIVEN no file exists at `/tmp/missing.jpg`
- WHEN `encodeFileToBase64("/tmp/missing.jpg")` is called
- THEN it SHALL resolve with `null`

### Requirement: `permission_missing` Error Variant

The `CaptureError` union SHALL include a member with shape `{ type: "permission_missing"; platform: "darwin"; fix: string }`. The `fix` string SHALL be a human-readable instruction pointing to System Settings → Privacy & Security → Screen Recording.

#### Scenario: Variant is part of the type union

- GIVEN the `CaptureError` type
- WHEN a consumer narrows on `error.type === "permission_missing"`
- THEN `error.platform` SHALL be typed as `"darwin"` and `error.fix` SHALL be typed as `string`

### Requirement: Entry Point Decoupling

The entry file `screenshot-to-chat.tsx` SHALL NOT contain a `process.platform` guard. The `handleCapture` function SHALL call `spawnSnipping` and `pollClipboard` directly without checking the host OS. The `if (process.platform !== "win32") { ...; return; }` block SHALL be removed.

#### Scenario: No platform guard in entry

- GIVEN the file `screenshot-to-chat.tsx`
- WHEN the file is searched for `process.platform`
- THEN no matches SHALL be found inside `handleCapture` or any other function in the file

### Requirement: `pollClipboard` Polling Loop Unchanged

The `pollClipboard` function SHALL keep its existing behavior: poll `readCapturedImage` every `POLL_INTERVAL_MS` up to `POLL_TIMEOUT_MS`, return `{ ok: true, base64, sizeBytes: base64.length }` on the first non-null hit, and return `{ ok: false, error: { type: "poll_timeout" } }` if the budget is exhausted.

#### Scenario: First hit returns success without further polls

- GIVEN `readCapturedImage` returns a base64 string on the first poll
- WHEN `pollClipboard()` is called
- THEN it SHALL resolve with `{ ok: true, base64, sizeBytes: base64.length }`
- AND THEN `readCapturedImage` SHALL NOT be called again

#### Scenario: Budget exhausted

- GIVEN `readCapturedImage` always returns `null`
- WHEN `pollClipboard()` runs to completion
- THEN it SHALL resolve with `{ ok: false, error: { type: "poll_timeout" } }`
