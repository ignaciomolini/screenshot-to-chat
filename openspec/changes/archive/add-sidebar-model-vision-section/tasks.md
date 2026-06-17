# Tasks: Add Sidebar Model & Vision Section

> **Mode**: Strict TDD — RED → GREEN → REFACTOR for each task.
> **Review budget**: ~140 estimated changed lines (low risk, single PR).

---

## Phase 1: Vision Detection (Service Layer)

### Task 1.1 — Write failing tests for `supportsVision`

**TDD Step**: RED

- [x] Add `describe("supportsVision")` block to `screenshot-service.test.ts`
- [x] Import `supportsVision` from `./screenshot-service.ts` (will fail — not yet exported)
- [x] Add test: returns `true` for `"gpt-4o"`
- [x] Add test: returns `true` for `"claude-sonnet-4-5"`
- [x] Add test: returns `true` for `"gemini-2.5-pro"`
- [x] Add test: returns `false` for `"minimax-m3"` (blacklisted)
- [x] Add test: returns `false` for `undefined`
- [x] Add test: returns `false` for `"some-unknown-model-xyz"` (default deny)
- [x] Run `bun test` — verify tests FAIL (import error or wrong results)

**Verification**: `bun test` shows 6 failing tests in `supportsVision` describe block.

---

### Task 1.2 — Implement `supportsVision` in service layer

**TDD Step**: GREEN

- [x] Add `NO_VISION_MODELS` Set to `screenshot-service.ts` with `"minimax-m3"`
- [x] Add `VISION_PATTERNS` regex array: `/gpt-4o/`, `/gpt-4-vision/`, `/claude-/`, `/gemini-.*-(pro|flash)/`, `/qwen.*vl/`, `/qwen3\.7-plus/`, `/kimi/`
- [x] Implement `supportsVision(modelId: string | undefined): boolean`:
  - Return `false` if `!modelId`
  - Lowercase the ID
  - Return `false` if in `NO_VISION_MODELS`
  - Return `VISION_PATTERNS.some(p => p.test(id))`
- [x] Export all three: `NO_VISION_MODELS`, `VISION_PATTERNS`, `supportsVision`
- [x] Run `bun test` — verify all 6 tests PASS
- [x] Run `bunx tsc --noEmit` — verify no type errors

**Verification**: `bun test` passes all tests including new `supportsVision` block.

---

## Phase 2: Plugin Entry Refactor

### Task 2.1 — Remove legacy vision code from plugin entry

**TDD Step**: REFACTOR (cleanup before adding new feature)

- [x] Remove `VISION_MODELS` Set from `screenshot-to-chat.tsx` (lines 20-29)
- [x] Remove local `supportsVision` function from `screenshot-to-chat.tsx` (lines 31-38)
- [x] Add `supportsVision` to the import from `"./screenshot-service.ts"`
- [x] Run `bun test` — verify existing tests still pass (no behavior change yet)

**Verification**: `bun test` passes; `handleCapture` still uses `supportsVision` via import.

---

### Task 2.2 — Replace `sidebar_footer` with `sidebar_content` slot

**TDD Step**: GREEN (new feature)

- [x] Remove the `api.slots.register({ slots: { sidebar_footer } })` block (lines 68-84)
- [x] Add `api.slots.register({ slots: { sidebar_content } })` with:
  - Extract `session_id` from props
  - Return empty fragment if no `session_id`
  - Read model reactively: `const model = api.state.session.get(session_id)?.model`
  - Extract `modelId = model?.id`
  - Render section with model name + vision dot:
    ```tsx
    <box border>
      <text dim>Model</text>
      <text>
        {modelId ?? "unknown"}{"  "}
        <span fg={supportsVision(modelId) ? "green" : "red"}>●</span>
        {" "}{supportsVision(modelId) ? "vision" : "no vision"}
      </text>
    </box>
    ```
- [x] Clean `getCurrentModelId` — remove `as any` cast, use typed `session?.model?.id` directly
- [x] Run `bun test` — verify all tests pass
- [x] Run `bunx tsc --noEmit` — verify type check passes

**Verification**: Plugin compiles; sidebar shows "Model" section when loaded in OpenCode TUI.

---

## Phase 3: Documentation

### Task 3.1 — Update README

- [x] Add "Sidebar Model Section" subsection under "Usage" documenting the new visual indicator
- [x] Update the architecture diagram to mention `supportsVision` in service layer
- [x] Update test coverage table to include `supportsVision` row

**Verification**: README renders correctly; no broken links or formatting.

---

## Summary

| Phase | Tasks | Estimated Lines | TDD Step |
|-------|-------|-----------------|----------|
| 1 | 1.1, 1.2 | ~60 (35 test + 25 impl) | RED → GREEN |
| 2 | 2.1, 2.2 | ~55 (net change in plugin) | REFACTOR → GREEN |
| 3 | 3.1 | ~15 | N/A |
| **Total** | **5 tasks** | **~130 lines** | |
