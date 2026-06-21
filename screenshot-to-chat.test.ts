/**
 * Contract tests for the plugin entry point.
 *
 * The TUI runtime isn't loaded here — we only assert on the static shape
 * of `screenshot-to-chat.tsx` so the entry remains platform-agnostic
 * (per spec Req #15: Entry Point Decoupling).
 *
 * The file-content grep is the simplest and most direct way to catch
 * accidental re-introduction of a `process.platform` guard in the entry
 * point. A real test for the toast branches would require a full mock of
 * the TUI api, which is out of scope for this layer.
 */

import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTRY_PATH = join(__dirname, "screenshot-to-chat.tsx");

describe("screenshot-to-chat entry point", () => {
  it("contains no process.platform guard", () => {
    // The dispatcher in screenshot-service.ts routes by process.platform
    // at module load — the entry point is platform-agnostic. A guard
    // here would re-introduce the "Windows only" behavior that the
    // add-multi-platform-support change removes.
    const source = readFileSync(ENTRY_PATH, "utf-8");
    expect(source).not.toMatch(/process\.platform/);
  });

  it("contains no Windows-only toast", async () => {
    // The literal "only supported on Windows in this version" string was
    // removed when the guard was deleted. Catching it here means a
    // future change that re-introduces a platform guard (or copies the
    // old string from a stale comment) fails this test.
    const source = readFileSync(ENTRY_PATH, "utf-8");
    expect(source).not.toMatch(/only supported on Windows/i);
  });

  it("still imports the dispatcher entry points (spawnSnipping, pollClipboard)", async () => {
    // Negative contract: the entry must still call into the dispatcher.
    // If someone refactors the entry to use the platform module directly
    // (bypassing the dispatcher), this test fails.
    const source = readFileSync(ENTRY_PATH, "utf-8");
    expect(source).toMatch(/spawnSnipping/);
    expect(source).toMatch(/pollClipboard/);
  });
});
