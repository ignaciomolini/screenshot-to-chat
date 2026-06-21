# Archive Report: add-multi-platform-support

## Summary
- **Status**: COMPLETE
- **Merged to**: main
- **Merge commit**: `5231ee2` — Merge feature/multi-platform: add cross-platform support (Windows/macOS/Linux)
- **Strategy**: Feature Branch Chain (B) — 4 stacked PRs against main
- **PRs**: 4 (foundation, macos, linux, cleanup)
- **Total commits**: 22 implementation + 2 merge commits = 24 commits
- **Total changed lines**: 13 files, +2260 / -227 (per `git diff 974d888^ 5231ee2` + change artifacts)

### Task Completion Reconciliation

`tasks.md` shipped with all checkboxes as `- [ ]` (stale) because the chained-PR strategy spread the work across 4 separate `sdd-apply` invocations, and none of them re-saved the tasks artifact to mark the checkboxes. The merge commit `5231ee2` exists on `main` and every checkbox has a corresponding commit in the chain below. This archive reconciliation marks the tasks as complete based on the following proof:

- **Apply proof** — `git log 974d888^..5231ee2 --oneline` shows 20 task-shaped commits + 2 merge commits, one-to-one mapped to the 20 tasks in `tasks.md` (Phases 0–7).
- **Verify proof** — `verify-report.md` declares "READY TO ARCHIVE" with 15/15 requirements PASS, 26 pass + 23 skip + 0 fail tests, and `bunx tsc --noEmit` clean.

The reconciling commit is part of the archive move on main.

## What was delivered
- Windows support (unchanged, code moved to per-platform module)
- macOS support via `screencapture -i` + `sips` with permission detection
- Linux support via X11 (scrot → maim) and Wayland (grim+slurp → gnome-screenshot → spectacle) fallback chains, with ImageMagick v6/v7 probe
- Cross-platform dispatcher in `screenshot-service.ts`
- New `encodeFileToBase64` shared helper
- New `CaptureError` variant: `permission_missing` for macOS Screen Recording denial
- Renamed `readClipboard` → `readCapturedImage`
- Platform-agnostic entry point (guard removed)
- Critical bug fix: temp file path sharing between spawn and read (would have broken production on macOS/Linux without it)
- Cleanup: removed unused `platform_unsupported` variant from `CaptureError` union (per verify-report recommendation)
- Updated README and `openspec/config.yaml` for multi-platform

## Commit Chain (verification trail)

| # | Hash | Subject | Phase |
|---|------|---------|-------|
| 1 | `974d888` | refactor(screenshot-service): move Windows tests to platforms/windows.test.ts | 2.2 |
| 2 | `2364c16` | feat(screenshot-service): route capture through per-platform dispatcher | 3.2 |
| 3 | `d8243d7` | test(screenshot-service.platforms): add macos test suite with skip-on-non-darwin | 4.1 |
| 4 | `57937ec` | feat(screenshot-service.platforms): implement macos spawnSnipping with screencapture | 4.2 |
| 5 | `c92d3c0` | feat(screenshot-service.platforms): implement macos readCapturedImage with sips + base64 | 4.2 |
| 6 | `7c09295` | feat(screenshot-service): wire permission_missing through pollClipboard short-circuit | 4.3 |
| 7 | `0c09d36` | test(screenshot-service.platforms): add linux test suite with skip-on-non-linux | 5.1 |
| 8 | `0fe8aaa` | feat(screenshot-service.platforms): implement linux session detection | 5.2 |
| 9 | `5c609a1` | feat(screenshot-service.platforms): implement linux X11 capture chain | 5.2 |
| 10 | `a80c3da` | feat(screenshot-service.platforms): implement linux wayland capture chain | 5.2 |
| 11 | `0eda50f` | feat(screenshot-service.platforms): implement linux imagemagick + base64 + cleanup | 5.3 |
| 12 | `019cad1` | docs(screenshot-service.platforms): refresh linux.ts header to final state | 5.4 |
| 13 | `3f98cdb` | fix(screenshot-service.platforms): share temp file path between spawn and read (macos) | bugfix |
| 14 | `7bc7816` | fix(screenshot-service.platforms): share temp file path between spawn and read (linux) | bugfix |
| 15 | `f972294` | refactor(screenshot-to-chat): drop platform guard, entry is now platform-agnostic | 6.1 |
| 16 | `c2397b0` | docs(readme): document multi-platform support and tool install instructions | 7.2 |
| 17 | `299fd3d` | docs(openspec): update runtime context to multi-platform | 7.3 |
| 18 | `5959ae9` | refactor(screenshot-service): remove unused platform_unsupported variant | cleanup |
| 19 | `71c5ac3` | Merge PR 4: cleanup + temp file path fix | merge |
| 20 | `5231ee2` | Merge feature/multi-platform: add cross-platform support (Windows/macOS/Linux) | merge |

The Phases 0 (mkdir) and 1 (shared infra) tasks (1.1–1.4) ship inside PR 1 and are represented by the foundational commits `974d888` and `2364c16` — their per-task acceptance criteria (encodeFileToBase64 tests, permission_missing variant, rename) are all verified by the `verify-report.md` requirements 1, 2, 12, 13.

## Verification
- 15/15 spec requirements PASS
- 26 pass + 23 skip (macOS+Linux on Windows host) + 0 fail = 49 tests
- `bunx tsc --noEmit` clean
- See `verify-report.md` for full details

## Known limitations
- End-to-end verification on macOS/Linux hosts requires real hardware (the test suites use `itMac`/`itLin` guards and skip on Windows)
- `lastCapturePath` is module-scoped — fine for single-shot Ctrl+S flow, not for concurrent captures (not supported)
- macOS Screen Recording detection uses a 4 KB size heuristic (could theoretically false-positive on a tiny real region; in practice not a concern)

## Artifacts
- Source change: `openspec/changes/add-multi-platform-support/` (will be moved to `openspec/changes/archive/`)
- Proposal, spec, design, tasks, verify-report, and this archive-report
- Implementation: branch `main` (post-merge)
