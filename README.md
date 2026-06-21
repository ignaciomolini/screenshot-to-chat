# Screenshot-to-Chat

> OpenCode TUI plugin — capture a screen region and attach it directly to your chat prompt.

## What It Does

Press `Ctrl+S` inside OpenCode. A native region-select tool opens (Windows Snipping Tool, macOS `screencapture`, or a Linux X11/Wayland fallback chain), you select a region, and the screenshot appears as a JPEG image attachment in your chat input — ready to send with your prompt.

No manual uploads. No copy/paste. The plugin resizes, base64-encodes, and attaches in one step.

## Requirements

- **OpenCode** with TUI plugin support
- **Bun** runtime (used by OpenCode's plugin system)
- **One of:**
  - **Windows** — `SnippingTool.exe` is built in (no install)
  - **macOS** — `screencapture` + `sips` are built in (Screen Recording permission required)
  - **Linux** — see [Linux Dependencies](#linux-dependencies) below

## Installation

### Quick install (Windows, one command)

From the repo root, in PowerShell:

```powershell
.\install.ps1
```

This will:

1. Create `~/.config/opencode/tui-plugins/screenshot-to-chat/` (the plugin's own folder)
2. Copy `screenshot-to-chat.tsx`, `screenshot-service.ts`, and the `screenshot-service.platforms/` directory into it
3. Add the entry-point path to the `plugin` array in your `~/.config/opencode/tui.json`
4. Back up your `tui.json` before mutating it
5. Clean up any legacy single-file install from older versions

Restart OpenCode and you're done. The keybind is `Ctrl+S`.

#### Options

```powershell
.\install.ps1 -DryRun    # Preview what would happen, no changes
```

If you want to do it manually instead, see [Manual install](#manual-install) below.

### Manual install

1. Create a folder for the plugin inside your OpenCode plugins directory:
   - Windows: `%USERPROFILE%\.config\opencode\tui-plugins\screenshot-to-chat\`
   - macOS / Linux: `~/.config/opencode/tui-plugins/screenshot-to-chat/`
2. Copy the plugin files from this repo into that folder:
   - `screenshot-to-chat.tsx`
   - `screenshot-service.ts`
   - `screenshot-service.platforms/` (directory)
3. Add the entry-point path to the `plugin` array in your `tui.json`:

   ```json
   {
     "plugin": [
       "/home/YOU/.config/opencode/tui-plugins/screenshot-to-chat/screenshot-to-chat.tsx"
     ]
   }
   ```

4. Restart OpenCode.

The files need to live side by side in the same folder — the entry imports helpers from the service and dispatches to the per-platform module matching your OS. No `bun install` is needed; the plugin uses OpenCode's own copies of `@opencode-ai/plugin` and `@opentui/solid`.

## Usage

There are three ways to trigger a capture:

### 1. Keybind

Press **`Ctrl+S`** from anywhere in OpenCode.

### 2. Slash command

In the chat input, type:

```
/screenshot
```

then press Enter. Works in any session.

### 3. Command Palette

1. Press `Ctrl+Shift+P` (or your configured keybind)
2. Type `Capture Screenshot`
3. Press Enter

### Flow

Regardless of how you trigger it (or which OS you run on), the rest is the same:

1. The OS-native region-select tool opens
2. Select a screen region
3. The screenshot attaches to your prompt as a thumbnail
4. Type your question and press Enter

## Platform Support

| Platform | Status | Capture Tool | Image Resize | Notes |
|----------|--------|--------------|--------------|-------|
| Windows | ✅ Supported | `SnippingTool.exe /clip` | PowerShell `System.Drawing` | Built in |
| macOS | ✅ Supported | `screencapture -i` | `sips` (built in) | Screen Recording permission required |
| Linux (X11) | ✅ Supported | `scrot` → `maim` (fallback) | ImageMagick (`magick` v7 → `convert` v6) | See Linux Dependencies |
| Linux (Wayland) | ✅ Supported | `slurp`+`grim` → `gnome-screenshot` → `spectacle` | ImageMagick (`magick` v7 → `convert` v6) | wlroots / GNOME / KDE |

### Linux Dependencies

The plugin shells out to standard capture tools and ImageMagick for resize. Pick the chain that matches your session type.

**X11** (one of):

```bash
sudo apt install scrot                       # or maim
sudo dnf install scrot
sudo pacman -S scrot
brew install scrot
```

**Wayland** (one of):

```bash
# wlroots compositors (Sway / Hyprland / Niri)
sudo apt install slurp grim

# GNOME
sudo apt install gnome-screenshot

# KDE
sudo apt install spectacle
```

(also available via `dnf` / `pacman` / `brew`)

**Image resize** (required on all Linux setups):

```bash
sudo apt install imagemagick
sudo dnf install ImageMagick
sudo pacman -S imagemagick
brew install imagemagick
```

If a tool is missing, the plugin surfaces a toast with the exact install command for your distro.

### macOS Setup

`macos screencapture` and `sips` are built in — no install needed. On first capture, macOS will prompt for **Screen Recording** permission (System Settings → Privacy & Security → Screen Recording). The plugin detects when this is denied and surfaces a toast with the fix path.

## How It Works

```
Ctrl+S
    │
    ▼
┌─────────────────────┐
│  Dispatcher         │  ← routes by process.platform
│  (screenshot-       │     to win32 | darwin | linux
│   service.ts)       │
└─────────┬───────────┘
          │
    ┌─────┴──────┬───────────────┐
    ▼            ▼               ▼
  Windows      macOS           Linux
  SnippingTool screencapture    scrot/maim/slurp|grim/
  /clip       -i               gnome-screenshot/spectacle
    │            │               │
    └─────┬──────┴───────────────┘
          │ user selects region
          ▼
┌─────────────────────┐
│  Image Resize       │  ← fits longest edge to 1568px, JPEG q75
│  (Windows: PS,      │     preserves aspect ratio, no upscale
│   macOS: sips,      │
│   Linux: magick)    │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Base64 Encode      │  ← in-memory; no temp files leak
│  + Size Validation  │     rejects images > 3 MB
└─────────┬───────────┘
          │ ok
          ▼
┌─────────────────────┐
│  session.prompt     │  ← Attaches as { type: "file", mime: "image/jpeg", url: "data:..." }
│  { noReply: true }  │     Image is pre-attached to the session;
│                     │     no completion is triggered. User types prompt
│                     │     and the image travels with it on send.
└─────────────────────┘
```

### Architecture

```
screenshot-to-chat.tsx    ← Plugin entry: command registration, orchestration, toasts (platform-agnostic)
screenshot-service.ts     ← Dispatcher + shared helpers: validateSize, buildFilePart, encodeFileToBase64, pollClipboard
screenshot-service.platforms/
  windows.ts              ← SnippingTool + PowerShell (Windows)
  macos.ts                ← screencapture + sips (macOS)
  linux.ts                ← session detect + X11/Wayland chain + ImageMagick (Linux)
*.test.ts                 ← Unit + integration tests (per-platform tests skip on non-host)
```

The dispatcher binds `spawnSnipping` and `readCapturedImage` to the platform module matching `process.platform` at module load (ADR-1). Shared helpers (`validateSize`, `buildFilePart`, `encodeFileToBase64`, `pollClipboard`) are platform-agnostic and live in `screenshot-service.ts`.

## Configuration

### Image Size Limit

Default: **3 MB** (safe for base64 encoding + request overhead). To change, edit `MAX_IMAGE_BYTES` in `screenshot-service.ts`:

```typescript
export const MAX_IMAGE_BYTES = 3_145_728; // 3 MB
```

### Clipboard Polling

- Interval: 500ms between checks
- Timeout: 30s total (60 attempts)

Adjust via `POLL_INTERVAL_MS` and `POLL_TIMEOUT_MS` constants.

## Error Handling

| Error | Toast Message | Cause |
|-------|---------------|-------|
| Tool unavailable | Install-hint text (e.g. `sudo apt install scrot`) | Per-OS capture tool missing (e.g. scrot / slurp+grim / gnome-screenshot / spectacle) |
| Permission missing | "macOS Screen Recording permission required…" toast | macOS Screen Recording not granted |
| Spawn failed | "Failed to launch capture tool: {error}" | OS blocked execution |
| Poll timeout | "Capture timed out — no image detected" | User cancelled or no image detected |
| Size exceeded | "Screenshot exceeds 3 MB limit — try a smaller region" | Selected region too large |
| Success | "Screenshot sent" | — |

## Testing

```bash
# Run all tests
bun test

# Type check
bunx tsc --noEmit
```

The per-platform test files (`screenshot-service.platforms/{macos,linux}.test.ts`) skip on non-host via the `it.skip` pattern, so CI on any OS sees a stable test count and no phantom failures. End-to-end verification on each platform still needs that host.

### Test Coverage

| Function | Tests |
|----------|-------|
| `validateSize` | Under limit, at limit, over limit, empty |
| `buildFilePart` | Correct structure, mime type, filename |
| `encodeFileToBase64` | Real file returns base64, missing file returns null, empty file returns null |
| `pollClipboard` (contract) | Success / timeout shapes; short-circuit on permission_missing |
| Dispatcher | Functions bound to current platform; throws on unsupported platform |
| Windows capture | `SnippingTool` exit codes, clipboard read, spawn failure |
| macOS capture | `screencapture`, `sips` + base64, permission detection, cleanup |
| Linux capture | Session detect, X11 / Wayland chain, ImageMagick v6/v7, cleanup |
| Entry point | No `process.platform` guard, no Windows-only string |

## Known Limitations

1. **No image editing** — what you capture is what you get (no crop, annotate, or filter)
2. **No capture history** — only the most recent capture is available
3. **Linux end-to-end needs a real desktop session** — the test suite covers the chain logic via mocks, but actual capture needs X11 or Wayland to be running
4. **macOS first-launch permission prompt** — Screen Recording must be granted once before the first capture

## Security

- Images are processed **in memory** after capture (only the brief temp-file window during resize)
- No network requests — images stay local until you explicitly send the message
- Temp files are cleaned up in a `finally` block (the `rm -f` call swallows missing files for partial-failure paths)
- Temp files live in `/tmp` with random UUID names; permissions are not tightened (the world-writable default allows other users' tools to read mid-capture — the cleanup is the security boundary)
