# Screenshot-to-Chat

> OpenCode TUI plugin — capture a screen region and attach it directly to your chat prompt.

## What It Does

Press `Ctrl+S` inside OpenCode. The native Windows Snipping Tool opens, you select a region, and the screenshot appears as an image attachment in your chat input — ready to send with your prompt.

No external tools. No temp files. No manual uploads.

## Requirements

- **OpenCode** with TUI plugin support
- **Windows** (SnippingTool.exe must be available)
- **Bun** runtime (used by OpenCode's plugin system)

## Installation

### Quick install (Windows, one command)

From the repo root, in PowerShell:

```powershell
.\install.ps1
```

This will:

1. Create `~/.config/opencode/tui-plugins/screenshot-to-chat/` (the plugin's own folder)
2. Copy both `screenshot-to-chat.tsx` and `screenshot-service.ts` into it
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
2. Copy both files from this repo into that folder:
   - `screenshot-to-chat.tsx`
   - `screenshot-service.ts`
3. Add the entry-point path to the `plugin` array in your `tui.json`:

   ```json
   {
     "plugin": [
       "C:\\Users\\YOU\\.config\\opencode\\tui-plugins\\screenshot-to-chat\\screenshot-to-chat.tsx"
     ]
   }
   ```

4. Restart OpenCode.

The two files need to live side by side in the same folder — the entry imports helpers from the service. No `bun install` is needed; the plugin uses OpenCode's own copies of `@opencode-ai/plugin` and `@opentui/solid`.

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

Regardless of how you trigger it, the rest is the same:

1. The native Windows Snipping Tool opens
2. Select a screen region
3. The screenshot attaches to your prompt as a thumbnail
4. Type your question and press Enter

## How It Works

```
Ctrl+S
    │
    ▼
┌─────────────────────┐
│  SnippingTool.exe   │  ← OS-native region select
│  /clip              │
└─────────┬───────────┘
          │ user selects region
          ▼
┌─────────────────────┐
│  Clipboard Polling  │  ← PowerShell reads clipboard every 500ms
│  (up to 30s)        │     via System.Windows.Forms.Clipboard
│  + Resize + JPEG    │     Resizes to max 1568px, encodes q75
└─────────┬───────────┘
          │ image found
          ▼
┌─────────────────────┐
│  Size Validation    │  ← Rejects images > 3 MB
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
screenshot-to-chat.tsx    ← Plugin entry: command registration, orchestration, toasts
screenshot-service.ts     ← Pure/async functions: spawn, clipboard, validate, build
screenshot-service.test.ts← 12 unit + integration tests
```

The service layer is extracted from the plugin entry to enable testing without the TUI runtime.

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
| Platform unsupported | "Screenshot capture is only supported on Windows in this version" | Running on macOS/Linux |
| Prompt unavailable | "Prompt not available — open a session first" | No active chat session |
| Tool unavailable | "Screenshot tool not available on this system" | SnippingTool.exe not found or crashed |
| Spawn failed | "Failed to launch capture tool: {error}" | OS blocked execution |
| Poll timeout | "Capture timed out — no image detected" | User cancelled or clipboard empty |
| Size exceeded | "Screenshot exceeds 3 MB limit — try a smaller region" | Selected region too large |
| Success | "Screenshot sent" | — |

## Testing

```bash
# Run all tests
bun test

# Type check
bunx tsc --noEmit
```

### Test Coverage

| Function | Tests |
|----------|-------|
| `validateSize` | ✅ Under limit, at limit, over limit, empty |
| `buildFilePart` | ✅ Correct structure, mime type, filename |
| `injectToPrompt` | ✅ Append to empty, append to existing, preserve text |
| `readClipboard` | ✅ Image found, empty, error |
| `pollClipboard` | ✅ Immediate find, retry then find, timeout |

## Known Limitations

1. **Windows only** — macOS and Linux support requires platform-specific capture commands (planned for v2)
2. **No image editing** — what you capture is what you get (no crop, annotate, or filter)
3. **No capture history** — only the most recent capture is available

## Security

- Images are processed **entirely in memory** — no temp files written to disk
- No network requests — images stay local until you explicitly send the message
- Clipboard is read only after SnippingTool exits — no background monitoring

## Platform Support

| Platform | Status | Tool |
|----------|--------|------|
| Windows | ✅ MVP | SnippingTool.exe /clip |
| macOS | 🔜 Planned | `screencapture -i` |
| Linux | 🔜 Planned | `gnome-screenshot` or `scrot` |


### Development Workflow

1. Clone the repo
2. `bun install`
3. Make changes
4. `bun test` — verify tests pass
5. `bunx tsc --noEmit` — verify types
6. Test in OpenCode TUI

## License

MIT
