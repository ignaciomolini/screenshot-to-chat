# Screenshot-to-Chat

> OpenCode TUI plugin — capture a screen region and attach it directly to your chat prompt.

## What It Does

Press `Ctrl+Shift+S` inside OpenCode. The native Windows Snipping Tool opens, you select a region, and the screenshot appears as an image attachment in your chat input — ready to send with your prompt.

No external tools. No temp files. No manual uploads.

## Requirements

- **OpenCode** with TUI plugin support
- **Windows** (SnippingTool.exe must be available)
- **Bun** runtime (used by OpenCode's plugin system)

## Installation

Add the plugin to your OpenCode `tui.json` configuration:

```json
{
  "plugins": [
    "/path/to/screenshot-to-chat"
  ]
}
```

Then install dependencies:

```bash
bun install
```

## Usage

1. Open a session in OpenCode
2. Press **`Ctrl+Shift+S`** (or use the Command Palette: `> Capture Screenshot`)
3. Select a screen region with the Snipping Tool
4. The screenshot attaches to your prompt as a thumbnail
5. Type your question and press Enter

### Command Palette

You can also trigger capture from the Command Palette:

1. Press `Ctrl+Shift+P` (or your configured keybind)
2. Type `Capture Screenshot`
3. Press Enter

## How It Works

```
Ctrl+Shift+S
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
└─────────┬───────────┘
          │ image found
          ▼
┌─────────────────────┐
│  Size Validation    │  ← Rejects images > 5 MB
└─────────┬───────────┘
          │ ok
          ▼
┌─────────────────────┐
│  FilePart Injection │  ← Attaches as { type: "file", mime: "image/png", ... }
│  via TuiPromptRef   │     Preserves existing prompt text
└─────────────────────┘
```

### Architecture

```
screenshot-to-chat.tsx    ← Plugin entry: command registration, orchestration, toasts
screenshot-service.ts     ← Pure/async functions: spawn, clipboard, validate, inject
screenshot-service.test.ts← 15 unit + integration tests
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
| Success | "Screenshot attached" | — |

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

## Contributing

This plugin follows the [OpenCode TUI plugin pattern](https://github.com/nicholasgriffintn/opencode). See `ona-logo.tsx` in the OpenCode codebase for reference.

### Development Workflow

1. Clone the repo
2. `bun install`
3. Make changes
4. `bun test` — verify tests pass
5. `bunx tsc --noEmit` — verify types
6. Test in OpenCode TUI

## License

MIT
