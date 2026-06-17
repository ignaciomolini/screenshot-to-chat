# install.ps1
# Installs the screenshot-to-chat plugin into the user's OpenCode config.
# Usage:
#   .\install.ps1              # Copy the plugin file
#   .\install.ps1 -Symlink     # Symlink instead of copy (live dev workflow)
#   .\install.ps1 -DryRun      # Show what would happen, without doing it

param(
    [switch]$Symlink = $false,
    [switch]$DryRun = $false
)

$ErrorActionPreference = "Stop"

# ── Paths ────────────────────────────────────────────────────────────────────
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SourceFile = Join-Path $ScriptDir "screenshot-to-chat.tsx"
$UserConfigDir = Join-Path $env:USERPROFILE ".config\opencode"
$PluginsDir = Join-Path $UserConfigDir "tui-plugins"
$TargetFile = Join-Path $PluginsDir "screenshot-to-chat.tsx"
$TuiJsonPath = Join-Path $UserConfigDir "tui.json"

# ── Preflight ────────────────────────────────────────────────────────────────
if (-not (Test-Path $SourceFile)) {
    Write-Error "Source file not found: $SourceFile. Run this script from the plugin repo root."
    exit 1
}

if (-not (Test-Path $UserConfigDir)) {
    Write-Error "OpenCode config directory not found: $UserConfigDir. Is OpenCode installed?"
    exit 1
}

# ── Copy or symlink the plugin file ──────────────────────────────────────────
if (-not (Test-Path $PluginsDir)) {
    if ($DryRun) {
        Write-Host "[dry-run] Would create directory: $PluginsDir"
    } else {
        New-Item -ItemType Directory -Force -Path $PluginsDir | Out-Null
        Write-Host "Created directory: $PluginsDir" -ForegroundColor DarkGray
    }
}

if ($Symlink) {
    if (Test-Path $TargetFile) { Remove-Item $TargetFile -Force }
    if ($DryRun) {
        Write-Host "[dry-run] Would symlink: $TargetFile -> $SourceFile"
    } else {
        New-Item -ItemType SymbolicLink -Path $TargetFile -Target $SourceFile | Out-Null
        Write-Host "Symlinked: $TargetFile -> $SourceFile" -ForegroundColor Green
    }
} else {
    if ($DryRun) {
        Write-Host "[dry-run] Would copy: $SourceFile -> $TargetFile"
    } else {
        Copy-Item -Path $SourceFile -Destination $TargetFile -Force
        Write-Host "Copied: $SourceFile -> $TargetFile" -ForegroundColor Green
    }
}

# ── Patch tui.json ───────────────────────────────────────────────────────────
if (-not (Test-Path $TuiJsonPath)) {
    Write-Warning "tui.json not found at $TuiJsonPath. Add the plugin path to your config manually."
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

# Ensure $tuiConfig.plugin is an array (it can be a single string or $null)
if ($null -eq $tuiConfig.plugin) {
    $tuiConfig | Add-Member -NotePropertyName "plugin" -NotePropertyValue @() -Force
} elseif ($tuiConfig.plugin -isnot [System.Array]) {
    $tuiConfig.plugin = @($tuiConfig.plugin)
}

# Check if already installed
$alreadyInstalled = $tuiConfig.plugin | Where-Object { $_ -eq $TargetFile }

if ($alreadyInstalled) {
    Write-Host "Plugin already in tui.json plugin array. No change." -ForegroundColor DarkGray
} else {
    $tuiConfig.plugin = @($tuiConfig.plugin) + @($TargetFile)

    if ($DryRun) {
        Write-Host "[dry-run] Would add '$TargetFile' to tui.json plugin array"
    } else {
        $tuiConfig | ConvertTo-Json -Depth 10 | Set-Content -Path $TuiJsonPath
        Write-Host "Added '$TargetFile' to tui.json plugin array" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "Done. Restart OpenCode to load the plugin." -ForegroundColor Cyan
Write-Host "  Keybind: Ctrl+S" -ForegroundColor DarkGray
