#Requires -Version 5.1
# Windows equivalent of uninstall.sh.
# Usage: .\scripts\uninstall.ps1 [VaultPath]   (defaults to <repo>\dev-vault)
param([string]$VaultPath)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$PluginId = (Get-Content -LiteralPath (Join-Path $RepoRoot 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).id
if (-not $VaultPath) { $VaultPath = Join-Path $RepoRoot 'dev-vault' }

if (-not (Test-Path -LiteralPath $VaultPath -PathType Container)) {
  Write-Error "Vault path does not exist: $VaultPath"
  exit 1
}

$ObsidianDir = Join-Path $VaultPath '.obsidian'
$PluginDir = Join-Path $ObsidianDir "plugins\$PluginId"
$CommunityPluginsFile = Join-Path $ObsidianDir 'community-plugins.json'

if (Test-Path -LiteralPath $PluginDir) {
  Write-Host "-> Removing plugin directory $PluginDir..."
  Remove-Item -LiteralPath $PluginDir -Recurse -Force
} else {
  Write-Host "-> Plugin directory not found at $PluginDir; nothing to delete."
}

if (-not (Test-Path -LiteralPath $ObsidianDir -PathType Container)) {
  Write-Host "-> Obsidian config directory not found at $ObsidianDir; skipping community plugin cleanup."
  Write-Host "Done."
  exit 0
}

if (-not (Test-Path -LiteralPath $CommunityPluginsFile)) {
  Write-Host "-> community-plugins.json not found at $CommunityPluginsFile; skipping plugin list cleanup."
  Write-Host "Done."
  exit 0
}

Write-Host "-> Removing '$PluginId' from $CommunityPluginsFile..."
try {
  $raw = Get-Content -LiteralPath $CommunityPluginsFile -Raw -Encoding UTF8
  $parsed = @(ConvertFrom-Json -InputObject $raw | ForEach-Object { $_ })  # enumerate: 5.1 emits the array as one object
  $filtered = @($parsed | Where-Object { $_ -ne $PluginId })

  if ($filtered.Count -ne $parsed.Count) {
    # Build the array by hand: Windows PowerShell 5.1's ConvertTo-Json unwraps
    # single-element arrays into a bare scalar, which would corrupt the file.
    $items = @($filtered | ForEach-Object { ConvertTo-Json -InputObject ([string]$_) -Compress })
    $json = '[' + ($items -join ', ') + ']'
    # Write UTF-8 without BOM so Obsidian's JSON parser is happy.
    [System.IO.File]::WriteAllText($CommunityPluginsFile, $json + "`n", (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "Done. Plugin files and community plugin entry removed."
  } else {
    Write-Host "Done. Plugin files removed; '$PluginId' was not listed in community-plugins.json."
  }
} catch {
  Write-Error "Failed to update $CommunityPluginsFile. The plugin directory has been removed, but the community plugin list may still reference '$PluginId'. $_"
  exit 1
}
