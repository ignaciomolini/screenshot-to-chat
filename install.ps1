# install.ps1
# Installs the screenshot-to-chat plugin into the user's OpenCode config.
# Usage:
#   .\install.ps1          # Copy the plugin folder into ~/.config/opencode/tui-plugins/
#   .\install.ps1 -DryRun  # Show what would happen, without doing it

param(
    [switch]$DryRun = $false
)

$ErrorActionPreference = "Stop"

# ── Paths ────────────────────────────────────────────────────────────────────
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

# ── Preflight ────────────────────────────────────────────────────────────────
if (-not (Test-Path $SourceEntry)) {
    Write-Error "Source file not found: $SourceEntry. Run this script from the plugin repo root."
    exit 1
}
if (-not (Test-Path $SourceService)) {
    Write-Error "Source file not found: $SourceService. Run this script from the plugin repo root."
    exit 1
}
if (-not (Test-Path $SourcePlatformsWindows)) {
    Write-Error "Source file not found: $SourcePlatformsWindows. Run this script from the plugin repo root."
    exit 1
}
if (-not (Test-Path $SourcePlatformsMacos)) {
    Write-Error "Source file not found: $SourcePlatformsMacos. Run this script from the plugin repo root."
    exit 1
}
if (-not (Test-Path $SourcePlatformsLinux)) {
    Write-Error "Source file not found: $SourcePlatformsLinux. Run this script from the plugin repo root."
    exit 1
}
if (-not (Test-Path $UserConfigDir)) {
    Write-Error "OpenCode config directory not found: $UserConfigDir. Is OpenCode installed?"
    exit 1
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
$LegacyFile = Join-Path $PluginsDir "screenshot-to-chat.tsx"
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
if ($DryRun) {
    Write-Host "[dry-run] Would backup: $TuiJsonPath -> $BackupPath"
} else {
    Copy-Item -Path $TuiJsonPath -Destination $BackupPath
    Write-Host "Backed up: $BackupPath" -ForegroundColor DarkGray
}

# Read & parse
try {
    $tuiConfig = Get-Content -Path $TuiJsonPath -Raw | ConvertFrom-Json
} catch {
    Write-Error "Failed to parse tui.json: $_"
    exit 1
}

# Ensure $tuiConfig.plugin is an array
if ($null -eq $tuiConfig.plugin) {
    $tuiConfig | Add-Member -NotePropertyName "plugin" -NotePropertyValue @() -Force
} elseif ($tuiConfig.plugin -isnot [System.Array]) {
    $tuiConfig.plugin = @($tuiConfig.plugin)
}

# Remove any legacy single-file entry pointing to the old location
$legacyEntries = $tuiConfig.plugin | Where-Object { $_ -eq $LegacyFile }
if ($legacyEntries) {
    $tuiConfig.plugin = @($tuiConfig.plugin | Where-Object { $_ -ne $LegacyFile })
    if (-not $DryRun) {
        Write-Host "Removed legacy entry from tui.json: $LegacyFile" -ForegroundColor DarkGray
    }
}

# Check if new path already present
$alreadyInstalled = $tuiConfig.plugin | Where-Object { $_ -eq $TargetEntry }

if ($alreadyInstalled) {
    Write-Host "Plugin already in tui.json plugin array. No change." -ForegroundColor DarkGray
} else {
    $tuiConfig.plugin = @($tuiConfig.plugin) + @($TargetEntry)

    if ($DryRun) {
        Write-Host "[dry-run] Would add '$TargetEntry' to tui.json plugin array"
    } else {
        $tuiConfig | ConvertTo-Json -Depth 10 | Set-Content -Path $TuiJsonPath
        Write-Host "Added '$TargetEntry' to tui.json plugin array" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "Done. Restart OpenCode to load the plugin." -ForegroundColor Cyan
Write-Host "  Keybind: Ctrl+S" -ForegroundColor DarkGray
