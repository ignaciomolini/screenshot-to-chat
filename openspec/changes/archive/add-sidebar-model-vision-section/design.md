# Design: Add Sidebar Model & Vision Section

## Technical Approach

Move vision detection logic from the plugin entry point to the service layer as a testable pure function, then replace the `sidebar_footer` slot with a `sidebar_content` slot that renders a compact "Model" section with the model name and a colored vision dot. Reactivity is achieved by reading `api.state.session.get(session_id)` inside the Solid JSX so the framework's signal tracking handles updates automatically.

## Architecture Decisions

### Decision: Pattern-based vision detection with blacklist

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Hardcoded Set (current) | Simple but misses model variants (e.g. `claude-sonnet-4-5` vs `claude-sonnet`) | Rejected |
| Regex patterns + blacklist | Handles model families; blacklist overrides false positives | **Chosen** |
| API query to model registry | Most accurate but adds network dependency and latency | Rejected |

**Rationale**: Regex patterns cover model families (`claude-*`, `gpt-4o*`, `gemini-.*-pro`) without enumerating every variant. The blacklist handles known edge cases where a model name matches a pattern but lacks vision (e.g. `minimax-m3`).

### Decision: `sidebar_content` slot over `sidebar_footer`

| Option | Tradeoff | Decision |
|--------|----------|----------|
| `sidebar_footer` (current) | Limited — text only, no section borders, no model name | Rejected |
| `sidebar_content` | Full section with borders, model name, reactive to session | **Chosen** |

**Rationale**: `sidebar_content` receives `session_id` as a prop and renders as a full sidebar section with automatic border styling. This matches the visual design goal.

### Decision: Default-deny for unknown models

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Default-allow | Better UX for new models, but false positives send images to non-vision models | Rejected |
| Default-deny | Safe — warns user even if model actually supports vision | **Chosen** |

**Rationale**: A false negative (red dot on a vision model) is harmless — the user can still send the screenshot. A false positive (green dot on a non-vision model) leads to silent image rejection by the API.

## Data Flow

```
User switches model in OpenCode
         │
         ▼
api.state.session.get(session_id) ──→ { model: { id: "gpt-4o" } }
         │
         ▼
Solid JSX reactive read ──→ supportsVision("gpt-4o") ──→ true
         │
         ▼
┌─────────────────────────────┐
│ Model                       │
│ gpt-4o          ● vision    │  ← green dot
└─────────────────────────────┘
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `screenshot-service.ts` | Modify | Add `NO_VISION_MODELS`, `VISION_PATTERNS`, `supportsVision()` export (~25 lines) |
| `screenshot-to-chat.tsx` | Modify | Remove local vision code, remove `sidebar_footer` slot, add `sidebar_content` slot, import `supportsVision` from service (~35 lines net change) |
| `screenshot-service.test.ts` | Modify | Add `describe("supportsVision")` block with 6 test cases (~35 lines) |
| `README.md` | Modify | Add "Sidebar Model Section" documentation (~15 lines) |

## Interfaces / Contracts

```typescript
// screenshot-service.ts — new exports

/** Models explicitly known to NOT support vision, even if they match a pattern. */
export const NO_VISION_MODELS: Set<string>;

/** Regex patterns matching vision-capable model families. */
export const VISION_PATTERNS: RegExp[];

/** Returns true if the model ID matches a vision pattern and is not blacklisted. */
export function supportsVision(modelId: string | undefined): boolean;
```

```typescript
// sidebar_content slot props (from @opencode-ai/plugin/tui)
interface SidebarContentProps {
  session_id: string;
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `supportsVision()` with known vision models, blacklisted models, undefined, unknown | Direct function calls in `screenshot-service.test.ts` |
| Integration | Sidebar renders correct content for vision/non-vision models | Manual verification in OpenCode TUI (no automated E2E available) |

## Migration / Rollout

No migration required. The change is a UI enhancement with no data or state implications. The old `sidebar_footer` slot is simply replaced by the new `sidebar_content` slot in the same plugin registration call.

## Open Questions

- None
