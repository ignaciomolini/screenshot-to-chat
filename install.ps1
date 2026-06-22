# install.ps1
# Installs the screenshot-to-chat plugin into the user's OpenCode config.
# Usage:
#   .\install.ps1          # Copy the plugin folder into ~/.config/opencode/tui-plugins/
#   .\install.ps1 -DryRun  # Show what would happen, without doing it
#   irm https://raw.githubusercontent.com/ignaciomolini/screenshot-to-chat/main/install.ps1 | iex
#                         # One-liner install from anywhere

param(
    [switch]$DryRun = $false
)

$ErrorActionPreference = "Stop"

# Suppress the noisy progress bar that Invoke-WebRequest renders for every
# download. Without this the one-liner install prints a progress bar with the
# raw GitHub URL on screen, which is ugly and leaks URLs in screen recordings.
$ProgressPreference = 'SilentlyContinue'

# Windows PowerShell 5.1 defaults to TLS 1.0/1.1 which GitHub no longer accepts
# on the main domain. Force TLS 1.2 so the one-liner mode can download from
# raw.githubusercontent.com.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ── Paths ────────────────────────────────────────────────────────────────────
$RawBaseUrl = "https://raw.githubusercontent.com/ignaciomolini/screenshot-to-chat/main"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SourceEntry = Join-Path $ScriptDir "screenshot-to-chat.tsx"
$SourceService = Join-Path $ScriptDir "screenshot-service.ts"
$SourcePlatformsDir = Join-Path $ScriptDir "screenshot-service.platforms"
$SourcePlatformsWindows = Join-Path $SourcePlatformsDir "windows.ts"
$SourcePlatformsMacos = Join-Path $SourcePlatformsDir "macos.ts"
$SourcePlatformsLinux = Join-Path $SourcePlatformsDir "linux.ts"

$UserConfigDir = Join-Path $env:USERPROFILE ".config\opencode"
$PluginsDir = Join-Path $UserConfigDir "tui-plugins"
$PluginDir = Join-Path $PluginsDir "screenshot-to-chat"
$TargetEntry = Join-Path $PluginDir "screenshot-to-chat.tsx"
$TargetService = Join-Path $PluginDir "screenshot-service.ts"
$TargetPlatformsDir = Join-Path $PluginDir "screenshot-service.platforms"
$TargetPlatformsWindows = Join-Path $TargetPlatformsDir "windows.ts"
$TargetPlatformsMacos = Join-Path $TargetPlatformsDir "macos.ts"
$TargetPlatformsLinux = Join-Path $TargetPlatformsDir "linux.ts"
$TuiJsonPath = Join-Path $UserConfigDir "tui.json"
$LegacyFile = Join-Path $PluginsDir "screenshot-to-chat.tsx"

# ── Preflight: OpenCode config must exist ───────────────────────────────────
if (-not (Test-Path $UserConfigDir)) {
    Write-Error "OpenCode config directory not found: $UserConfigDir. Is OpenCode installed?"
    exit 1
}

# ── Mode detection & one-liner download ──────────────────────────────────────
# If the entry source file is not at the script's location (e.g. the script is
# run from a temp dir via `irm ... | iex`), enter one-liner mode: download the
# plugin files to a temp dir and install from there.
#
# Detection: when run via `irm ... | iex`, $MyInvocation.MyCommand.Path is
# empty, so $ScriptDir is empty, and `Test-Path $SourceEntry` would resolve
# against the CWD — if CWD happens to contain a screenshot-to-chat.tsx the
# script would silently enter local mode and copy the wrong file. We detect
# the iex context explicitly and gate the download block on that flag.
$TmpDir = $null
$InOneLinerMode = $false
if ([string]::IsNullOrEmpty($ScriptDir) -or -not (Test-Path -LiteralPath $ScriptDir -PathType Container)) {
    $InOneLinerMode = $true
} elseif (-not (Test-Path -LiteralPath $SourceEntry)) {
    $InOneLinerMode = $true
}
try {
    if ($InOneLinerMode) {
        # One-liner mode
        $TmpDir = Join-Path $env:TEMP ("screenshot-to-chat-" + [System.IO.Path]::GetRandomFileName())
        New-Item -ItemType Directory -Force -Path $TmpDir | Out-Null
        New-Item -ItemType Directory -Force -Path (Join-Path $TmpDir "screenshot-service.platforms") | Out-Null

        if ($DryRun) {
            Write-Host "[dry-run] Would create temp dir: $TmpDir"
            Write-Host "[dry-run] Would download 5 plugin files from $RawBaseUrl"
            Write-Host "[dry-run] Creating empty placeholder files so preflight can validate the planned layout"
        } else {
            Write-Host "Downloading plugin files to: $TmpDir" -ForegroundColor DarkGray
        }

        $downloads = @(
            "screenshot-to-chat.tsx",
            "screenshot-service.ts",
            "screenshot-service.platforms/windows.ts",
            "screenshot-service.platforms/macos.ts",
            "screenshot-service.platforms/linux.ts"
        )
        foreach ($rel in $downloads) {
            $url = "$RawBaseUrl/$rel"
            $out = Join-Path $TmpDir $rel
            if ($DryRun) {
                Write-Host "[dry-run] Would download: $url -> $out"
                # Create an empty placeholder so the source-file preflight
                # below passes and the user gets a complete preview of the
                # planned install (no misleading "Source file not found").
                New-Item -ItemType File -Force -Path $out | Out-Null
            } else {
                try {
                    Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing -ErrorAction Stop
                } catch {
                    Write-Error "Failed to download $url`: $_"
                    exit 1
                }
            }
        }

        # Re-point source paths to the temp dir
        $SourceEntry = Join-Path $TmpDir "screenshot-to-chat.tsx"
        $SourceService = Join-Path $TmpDir "screenshot-service.ts"
        $SourcePlatformsDir = Join-Path $TmpDir "screenshot-service.platforms"
        $SourcePlatformsWindows = Join-Path $SourcePlatformsDir "windows.ts"
        $SourcePlatformsMacos = Join-Path $SourcePlatformsDir "macos.ts"
        $SourcePlatformsLinux = Join-Path $SourcePlatformsDir "linux.ts"
    }

    # ── Preflight: source files must exist (locally or downloaded) ──────────
    foreach ($src in @($SourceEntry, $SourceService, $SourcePlatformsWindows, $SourcePlatformsMacos, $SourcePlatformsLinux)) {
        if (-not (Test-Path $src)) {
            Write-Error "Source file not found: $src. Run this script from the plugin repo root."
            exit 1
        }
    }

# ── Create plugin folder ─────────────────────────────────────────────────────
if (-not (Test-Path $PluginDir)) {
    if ($DryRun) {
        Write-Host "[dry-run] Would create directory: $PluginDir"
    } else {
        New-Item -ItemType Directory -Force -Path $PluginDir | Out-Null
        Write-Host "Created directory: $PluginDir" -ForegroundColor DarkGray
    }
}

# ── Copy both source files into the plugin folder ───────────────────────────
foreach ($pair in @(
    @{ From = $SourceEntry;   To = $TargetEntry },
    @{ From = $SourceService; To = $TargetService }
)) {
    if ($DryRun) {
        Write-Host "[dry-run] Would copy: $($pair.From) -> $($pair.To)"
    } else {
        Copy-Item -Path $pair.From -Destination $pair.To -Force
        Write-Host "Copied: $($pair.To)" -ForegroundColor Green
    }
}

# ── Copy the per-platform module files into the subfolder ───────────────────
# (The dispatcher in screenshot-service.ts imports from
#  ./screenshot-service.platforms/{windows,macos,linux}.ts at module load.
#  Without these files the plugin fails to load and OpenCode won't list it.
#  Test files and the .gitkeep placeholder are intentionally NOT copied —
#  they're dev-only and not needed at runtime.)
if (-not (Test-Path $TargetPlatformsDir)) {
    if ($DryRun) {
        Write-Host "[dry-run] Would create directory: $TargetPlatformsDir"
    } else {
        New-Item -ItemType Directory -Force -Path $TargetPlatformsDir | Out-Null
        Write-Host "Created directory: $TargetPlatformsDir" -ForegroundColor DarkGray
    }
}

foreach ($pair in @(
    @{ From = $SourcePlatformsWindows; To = $TargetPlatformsWindows },
    @{ From = $SourcePlatformsMacos;   To = $TargetPlatformsMacos },
    @{ From = $SourcePlatformsLinux;   To = $TargetPlatformsLinux }
)) {
    if ($DryRun) {
        Write-Host "[dry-run] Would copy: $($pair.From) -> $($pair.To)"
    } else {
        Copy-Item -Path $pair.From -Destination $pair.To -Force
        Write-Host "Copied: $($pair.To)" -ForegroundColor Green
    }
}

# ── Cleanup legacy single-file install (if upgrading from an older installer) ─
if (Test-Path $LegacyFile) {
    if ($DryRun) {
        Write-Host "[dry-run] Would remove legacy file: $LegacyFile"
    } else {
        Remove-Item $LegacyFile -Force
        Write-Host "Removed legacy single-file install: $LegacyFile" -ForegroundColor DarkGray
    }
}

# ── Patch tui.json ───────────────────────────────────────────────────────────
if (-not (Test-Path $TuiJsonPath)) {
    Write-Warning "tui.json not found at $TuiJsonPath. Add the plugin path to your config manually:"
    Write-Warning "  $TargetEntry"
    exit 0
}

# Backup before mutating
$BackupPath = "$TuiJsonPath.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
$BackupCreated = $false
if ($DryRun) {
    Write-Host "[dry-run] Would backup: $TuiJsonPath -> $BackupPath"
} else {
    Copy-Item -Path $TuiJsonPath -Destination $BackupPath
    Write-Host "Backed up: $BackupPath" -ForegroundColor DarkGray
    $BackupCreated = $true
}

# Prune old backups, keep the most recent 3 (rotation avoids unbounded
# growth). Only prune when a backup was actually created this run.
if ($BackupCreated) {
    Get-ChildItem "$TuiJsonPath.backup-*" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -Skip 3 |
        Remove-Item -Force
}

# Read & parse. Use -Encoding UTF8 (PS 5.1 default UTF8 carries a BOM; JSON
# parsers tolerate it and the writers below produce no-BOM output, so the
# file ends up consistent over time).
try {
    $tuiConfig = Get-Content -Path $TuiJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
    Write-Error "Failed to parse tui.json: $_"
    exit 1
}

# A bare `null` tui.json deserializes to $null, which breaks Add-Member below.
# Normalize to an empty object so the rest of the patching pipeline can run.
if ($null -eq $tuiConfig) {
    $tuiConfig = [PSCustomObject]@{}
}

# Ensure $tuiConfig.plugin is an array
if ($null -eq $tuiConfig.plugin) {
    $tuiConfig | Add-Member -NotePropertyName "plugin" -NotePropertyValue @() -Force
} elseif ($tuiConfig.plugin -isnot [System.Array]) {
    $tuiConfig.plugin = @($tuiConfig.plugin)
}

# Track whether we need to mutate the file. Previously, the legacy-removal
# branch modified $tuiConfig in memory but only wrote the file in the
# "new path not present" branch — so a tui.json containing BOTH the legacy
# and the new entry would report "Removed legacy entry" while leaving the
# file unchanged on disk. Compute all changes first, then write once.
$removedLegacy = $false
$legacyEntries = $tuiConfig.plugin | Where-Object { $_ -eq $LegacyFile }
if ($legacyEntries) {
    $tuiConfig.plugin = @($tuiConfig.plugin | Where-Object { $_ -ne $LegacyFile })
    $removedLegacy = $true
}

$alreadyInstalled = $tuiConfig.plugin | Where-Object { $_ -eq $TargetEntry }
$needsAdd = -not $alreadyInstalled
if ($needsAdd) {
    $tuiConfig.plugin = @($tuiConfig.plugin) + @($TargetEntry)
}

if (-not $removedLegacy -and -not $needsAdd) {
    Write-Host "Plugin already in tui.json plugin array. No change." -ForegroundColor DarkGray
} elseif ($DryRun) {
    if ($removedLegacy) { Write-Host "[dry-run] Would remove legacy entry from tui.json: $LegacyFile" }
    if ($needsAdd) { Write-Host "[dry-run] Would add '$TargetEntry' to tui.json plugin array" }
} else {
    # Atomic write: render to UTF-8 no-BOM, write to a sibling temp file,
    # then `Move-Item -Force` to swap. Set-Content truncates in place and
    # uses the system default encoding (Windows-1252 / UTF-16 LE) on
    # PS 5.1, which can corrupt UTF-8 tui.json. The Move-Item swap is
    # atomic on the same filesystem, so a kill mid-write leaves the
    # previous tui.json intact.
    $json = $tuiConfig | ConvertTo-Json -Depth 10
    $tmpJson = "$TuiJsonPath.new"
    [System.IO.File]::WriteAllText($tmpJson, $json, [System.Text.UTF8Encoding]::new($false))
    Move-Item -Force -LiteralPath $tmpJson -Destination $TuiJsonPath
    if ($removedLegacy) { Write-Host "Removed legacy entry from tui.json: $LegacyFile" -ForegroundColor DarkGray }
    if ($needsAdd) { Write-Host "Added '$TargetEntry' to tui.json plugin array" -ForegroundColor Green }
}

Write-Host ""
Write-Host "Done. Restart OpenCode to load the plugin." -ForegroundColor Cyan
Write-Host "  Keybind: Ctrl+S" -ForegroundColor DarkGray
}
finally {
    if ($TmpDir) {
        Remove-Item $TmpDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
