#!/usr/bin/env bash
# install.sh
# Installs the screenshot-to-chat plugin into the user's OpenCode config.
# Usage:
#   ./install.sh             # Run from a local clone
#   ./install.sh --dry-run   # Preview what would happen, without doing it
#   curl -fsSL https://raw.githubusercontent.com/ignaciomolini/screenshot-to-chat/main/install.sh | bash
#                            # One-liner install from anywhere

set -euo pipefail

# ── Argument parsing ────────────────────────────────────────────────────────
DRY_RUN=false
for arg in "$@"; do
    case "$arg" in
        --dry-run)
            DRY_RUN=true
            ;;
        -h|--help)
            cat <<'EOF'
Usage: install.sh [--dry-run]

Options:
  --dry-run    Show what would happen, without doing it
  -h, --help   Show this help
EOF
            exit 0
            ;;
        *)
            echo "Unknown argument: $arg" >&2
            echo "Run with --help for usage." >&2
            exit 1
            ;;
    esac
done

# ── Constants ───────────────────────────────────────────────────────────────
RAW_BASE_URL="https://raw.githubusercontent.com/ignaciomolini/screenshot-to-chat/main"

# ── Preflight: required tools (check before any work so dry-run is complete)
# `jq` is required for tui.json patching. We verify presence up front so that
# `install.sh --dry-run` reports a complete plan instead of failing halfway.
if ! command -v jq >/dev/null 2>&1; then
    echo -e "\033[31mError: 'jq' is required. Install with: brew install jq / sudo apt install jq\033[0m" >&2
    exit 1
fi

# ── Target paths ────────────────────────────────────────────────────────────
USER_CONFIG_DIR="$HOME/.config/opencode"
PLUGINS_DIR="$USER_CONFIG_DIR/tui-plugins"
PLUGIN_DIR="$PLUGINS_DIR/screenshot-to-chat"
TARGET_ENTRY="$PLUGIN_DIR/screenshot-to-chat.tsx"
TARGET_SERVICE="$PLUGIN_DIR/screenshot-service.ts"
TARGET_PLATFORMS_DIR="$PLUGIN_DIR/screenshot-service.platforms"
TARGET_PLATFORMS_WINDOWS="$TARGET_PLATFORMS_DIR/windows.ts"
TARGET_PLATFORMS_MACOS="$TARGET_PLATFORMS_DIR/macos.ts"
TARGET_PLATFORMS_LINUX="$TARGET_PLATFORMS_DIR/linux.ts"
LEGACY_FILE="$PLUGINS_DIR/screenshot-to-chat.tsx"
TUI_JSON_PATH="$USER_CONFIG_DIR/tui.json"

# ── Mode detection ──────────────────────────────────────────────────────────
# If BASH_SOURCE[0] resolves to a real file in a directory that contains the
# entry source file, use that directory as the source (local mode). Otherwise
# (e.g. the script is piped from stdin via `curl ... | bash`) we enter
# one-liner mode and download the source files to a temp dir.
SOURCE_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ]; then
    candidate_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)"
    if [ -n "$candidate_dir" ] && [ -f "$candidate_dir/screenshot-to-chat.tsx" ]; then
        SOURCE_DIR="$candidate_dir"
    fi
fi

# ── Preflight: OpenCode config must exist ───────────────────────────────────
if [ ! -d "$USER_CONFIG_DIR" ]; then
    echo -e "\033[31mError: OpenCode config directory not found: $USER_CONFIG_DIR. Is OpenCode installed?\033[0m" >&2
    exit 1
fi

# ── One-liner mode: download source files to a temp dir ─────────────────────
TMP_DIR=""
if [ -z "$SOURCE_DIR" ]; then
    TMP_DIR="$(mktemp -d -t screenshot-to-chat-XXXXXX)"
    # Cleanup on exit (success or failure)
    trap 'rm -rf "$TMP_DIR"' EXIT

    mkdir -p "$TMP_DIR/screenshot-service.platforms"

    if [ "$DRY_RUN" = true ]; then
        echo "[dry-run] Would create temp dir: $TMP_DIR"
        echo "[dry-run] Would download 5 plugin files from $RAW_BASE_URL"
        echo "[dry-run] Creating empty placeholder files so preflight can validate the planned layout"
    else
        echo -e "\033[90mDownloading plugin files to: $TMP_DIR\033[0m"
    fi

    for relpath in \
        "screenshot-to-chat.tsx" \
        "screenshot-service.ts" \
        "screenshot-service.platforms/windows.ts" \
        "screenshot-service.platforms/macos.ts" \
        "screenshot-service.platforms/linux.ts"
    do
        url="$RAW_BASE_URL/$relpath"
        out="$TMP_DIR/$relpath"
        if [ "$DRY_RUN" = true ]; then
            echo "[dry-run] Would download: $url -> $out"
            # Create an empty placeholder so the source-file preflight below
            # passes and the user gets a complete preview of the planned
            # install (no misleading "Source file not found" error).
            : > "$out"
        else
            if ! curl -fsSL -o "$out" "$url"; then
                echo -e "\033[31mError: Failed to download $url\033[0m" >&2
                exit 1
            fi
        fi
    done

    # Sanity-check: a 200 response with an HTML error page (e.g. during
    # GitHub outages or proxy hijack) would otherwise pass the `-f $src`
    # preflight below. Catches the worst case cheaply: TS/TSX files never
    # start with <!DOCTYPE or <html. Uses $TMP_DIR directly because
    # $SOURCE_ENTRY is only defined after this block.
    if [ "$DRY_RUN" = false ] && [ -f "$TMP_DIR/screenshot-to-chat.tsx" ]; then
        first_bytes=$(head -c 100 "$TMP_DIR/screenshot-to-chat.tsx" | tr -d '[:space:]')
        case "$first_bytes" in
            *\<\!DOCTYPE*|*\<html*)
                echo -e "\033[31mError: download returned HTML, not source. Aborting.\033[0m" >&2
                exit 1
                ;;
        esac
    fi

    SOURCE_DIR="$TMP_DIR"
fi

# ── Source paths (now resolved either from local clone or temp dir) ─────────
SOURCE_ENTRY="$SOURCE_DIR/screenshot-to-chat.tsx"
SOURCE_SERVICE="$SOURCE_DIR/screenshot-service.ts"
SOURCE_PLATFORMS_DIR="$SOURCE_DIR/screenshot-service.platforms"
SOURCE_PLATFORMS_WINDOWS="$SOURCE_PLATFORMS_DIR/windows.ts"
SOURCE_PLATFORMS_MACOS="$SOURCE_PLATFORMS_DIR/macos.ts"
SOURCE_PLATFORMS_LINUX="$SOURCE_PLATFORMS_DIR/linux.ts"

# ── Preflight: source files must exist (locally or downloaded) ──────────────
for src in "$SOURCE_ENTRY" "$SOURCE_SERVICE" "$SOURCE_PLATFORMS_WINDOWS" "$SOURCE_PLATFORMS_MACOS" "$SOURCE_PLATFORMS_LINUX"; do
    if [ ! -f "$src" ]; then
        echo -e "\033[31mError: Source file not found: $src\033[0m" >&2
        exit 1
    fi
done

# ── Create plugin folder ────────────────────────────────────────────────────
if [ ! -d "$PLUGIN_DIR" ]; then
    if [ "$DRY_RUN" = true ]; then
        echo "[dry-run] Would create directory: $PLUGIN_DIR"
    else
        mkdir -p "$PLUGIN_DIR"
        echo -e "\033[90mCreated directory: $PLUGIN_DIR\033[0m"
    fi
fi

# ── Copy source files into the plugin folder ────────────────────────────────
for pair in \
    "$SOURCE_ENTRY:$TARGET_ENTRY" \
    "$SOURCE_SERVICE:$TARGET_SERVICE"
do
    from="${pair%%:*}"
    to="${pair##*:}"
    if [ "$DRY_RUN" = true ]; then
        echo "[dry-run] Would copy: $from -> $to"
    else
        cp -f "$from" "$to"
        echo -e "\033[32mCopied: $to\033[0m"
    fi
done

# ── Copy the per-platform module files into the subfolder ───────────────────
# (The dispatcher in screenshot-service.ts imports from
#  ./screenshot-service.platforms/{windows,macos,linux}.ts at module load.
#  Without these files the plugin fails to load and OpenCode won't list it.
#  Test files and the .gitkeep placeholder are intentionally NOT copied —
#  they're dev-only and not needed at runtime.)
if [ ! -d "$TARGET_PLATFORMS_DIR" ]; then
    if [ "$DRY_RUN" = true ]; then
        echo "[dry-run] Would create directory: $TARGET_PLATFORMS_DIR"
    else
        mkdir -p "$TARGET_PLATFORMS_DIR"
        echo -e "\033[90mCreated directory: $TARGET_PLATFORMS_DIR\033[0m"
    fi
fi

for pair in \
    "$SOURCE_PLATFORMS_WINDOWS:$TARGET_PLATFORMS_WINDOWS" \
    "$SOURCE_PLATFORMS_MACOS:$TARGET_PLATFORMS_MACOS" \
    "$SOURCE_PLATFORMS_LINUX:$TARGET_PLATFORMS_LINUX"
do
    from="${pair%%:*}"
    to="${pair##*:}"
    if [ "$DRY_RUN" = true ]; then
        echo "[dry-run] Would copy: $from -> $to"
    else
        cp -f "$from" "$to"
        echo -e "\033[32mCopied: $to\033[0m"
    fi
done

# ── Cleanup legacy single-file install (if upgrading from an older installer)
if [ -f "$LEGACY_FILE" ]; then
    if [ "$DRY_RUN" = true ]; then
        echo "[dry-run] Would remove legacy file: $LEGACY_FILE"
    else
        rm -f "$LEGACY_FILE"
        echo -e "\033[90mRemoved legacy single-file install: $LEGACY_FILE\033[0m"
    fi
fi

# ── Patch tui.json ──────────────────────────────────────────────────────────
if [ ! -f "$TUI_JSON_PATH" ]; then
    echo -e "\033[33mWarning: tui.json not found at $TUI_JSON_PATH. Add the plugin path to your config manually:\033[0m" >&2
    echo -e "\033[33m  $TARGET_ENTRY\033[0m" >&2
    exit 0
fi

# Backup before mutating
backup_path="$TUI_JSON_PATH.backup-$(date +%Y%m%d-%H%M%S)"
backup_created=false
if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] Would backup: $TUI_JSON_PATH -> $backup_path"
else
    cp -f "$TUI_JSON_PATH" "$backup_path"
    echo -e "\033[90mBacked up: $backup_path\033[0m"
    backup_created=true
fi

# Prune old backups, keep the most recent 3 (rotation avoids unbounded growth).
# Only prune when a backup was actually created this run.
if [ "$backup_created" = true ]; then
    # shellcheck disable=SC2012
    ls -1t "$TUI_JSON_PATH".backup-* 2>/dev/null | tail -n +4 | xargs -r rm -f
fi

# Read tui.json ONCE into memory so we patch from a single consistent
# snapshot. jq < 1.6 cannot parse a leading UTF-8 BOM, so strip it first
# using a portable `od` check (avoids requiring `xxd`).
tui_config=""
if ! tui_config=$(cat "$TUI_JSON_PATH" 2>/dev/null); then
    echo -e "\033[31mError: Failed to read tui.json\033[0m" >&2
    exit 1
fi
if [ "$(printf '%.3s' "$tui_config" | od -An -tx1 | tr -d ' \n')" = "efbbbf" ]; then
    tui_config="${tui_config:3}"
fi
if ! printf '%s' "$tui_config" | jq -e . >/dev/null 2>&1; then
    echo -e "\033[31mError: Failed to parse tui.json\033[0m" >&2
    exit 1
fi

# Compute the desired final state in a single jq pass over the in-memory copy.
# `.plugin` is normalized to an array of strings so this works whether the
# config has `"plugin": [...]` or the non-standard `"plugin": "string"` shape.
state=$(printf '%s' "$tui_config" | jq -c --arg entry "$TARGET_ENTRY" --arg legacy "$LEGACY_FILE" '
    def norm: if type == "array" then map(tostring) else [tostring] end;
    def base: (.plugin // []) | norm;
    base as $current
    | ($current | any(. == $legacy)) as $had_legacy
    | ($current | any(. == $entry))  as $had_entry
    | ($current
        | map(select(. != $legacy))
        | if any(. == $entry) then . else . + [$entry] end
      ) as $plugins
    | { had_legacy: $had_legacy, had_entry: $had_entry, plugins: $plugins }
')
had_legacy=$(printf '%s' "$state" | jq -r '.had_legacy')
had_entry=$(printf '%s' "$state" | jq -r '.had_entry')
new_plugins=$(printf '%s' "$state" | jq -c '.plugins')

# Normalized current plugins (after legacy removal) for change detection.
current_plugins_normalized=$(printf '%s' "$tui_config" | jq -c --arg legacy "$LEGACY_FILE" '
    (.plugin // []) | if type == "array" then map(tostring) else [tostring] end | map(select(. != $legacy))
')

if [ "$new_plugins" = "$current_plugins_normalized" ] && [ "$had_legacy" = false ]; then
    # Entry already present and no legacy to remove — nothing to do.
    echo -e "\033[90mPlugin already in tui.json plugin array. No change.\033[0m"
elif [ "$DRY_RUN" = true ]; then
    if [ "$had_legacy" = true ] && [ "$had_entry" = false ]; then
        echo "[dry-run] Would remove legacy entry and add '$TARGET_ENTRY' to tui.json"
    elif [ "$had_legacy" = true ]; then
        echo "[dry-run] Would remove legacy entry from tui.json: $LEGACY_FILE"
    else
        echo "[dry-run] Would add '$TARGET_ENTRY' to tui.json plugin array"
    fi
else
    new_tui=$(printf '%s' "$tui_config" | jq -c --argjson plugin "$new_plugins" '.plugin = $plugin')
    tmp_file="$(mktemp)"
    if ! printf '%s' "$new_tui" > "$tmp_file"; then
        rm -f "$tmp_file"
        echo -e "\033[31mError: Failed to write tui.json\033[0m" >&2
        exit 1
    fi
    mv "$tmp_file" "$TUI_JSON_PATH"
    if [ "$had_legacy" = true ]; then
        echo -e "\033[90mRemoved legacy entry from tui.json: $LEGACY_FILE\033[0m"
    fi
    if [ "$had_entry" = false ]; then
        echo -e "\033[32mAdded '$TARGET_ENTRY' to tui.json plugin array\033[0m"
    fi
fi

echo ""
echo -e "\033[36mDone. Restart OpenCode to load the plugin.\033[0m"
echo -e "\033[90m  Keybind: Ctrl+S\033[0m"
