/** @jsxImportSource @opentui/solid */
import type {
  TuiPlugin,
  TuiPluginApi,
  TuiPluginMeta,
} from "@opencode-ai/plugin/tui";
import {
  spawnSnipping,
  pollClipboard,
  validateSize,
  buildFilePart,
} from "./screenshot-service.ts";
import type { PluginOptions } from "@opencode-ai/plugin";

const PLUGIN_ID = "screenshot-to-chat";
const COMMAND_VALUE = "screenshot-to-chat.capture";

// ── Plugin entry point ───────────────────────────────────────────────────────

const tui: TuiPlugin = async (
  api: TuiPluginApi,
  _options: PluginOptions | undefined,
  _meta: TuiPluginMeta,
) => {
  // ── Capture orchestration ─────────────────────────────────────────────────
  //
  // The entry owns the flow: spawn → poll → validate → build → submit. Each
  // step is delegated to a pure function in `screenshot-service.ts` so the
  // logic stays unit-testable.

  api.command?.register(() => [
    {
      title: "Capture Screenshot",
      value: COMMAND_VALUE,
      description: "Capture a screen region and send it as an image message",
      keybind: "ctrl+s",
      slash: {
        name: "screenshot",
        aliases: ["capture"],
      },
      onSelect: () => {
        handleCapture(api);
      },
    },
  ]);
};

// ── handleCapture ────────────────────────────────────────────────────────────

async function handleCapture(api: TuiPluginApi): Promise<void> {
  if (process.platform !== "win32") {
    api.ui.toast({
      variant: "warning",
      message: "Screenshot capture is only supported on Windows in this version",
    });
    return;
  }

  // ── Resolve session ID (create one if route has none) ──────────────────────
  let sessionID: string | null = null;
  const route = api.route.current;
  if (route.name === "session" && route.params?.sessionID) {
    sessionID = String(route.params.sessionID);
  }
  if (!sessionID) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (api.client as any).session.create({});
      const newID = result?.data?.id as string | undefined;
      if (!newID) {
        api.ui.toast({
          variant: "error",
          message: "No active session — failed to create a new one",
        });
        return;
      }
      sessionID = newID;
      api.ui.toast({
        variant: "info",
        message: "New session created — capturing screenshot",
      });
      try {
        api.route.navigate("session", { sessionID: newID });
      } catch {
        // best-effort — capture continues regardless
      }
    } catch (err) {
      api.ui.toast({
        variant: "error",
        message: `No active session — failed to create one: ${(err as Error).message}`,
      });
      return;
    }
  }

  // ── Spawn snipping tool ───────────────────────────────────────────────────
  const spawnResult = await spawnSnipping();
  if (!spawnResult.ok) {
    const errMsg = (spawnResult.error as { message?: string }).message;
    const msg =
      spawnResult.error.type === "tool_unavailable"
        ? "Screenshot tool not available on this system"
        : `Failed to launch capture tool: ${errMsg ?? ""}`;
    api.ui.toast({ variant: "error", message: msg });
    return;
  }

  // ── Poll clipboard ───────────────────────────────────────────────────────
  const pollResult = await pollClipboard();
  if (!pollResult.ok) {
    api.ui.toast({
      variant: "warning",
      message: "Capture timed out — no image detected",
    });
    return;
  }

  // ── Validate size ────────────────────────────────────────────────────────
  const sizeResult = validateSize(pollResult.base64);
  if (!sizeResult.ok) {
    api.ui.toast({
      variant: "warning",
      message: "Screenshot exceeds 3 MB limit — try a smaller region",
    });
    return;
  }

  // ── Build file part and submit ───────────────────────────────────────────
  const filePart = buildFilePart(sizeResult.base64);
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (api.client as any).session.prompt({
      sessionID,
      parts: [filePart],
      noReply: true,
    });
    api.ui.toast({ variant: "success", message: "Screenshot sent" });
  } catch (err) {
    api.ui.toast({
      variant: "error",
      message: `Failed to send screenshot: ${(err as Error).message}`,
    });
  }
}

// ── Module export ────────────────────────────────────────────────────────────

const plugin = { id: PLUGIN_ID, tui };
export default plugin;
