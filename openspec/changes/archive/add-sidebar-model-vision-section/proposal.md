# Proposal: Add Sidebar Model & Vision Section

## Intent

Replace the minimal `sidebar_footer` vision indicator (`(vision)` / `(no vision)`) with a proper `sidebar_content` section that displays the current model name alongside a colored vision capability dot. The section MUST update reactively when the user switches models.

## Motivation

The current footer indicator is visually disconnected from context — it shows a bare text label with no model identification. Users cannot tell WHICH model is active or whether it supports vision at a glance. A consolidated "Model" section in the sidebar provides both pieces of information in a compact, scannable format.

## Scope

### In Scope

- Add `supportsVision()` function to `screenshot-service.ts` using pattern-based detection with a blacklist
- Replace `sidebar_footer` slot with `sidebar_content` slot showing model name + vision dot
- Remove local `VISION_MODELS` set and `supportsVision()` from `screenshot-to-chat.tsx`
- Clean `as any` cast in `getCurrentModelId()` using typed `Session.model` field
- Add unit tests for `supportsVision()` in `screenshot-service.test.ts`
- Update README with new sidebar section documentation

### Out of Scope

- Model switching UI (OpenCode's responsibility)
- Changes to `screenshot-to-chat-server.ts`
- Changes to the screenshot capture flow
- Changes to command registration or keybindings

## Approach

1. **Move vision detection to service layer** — pattern-based heuristic (`VISION_PATTERNS` regex array) with explicit blacklist (`NO_VISION_MODELS` set). Default-deny: unknown models return `false`.
2. **Use `sidebar_content` slot** — receives `session_id` as prop, reads model reactively via `api.state.session.get(session_id)?.model?.id`, renders a bordered section with model name and colored dot.
3. **Strict TDD** — write `supportsVision` tests first, then implement, then verify.

## Rollback Plan

- All changes are additive to the service layer (new export) and localized to two files
- Revert: restore the `sidebar_footer` block and remove the `supportsVision` export
- No data migration or state changes involved

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `sidebar_content` slot API changes | Low | Medium | Slot is documented in plugin SDK; fallback to `sidebar_footer` if needed |
| Pattern misses a vision model | Medium | Low | Default-deny is safe; user sees red dot, can still send screenshots |
| `@ts-nocheck` removal causes type errors | Low | Low | Keep `@ts-nocheck` if removal breaks; not a blocker |
