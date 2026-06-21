# Proposal: Multi-Platform Support for screenshot-to-chat

## Why

Entry point short-circuits non-Windows hosts (`screenshot-to-chat.tsx:51`). Linux/macOS users are blocked. Windows MUST stay green; new paths are additive.

## What Changes

Dispatcher in `screenshot-service.ts` routes by `process.platform`. Windows code moves to `screenshot-service.platforms/windows.ts` (no behavior change). Add `macos.ts` (`screencapture -i` + `sips`) and `linux.ts` (X11/Wayland fallback chain + ImageMagick v6/v7 probe). Rename `readClipboard` → `readCapturedImage`. Add shared `encodeFileToBase64(path)`. Drop the platform guard in the entry point.

## Impact

- **New**: `screenshot-service.platforms/{windows,macos,linux}.ts` + 3 test files (`skip` on non-host).
- **Modified**: `screenshot-service.ts` (dispatcher), `screenshot-to-chat.tsx` (drop guard), `screenshot-service.test.ts` (rename + new tests).
- **Renamed export**: `readClipboard` → `readCapturedImage`.
- **New `CaptureError`**: `{ type: "permission_missing"; platform: "darwin"; fix: string }`.
- **New shared**: `encodeFileToBase64(path): Promise<string | null>`.

## Scope

**In**: Linux + macOS capture/resize/base64, rename, `encodeFileToBase64`, `permission_missing`, drop entry guard.
**Out**: Signing/notarization, tools beyond locked chains, WSL, GUI picker, auto-install, changes to `MAX_DIMENSION`/`JPEG_QUALITY`/`pollClipboard`/`validateSize`/`buildFilePart`.

## Approach

### Architecture

`screenshot-service.ts` becomes dispatcher + shared; per-platform code lives in `screenshot-service.platforms/`. Each platform exports `spawnSnipping()` and `readCapturedImage()` (base64 JPEG, already resized, or `null`).

```typescript
import * as windows from "./screenshot-service.platforms/windows.ts";
import * as macos from "./screenshot-service.platforms/macos.ts";
import * as linux from "./screenshot-service.platforms/linux.ts";
const M = { win32: windows, darwin: macos, linux }[process.platform];
if (!M) throw new Error(`Unsupported platform: ${process.platform}`);
export const spawnSnipping = M.spawnSnipping;
export const readCapturedImage = M.readCapturedImage;
```

### Platform Matrix

- **win32**: `SnippingTool /clip` → PowerShell `System.Drawing` (q75/1568px). Errors: `tool_unavailable`, `spawn_failed`, `poll_timeout`, `size_exceeded`.
- **darwin**: `screencapture -i /tmp/...png` → `sips -s format jpeg --resampleHeightWidthMax 1568 -s formatOptions 75`. Errors: `tool_unavailable`, `permission_missing`, `user_cancelled` (Escape = no file).
- **linux X11**: `scrot -s` → `maim -s`; resize via `magick` (v7) → `convert` (v6). Errors: `tool_unavailable`, `headless`.
- **linux Wayland**: `grim -g "$(slurp)"` → `gnome-screenshot -a` → `spectacle --region --output`; same resize. Same errors.

### Locked Decisions

1. **Rename**: `readClipboard` → `readCapturedImage` everywhere.
2. **Linux chain**: X11: scrot → maim → error. Wayland: grim+slurp → gnome-screenshot → spectacle → error. Detect via `$XDG_SESSION_TYPE`, fallback `$WAYLAND_DISPLAY`/`$DISPLAY`.
3. **macOS permission**: PNG < 4KB or all-black → `permission_missing` with System Settings fix string in `fix` field.
4. **macOS mode**: `screencapture -i` (region OR window). Escape = no file = `user_cancelled`.
5. **Install instructions**: Per-OS `apt/dnf/pacman/brew install <tool>` in the toast.
6. **ImageMagick**: Linux only. Probe `magick` (v7) → `convert` (v6). macOS uses built-in `sips`.
7. **KDE Wayland**: `spectacle --region --output` in Wayland chain.

## Capabilities

### New
- `screenshot-capture`: Cross-platform capture/resize/base64 pipeline — dispatcher, per-platform tools, error variants, integration with `pollClipboard`/`validateSize`/`buildFilePart`.

### Modified
None (no `spec.md` files exist in `openspec/specs/` yet).

## Risks

- **R1 High**: macOS Screen Recording silently denied → small/all-black PNG heuristic → `permission_missing` toast with System Settings path.
- **R2 Med**: Wayland fragmentation (Sway/Hyprland/Niri) → chain covers wlroots/GNOME/KDE; exotic compositors may still fail.
- **R3 Med**: X11 minimal installs missing scrot+maim → `tool_unavailable` + per-distro install instructions.
- **R4 Low**: macOS `base64` lacks GNU `-w` → use `base64 -i <file> | tr -d '\n'`.
- **R5 Low**: `/tmp` file leak on macOS/Linux → `rm` in `finally` block.
- **R6 Low**: ImageMagick v6 vs v7 → probe `magick` first, fall back to `convert`.
- **R7 Low**: Headless session → check `$DISPLAY`/`$WAYLAND_DISPLAY` before `Bun.spawn`.

## Rollback

Single `git revert` restores Windows-only behavior. Pre-change state — `readClipboard` export, monolithic service, platform guard — is fully recoverable. On Windows, `windows.ts` is functionally identical; dispatcher is a passthrough. Partial-state risk is low.

## Open Questions

None — 7 platform decisions locked from explore.
