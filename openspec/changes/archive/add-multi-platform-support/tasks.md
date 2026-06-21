# Tasks: add-multi-platform-support

> Strict TDD (RED → GREEN → REFACTOR). Review budget exceeded — see forecast. Per-task verification via `bun test` and/or `bunx tsc --noEmit`.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | **850–900** (additions + deletions across 11 files) |
| 400-line budget risk | **High** (≈2.2× budget) |
| Chained PRs recommended | **Yes** |
| Delivery strategy | ask-always (per `openspec/config.yaml` preflight C1) |
| Decision needed before apply | **Yes** |
| Chain strategy | **pending** — user must choose |
| Suggested PR split | PR 1 = Phases 0–3; PR 2 = Phase 4; PR 3 = Phase 5; PR 4 = Phases 6–7 |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Base | Notes |
|------|------|-----------|------|-------|
| 1 | Shared infra + Windows move + dispatcher (no behavior change for Windows users) | PR 1 | main | Windows tests still pass via `skip` on non-host |
| 2 | macOS capture module | PR 2 | main | Adds darwin; dispatcher already routes |
| 3 | Linux capture module (X11 + Wayland + ImageMagick) | PR 3 | main | Adds linux; largest single PR by LOC |
| 4 | Entry-point guard removal + docs/config refresh | PR 4 | main | Closes the loop; updates README + config.yaml |

---

## Phase 0: Setup
**PR slice**: PR 1 (Foundation)

### 0.1 Create platforms directory
- **Type**: setup
- **Files**: `screenshot-service.platforms/` (new dir)
- **TDD order**: n/a
- **Acceptance**:
  - [x] Directory `screenshot-service.platforms/` exists at repo root
- **Notes**: Empty placeholder; subsequent phases populate it.

---

## Phase 1: Shared Infrastructure
**PR slice**: PR 1 (Foundation)

### 1.1 [RED] Add failing tests for `encodeFileToBase64`
- **Type**: test
- **Files**: `screenshot-service.test.ts` (modify — add describe block)
- **Spec link**: Shared `encodeFileToBase64` (Req #13)
- **TDD order**:
  1. Write `describe("encodeFileToBase64")` with 3 cases: (a) real file returns base64 of `b"hello"`; (b) missing path returns `null`; (c) non-existent file returns `null` without throwing.
  2. Run `bun test` — block fails (function not yet exported).
- **Acceptance**:
  - [x] `bun test` shows 3 failing tests in the new block
  - [x] `bunx tsc --noEmit` clean
- **Notes**: Use real temp files via `Bun.write(path, bytes)` for deterministic size; `os.tmpdir()` for cross-platform paths. Note: spec scenario 2 (file removed after call) is **out of scope** for this function — cleanup is the caller's responsibility (per design §4.l).

### 1.2 [GREEN] Implement `encodeFileToBase64` in `screenshot-service.ts`
- **Type**: impl
- **Files**: `screenshot-service.ts` (modify — add exported async function)
- **Spec link**: Shared `encodeFileToBase64` (Req #13)
- **TDD order**:
  1. Implement per design §4.l: `Bun.file(path).exists` → `arrayBuffer` → `Buffer.from(...).toString("base64")`; return `null` on error or missing file.
  2. Run `bun test` — all 3 cases pass.
- **Acceptance**:
  - [x] `bun test` green (3 new + existing)
  - [x] `bunx tsc --noEmit` clean
  - [x] `encodeFileToBase64` is exported
- **Notes**: Do NOT delete the file inside this function. Use `Buffer.from(arrayBuffer).toString("base64")` — `btoa` breaks on raw bytes.

### 1.3 Add `permission_missing` variant to `CaptureError` union
- **Type**: impl
- **Files**: `screenshot-service.ts` (modify — extend type union)
- **Spec link**: `permission_missing` Error Variant (Req #14)
- **TDD order**:
  1. Add `{ type: "permission_missing"; platform: "darwin"; fix: string }` to the `CaptureError` union.
  2. Type-check to confirm narrowing on `error.type === "permission_missing"` yields `platform: "darwin"` and `fix: string`.
- **Acceptance**:
  - [x] `bunx tsc --noEmit` clean — narrowing compiles
  - [x] `bun test` green (no behavior change yet)
- **Notes**: The literal `fix` string lives in `macos.ts` (per design §4.m); here we only declare the shape.

### 1.4 Rename `readClipboard` → `readCapturedImage` (export + test)
- **Type**: refactor
- **Files**: `screenshot-service.ts` + `screenshot-service.test.ts` (modify)
- **Spec link**: Renamed Export (Req #2)
- **TDD order**:
  1. Update test import + `describe` name to `readCapturedImage`. Run `bun test` — RED.
  2. Rename function declaration in service; update call site in `pollClipboard`. Run `bun test` — GREEN.
- **Acceptance**:
  - [x] `bun test` green (4 renamed tests pass + others)
  - [x] `bunx tsc --noEmit` clean
  - [x] No `readClipboard` references remain in `screenshot-service.ts` or `screenshot-service.test.ts`
- **Notes**: Transitional state — Phase 2 moves the function body to `windows.ts`. The dispatcher is not added yet, so `pollClipboard` still calls the local function.

---

## Phase 2: Windows Module (move, no behavior change)
**PR slice**: PR 1 (Foundation)

### 2.1 Move Windows code to `screenshot-service.platforms/windows.ts`
- **Type**: refactor
- **Files**: `screenshot-service.platforms/windows.ts` (new), `screenshot-service.ts` (modify — remove Windows-specific code)
- **Spec link**: Windows Capture (Req #3)
- **TDD order**:
  1. Create `screenshot-service.platforms/windows.ts`; move `SNIPPING_TOOL`, `CLIPBOARD_PS_SCRIPT`, `spawnSnipping`, `readCapturedImage` verbatim.
  2. Export `spawnSnipping` and `readCapturedImage` from the new module. Remove the same code from `screenshot-service.ts`.
  3. Update `pollClipboard` to import `readCapturedImage` from the new module. Add a temporary shim: re-export from `screenshot-service.ts` until Phase 3 builds the dispatcher.
- **Acceptance**:
  - [x] `bun test` green (existing tests still pass on Windows; non-Windows is unaffected because Phase 3 isn't wired yet — but `pollClipboard` now calls the imported `readCapturedImage` so the mock pattern still works)
  - [x] `bunx tsc --noEmit` clean
  - [x] Diff in `screenshot-service.ts` shows pure removal + thin re-export
- **Notes**: Use cut-paste, not copy-paste. Behavior must be bit-for-bit identical to current Windows code. The shim keeps the existing test file working until Phase 3.

### 2.2 Move Windows tests to `screenshot-service.platforms/windows.test.ts`
- **Type**: test
- **Files**: `screenshot-service.platforms/windows.test.ts` (new), `screenshot-service.test.ts` (modify — remove the 4 renamed tests)
- **Spec link**: Windows Capture (Req #3)
- **TDD order**:
  1. Create `windows.test.ts` with `const itWin = process.platform === "win32" ? it : it.skip;` guard at top.
  2. Move the 4 `readCapturedImage` tests (clipboard has image / no image / non-zero exit / spawn throws) + add 3 `spawnSnipping` tests (exit 0 / exit 1 / throws) using the same `Bun.spawn` mock pattern from design §6.5.
  3. Remove the 4 tests from `screenshot-service.test.ts`.
- **Acceptance**:
  - [x] `bun test` green on Windows; tests SKIP cleanly on non-Windows (no failures, no warnings)
  - [x] `bunx tsc --noEmit` clean
  - [x] `screenshot-service.test.ts` no longer references `readCapturedImage` for Windows-specific behavior (only the new `encodeFileToBase64` and shared helpers remain)
- **Notes**: Follow the `itWin` skip pattern (design §6.2). The current test file's 4 tests + 3 new = 7 tests in the new file.

---

## Phase 3: Dispatcher
**PR slice**: PR 1 (Foundation)

### 3.1 [RED] Add failing dispatcher tests
- **Type**: test
- **Files**: `screenshot-service.test.ts` (modify — add dispatcher describe block)
- **Spec link**: Platform Routing (Req #1), Renamed Export (Req #2)
- **TDD order**:
  1. Add `describe("dispatcher")` with: (a) `spawnSnipping` and `readCapturedImage` are functions; (b) for current `process.platform`, they are NOT undefined.
  2. Run `bun test` — currently fails because the shim from 2.1 re-exports but no real routing exists.
- **Acceptance**:
  - [x] `bun test` shows the dispatcher describe block failing (or assert not yet meeting the strict typing of "bound to platform module")
  - [x] `bunx tsc --noEmit` clean
- **Notes**: The shim from 2.1 re-exports from the host's module file directly. The test asserts the dispatcher pattern works; mock with `import.meta.resolve` is not required — just call the exports and check `typeof === "function"`.

### 3.2 [GREEN] Implement dispatcher in `screenshot-service.ts`
- **Type**: impl
- **Files**: `screenshot-service.ts` (modify — replace shim with real routing)
- **Spec link**: Platform Routing (Req #1), Renamed Export (Req #2)
- **TDD order**:
  1. Replace shim with: `const M = { win32: windows, darwin: macos, linux }[process.platform]; if (!M) throw new Error(\`Unsupported platform: ${process.platform}\`);`
  2. Re-export `spawnSnipping` and `readCapturedImage` from the matched module.
  3. Import `macos` and `linux` modules even though they don't exist yet — use `import type` or create stub files for the import to resolve. **Stub strategy**: create empty `screenshot-service.platforms/{macos,linux}.ts` files exporting placeholder functions so the import resolves. They get replaced in Phases 4–5.
  4. Run `bun test` — dispatcher tests pass; all existing tests still pass.
- **Acceptance**:
  - [x] `bun test` green on every host (Windows tests run; macOS/Linux tests skip)
  - [x] `bunx tsc --noEmit` clean
  - [x] Importing on a fictional platform (e.g. via a test that overrides `process.platform` and re-imports) throws "Unsupported platform"
- **Notes**: Per ADR-1, route at module load — not on every call. Stubs let the dispatcher compile before Phases 4–5 land.

---

## Phase 4: macOS Module
**PR slice**: PR 2 (macOS)

### 4.1 [RED] Create `screenshot-service.platforms/macos.test.ts` with failing tests
- **Type**: test
- **Files**: `screenshot-service.platforms/macos.test.ts` (new)
- **Spec link**: macOS Capture (Req #4), macOS Permission Detection (Req #5), macOS Image Processing (Req #6)
- **TDD order**:
  1. Add skip guard: `const itMac = process.platform === "darwin" ? it : it.skip;`.
  2. Add 5 failing tests (per design §6.3): `spawnSnipping` → file written returns `{ ok: true }` and argv is `["screencapture", "-i", tmpPath]`; no file (Escape) returns `user_cancelled`; `readCapturedImage` → success returns base64; small file (2000 bytes) returns `permission_missing`; cleanup invokes `rm -f` with both tmp paths.
  3. Run `bun test` — block skips on non-darwin, fails on darwin (no impl yet).
- **Acceptance**:
  - [x] `bun test` skips cleanly on non-darwin hosts
  - [x] `bunx tsc --noEmit` clean
- **Notes**: Use real temp files (via `Bun.write`) for size control; mock `Bun.spawn` per design §6.5. The 4 KB threshold is encoded as a module constant.

### 4.2 [GREEN] Implement `screenshot-service.platforms/macos.ts`
- **Type**: impl
- **Files**: `screenshot-service.platforms/macos.ts` (new — replace stub from 3.2)
- **Spec link**: macOS Capture (Req #4), macOS Image Processing (Req #6)
- **TDD order**:
  1. Implement `spawnSnipping`: `Bun.spawn(["screencapture", "-i", tmpPng])` → `proc.exited`; on exit 0 + file exists + size > 0 → `{ ok: true }`; on no file → `user_cancelled`; on non-zero exit → `tool_unavailable`; on throw → `spawn_failed`.
  2. Implement `readCapturedImage`: stat tmpPng; if `size < 4096` → return `{ ok: false, error: { type: "permission_missing", platform: "darwin", fix: MACOS_PERMISSION_FIX } }`. Else: `Bun.spawn(["sips", "-Z", "1568", "-s", "format", "jpeg", "-s", "formatOptions", "75", tmpPng, "--out", tmpJpg])` → `Bun.spawn(["base64", "-i", tmpJpg]).stdout` pipe through `tr -d '\n'` to strip BSD line-wrapping; resolve base64. Wrap in `try/finally` that runs `Bun.spawn(["rm", "-f", tmpPng, tmpJpg]).exited` for cleanup.
  3. Run `bun test` on darwin — all 5 tests pass.
- **Acceptance**:
  - [x] `bun test` green on darwin; skips cleanly elsewhere
  - [x] `bunx tsc --noEmit` clean
  - [x] `sips` argv per design §4.a; `base64 -i | tr -d '\n'` per design §4.d
  - [x] Cleanup runs in `finally` regardless of success/failure
- **Notes**: Per ADR-7, `readCapturedImage` returns `string | null | { ok: false; error: CaptureError }` so `permission_missing` short-circuits `pollClipboard` without throwing. `pollClipboard` (in the dispatcher) must be updated to handle the object form — confirm in next task.

### 4.3 [GREEN] Wire `pollClipboard` to handle the error-object form
- **Type**: impl
- **Files**: `screenshot-service.ts` (modify — `pollClipboard`)
- **Spec link**: macOS Permission Detection (Req #5), Entry Point Decoupling (Req #15)
- **TDD order**:
  1. Update `pollClipboard`: when `readCapturedImage` returns an object `{ ok: false, error }`, return that immediately (no further polling).
  2. Add a contract test in `screenshot-service.test.ts`: stub `readCapturedImage` to return `{ ok: false, error: { type: "permission_missing", platform: "darwin", fix: "..." } }`; assert `pollClipboard` returns the same shape without retrying.
  3. Run `bun test` — new test passes; existing tests still pass.
- **Acceptance**:
  - [x] `bun test` green
  - [x] `bunx tsc --noEmit` clean
  - [x] `pollClipboard` no longer retries on `permission_missing` (verifiable via mock call count)
- **Notes**: Without this, `permission_missing` would be silently swallowed as "no image yet" and the poll loop would burn 30s before timing out.

---

## Phase 5: Linux Module
**PR slice**: PR 3 (Linux)

### 5.1 [RED] Create `screenshot-service.platforms/linux.test.ts` with failing tests
- **Type**: test
- **Files**: `screenshot-service.platforms/linux.test.ts` (new)
- **Spec link**: Linux Headless Detection (Req #7), Linux Session Detection (Req #8), Linux X11 Capture Chain (Req #9), Linux Wayland Capture Chain (Req #10), Linux Image Processing (Req #11)
- **TDD order**:
  1. Add skip guard: `const itLin = process.platform === "linux" ? it : it.skip;`.
  2. Add 12 failing tests per design §6.4: headless, X11 scrot / X11 maim / X11 neither (with install msg containing `apt`/`dnf`/`pacman`/`brew`), Wayland grim+slurp / gnome-screenshot / spectacle / none, ImageMagick v7 / v6 / neither, cleanup.
  3. Run `bun test` — block skips on non-linux, fails on linux (no impl yet).
- **Acceptance**:
  - [x] `bun test` skips cleanly on non-linux
  - [x] `bunx tsc --noEmit` clean
- **Notes**: Use real env-var overrides (`process.env = { ...originals, XDG_SESSION_TYPE: "x11" }`) with `afterEach` restoration. Mock `Bun.spawn` for the `which` probes and tool invocations.

### 5.2 [GREEN] Implement `screenshot-service.platforms/linux.ts` — capture half
- **Type**: impl
- **Files**: `screenshot-service.platforms/linux.ts` (new — replace stub from 3.2)
- **Spec link**: Linux Headless Detection (Req #7), Linux Session Detection (Req #8), Linux X11 Capture Chain (Req #9), Linux Wayland Capture Chain (Req #10)
- **TDD order**:
  1. Implement `spawnSnipping` (capture half): headless check first (if `$DISPLAY`, `$WAYLAND_DISPLAY`, and `$XDG_SESSION_TYPE` all unset → `tool_unavailable` without spawning anything); then `detectSession()` via `Bun.spawn(["sh", "-c", SESSION_SCRIPT])` reading stdout, returning `"x11" | "wayland" | "none"`.
  2. Implement `captureX11()`: `which scrot` → if 0, `scrot -s tmpPng`; else `which maim` → if 0, `maim -s tmpPng`; else `tool_unavailable` with apt/dnf/pacman/brew instructions in `message`.
  3. Implement `captureWayland()`: `which slurp` AND `which grim` (both must succeed) → `sh -c "slurp | grim -g - tmpPng"`; else `which gnome-screenshot` → if 0, `gnome-screenshot -a -f tmpPng`; else `which spectacle` → if 0, `spectacle --region --output tmpPng`; else `tool_unavailable` with all three install instructions in `message`.
  4. Run `bun test` on linux — headless + session detect + X11 + Wayland tests pass.
- **Acceptance**:
  - [x] `bun test` green on linux (5 of 12 tests pass; the rest depend on 5.3)
  - [x] `bunx tsc --noEmit` clean
  - [x] No `Bun.spawn` calls made in headless path (assert via mock call count)
  - [x] Install message contains all four package managers per spec scenario
- **Notes**: Per ADR-8, use `sh -c` inline script for session detection (matches `CLIPBOARD_PS_SCRIPT` pattern). Per design §4.e, the script returns `x11` | `wayland` | `none`.

### 5.3 [GREEN] Implement `readCapturedImage` — ImageMagick + cleanup
- **Type**: impl
- **Files**: `screenshot-service.platforms/linux.ts` (modify — add `readCapturedImage` and helper)
- **Spec link**: Linux Image Processing (Req #11)
- **TDD order**:
  1. Implement `readCapturedImage`: `which magick` → if 0, `magick tmpPng -resize 1568x1568 -quality 75 tmpJpg`; else `which convert` → if 0, `convert …`; else `tool_unavailable` with apt/dnf/pacman/brew instructions.
  2. On success: pipe `tmpJpg` through `base64 -w 0 tmpJpg` (GNU form per design §4.i — `w 0` disables wrapping, no `tr` needed).
  3. Wrap whole flow in `try/finally` invoking `Bun.spawn(["rm", "-f", tmpPng, tmpJpg]).exited`.
  4. Run `bun test` on linux — all 12 tests pass.
- **Acceptance**:
  - [x] `bun test` green on linux
  - [x] `bunx tsc --noEmit` clean
  - [x] `-resize 1568x1568` (not `1568x1568!`) — preserves aspect ratio, no upscale
  - [x] Cleanup runs in `finally` regardless of success/failure
- **Notes**: `convert` (v6) and `magick` (v7) have identical `-resize` and `-quality` flags — same argv, different binary. The `-w 0` flag is GNU-specific; safe on Linux per design §4.i.

### 5.4 [REFACTOR] Consolidate install instruction strings
- **Type**: refactor
- **Files**: `screenshot-service.platforms/linux.ts` (modify)
- **Spec link**: Linux X11/Wayland/ImageMagick capture chains (Req #9, #10, #11)
- **TDD order**:
  1. Extract repeated per-distro instruction patterns into a helper: `buildInstallMessage(packages: Record<"apt" | "dnf" | "pacman" | "brew", string>): string`.
  2. Replace the inline strings in `captureX11`, `captureWayland`, and `readCapturedImage` with calls to the helper.
  3. Run `bun test` — all 12 tests still pass.
- **Acceptance**:
  - [x] `bun test` green
  - [x] `bunx tsc --noEmit` clean
  - [x] Install message format identical to spec scenarios (contains `apt`, `dnf`, `pacman`, `brew`)
- **Notes**: Pure refactor — no behavior change. Reduces 3 near-duplicate strings to 1 helper + 3 call sites.

---

## Phase 6: Entry Point Decoupling
**PR slice**: PR 4 (Cleanup)

### 6.1 Remove `process.platform !== "win32"` guard from `screenshot-to-chat.tsx`
- **Type**: refactor
- **Files**: `screenshot-to-chat.tsx` (modify — delete lines 51–57)
- **Spec link**: Entry Point Decoupling (Req #15)
- **TDD order**:
  1. Delete the `if (process.platform !== "win32") { ... }` block and the toast.
  2. Add a contract test in a new `screenshot-to-chat.test.ts` (or in the existing test file): grep the file for `process.platform`; assert zero matches.
  3. Add toast branches for the new `permission_missing` and `tool_unavailable` install-hint messages in `handleCapture` (per design §3.8).
  4. Run `bun test` + `bunx tsc --noEmit`.
- **Acceptance**:
  - [x] `bun test` green
  - [x] `bunx tsc --noEmit` clean
  - [x] `grep "process.platform" screenshot-to-chat.tsx` returns nothing
  - [x] `handleCapture` handles `permission_missing` by toasting `error.fix`
- **Notes**: The platform guard is no longer needed — the dispatcher routes internally. The toast is moved into the existing `spawnResult.error` branch (where `tool_unavailable` already gets a toast) to surface install instructions.

### 6.2 Verify dispatcher behaves on host
- **Type**: impl
- **Files**: `screenshot-service.ts` (modify — sanity check)
- **Spec link**: Platform Routing (Req #1)
- **TDD order**:
  1. Run `bun test` on host: dispatcher describe block confirms `spawnSnipping` and `readCapturedImage` are functions bound to the current platform's module.
  2. Run `bunx tsc --noEmit` — confirm no new type errors after entry guard removal.
- **Acceptance**:
  - [x] `bun test` green
  - [x] `bunx tsc --noEmit` clean
- **Notes**: Catches regressions where the dispatcher accidentally re-exports `undefined`.

---

## Phase 7: Verification & Documentation
**PR slice**: PR 4 (Cleanup)

### 7.1 Run full test suite on host
- **Type**: verify
- **Files**: n/a
- **Spec link**: All requirements
- **TDD order**: n/a
- **Acceptance**:
  - [x] `bun test` green on the host platform
  - [x] Total test count increased from 12 to 12 + 7 (Windows) + 5 (macOS, skip on non-darwin) + 12 (Linux, skip on non-linux) + 1 (encodeFileToBase64) + 1 (pollClipboard permission_missing) + 1 (entry guard grep) = 27
  - [x] No test takes > 5s (the `pollClipboard` tests must avoid the real 30s timeout)
- **Notes**: The dispatcher tests run on all hosts; per-platform tests skip cleanly. If any test takes > 5s, the poll timeout is leaking through.

### 7.2 Update `README.md` for cross-platform support
- **Type**: docs
- **Files**: `README.md` (modify)
- **Spec link**: All requirements (user-facing)
- **TDD order**: n/a
- **Acceptance**:
  - [x] Remove the "Windows only" mention from Known Limitations + Requirements
  - [x] Update "How It Works" diagram to show the dispatcher + per-platform modules
  - [x] Add a per-OS install section covering: macOS (no install — `screencapture` and `sips` are built-in, but Screen Recording permission required); Linux X11 (`apt install scrot` / `maim` + `imagemagick`); Linux Wayland (`grim` + `slurp` + `imagemagick`, or `gnome-screenshot` / `spectacle` + `imagemagick`)
  - [x] Update Platform Support table: Windows ✅, macOS ✅ (with permission note), Linux ✅
  - [x] Add `encodeFileToBase64` and per-platform modules to the architecture diagram
- **Notes**: Keep the error-handling table — add a `permission_missing` row pointing to System Settings → Privacy & Security → Screen Recording.

### 7.3 Update `openspec/config.yaml` runtime context
- **Type**: docs
- **Files**: `openspec/config.yaml` (modify)
- **Spec link**: n/a (config metadata)
- **TDD order**: n/a
- **Acceptance**:
  - [x] `Runtime: Bun (Windows / macOS / Linux)`
  - [x] Add a note under `context` mentioning the dispatcher pattern + per-platform modules
- **Notes**: Single-line context change. Keep the rest of the file untouched.

---

## Summary

| Phase | Tasks | PR | Focus |
|-------|-------|-----|-------|
| 0 | 0.1 | PR 1 | Setup (mkdir) |
| 1 | 1.1–1.4 | PR 1 | Shared infra (encodeFileToBase64, permission_missing, rename) |
| 2 | 2.1–2.2 | PR 1 | Windows move (no behavior change) |
| 3 | 3.1–3.2 | PR 1 | Dispatcher + host stubs |
| 4 | 4.1–4.3 | PR 2 | macOS module + pollClipboard widening |
| 5 | 5.1–5.4 | PR 3 | Linux module (capture + processing) |
| 6 | 6.1–6.2 | PR 4 | Entry guard removal + verification |
| 7 | 7.1–7.3 | PR 4 | Full suite + README + config |
| **Total** | **20 tasks** | **4 PRs** | ~850–900 changed lines |

### Implementation Order

Recommended split (chain strategy pending user decision):

1. **PR 1 — Foundation**: Phases 0–3. No user-facing change on Windows. `bun test` and `bunx tsc --noEmit` green on every host. Risk: Low (pure refactor + dispatcher; Windows tests prove behavior preserved).
2. **PR 2 — macOS**: Phase 4. Adds darwin; dispatcher already routes. `bun test` skips macOS tests on non-darwin hosts. Risk: Med (real macOS hardware or CI needed to verify end-to-end).
3. **PR 3 — Linux**: Phase 5. Adds linux. `bun test` skips Linux tests on non-linux hosts. Risk: Med-High (session detection + tool chains; need to exercise on a real X11 and Wayland session to confirm install instructions are accurate).
4. **PR 4 — Cleanup**: Phases 6–7. Drops the entry guard, updates docs. Risk: Low (the dispatcher + per-platform modules already handle all three OSes).

Each PR merges independently; the orchestrator can stop after any PR if blockers emerge.
