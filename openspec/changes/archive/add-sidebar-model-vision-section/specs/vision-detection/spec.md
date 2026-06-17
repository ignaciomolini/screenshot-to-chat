# Delta Spec: Vision Detection & Sidebar Model Section

## Domain: `vision-detection`

## ADDED Requirements

### REQ-VD-001: Vision Detection Function

The system SHALL provide a pure function `supportsVision(modelId: string | undefined): boolean` that determines whether a given model identifier supports vision (image input) capability.

**Acceptance Scenarios:**

#### Scenario: Known vision-capable model (GPT-4o)

- **Given** the model ID is `"gpt-4o"`
- **When** `supportsVision` is called with that ID
- **Then** it MUST return `true`

#### Scenario: Known vision-capable model (Claude)

- **Given** the model ID is `"claude-sonnet-4-5"`
- **When** `supportsVision` is called with that ID
- **Then** it MUST return `true`

#### Scenario: Known vision-capable model (Gemini)

- **Given** the model ID is `"gemini-2.5-pro"`
- **When** `supportsVision` is called with that ID
- **Then** it MUST return `true`

#### Scenario: Blacklisted model

- **Given** the model ID is `"minimax-m3"`
- **When** `supportsVision` is called with that ID
- **Then** it MUST return `false` regardless of pattern match

#### Scenario: Undefined model ID

- **Given** the model ID is `undefined`
- **When** `supportsVision` is called
- **Then** it MUST return `false`

#### Scenario: Unknown model ID (default deny)

- **Given** the model ID is `"some-unknown-model-xyz"`
- **When** `supportsVision` is called with that ID
- **Then** it MUST return `false`

### REQ-VD-002: Sidebar Model Section Display

The plugin SHALL render a "Model" section in the sidebar via the `sidebar_content` slot. The section MUST display the current model name and a vision capability indicator.

**Acceptance Scenarios:**

#### Scenario: Vision-capable model displayed

- **Given** the active session uses model `"gpt-4o"`
- **When** the sidebar renders
- **Then** the section SHALL display `"gpt-4o"` with a green dot (`●`) labeled "vision"

#### Scenario: Non-vision model displayed

- **Given** the active session uses model `"minimax-m3"`
- **When** the sidebar renders
- **Then** the section SHALL display `"minimax-m3"` with a red dot (`●`) labeled "no vision"

#### Scenario: Model changes reactively

- **Given** the sidebar is displaying model `"gpt-4o"`
- **When** the user switches to model `"minimax-m3"`
- **Then** the section SHALL update to show `"minimax-m3"` with a red dot without requiring a page reload

#### Scenario: No active session

- **Given** there is no active session (session_id is null/undefined)
- **When** the sidebar renders
- **Then** the Model section SHALL render empty (no content)

### REQ-VD-003: Vision Detection Location

The `supportsVision` function and its associated constants (`NO_VISION_MODELS`, `VISION_PATTERNS`) SHALL be defined in and exported from `screenshot-service.ts`.

**Acceptance Scenarios:**

#### Scenario: Importable from service module

- **Given** a consumer module
- **When** it imports `supportsVision` from `"./screenshot-service.ts"`
- **Then** the import SHALL resolve and the function SHALL be callable

### REQ-VD-004: Removal of Legacy Vision Code

The plugin entry (`screenshot-to-chat.tsx`) SHALL NOT contain a local `VISION_MODELS` set or local `supportsVision` function. It SHALL import `supportsVision` from `./screenshot-service.ts`.

**Acceptance Scenarios:**

#### Scenario: No duplicate vision logic

- **Given** the codebase after this change
- **When** searching `screenshot-to-chat.tsx` for `VISION_MODELS`
- **Then** no matches SHALL be found

#### Scenario: Shared import used

- **Given** `screenshot-to-chat.tsx` needs vision detection
- **When** the file references `supportsVision`
- **Then** it SHALL be imported from `"./screenshot-service.ts"`
