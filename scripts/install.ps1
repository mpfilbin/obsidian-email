#Requires -Version 5.1
# Windows equivalent of install.sh.
# Usage: .\scripts\install.ps1 [VaultPath]   (defaults to <repo>\dev-vault)
param([string]$VaultPath)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$PluginId = (Get-Content -LiteralPath (Join-Path $RepoRoot 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).id
if (-not $VaultPath) { $VaultPath = Join-Path $RepoRoot 'dev-vault' }

if (-not (Test-Path -LiteralPath $VaultPath -PathType Container)) {
  Write-Error "Vault path does not exist: $VaultPath"
  exit 1
}

$PluginDir = Join-Path $VaultPath ".obsidian\plugins\$PluginId"

Write-Host "-> Building plugin..."
Push-Location $RepoRoot
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build failed (exit $LASTEXITCODE)" }
} finally {
  Pop-Location
}

Write-Host "-> Installing to $PluginDir..."
New-Item -ItemType Directory -Force -Path $PluginDir | Out-Null
foreach ($f in 'main.js', 'manifest.json', 'styles.css') {
  Copy-Item -LiteralPath (Join-Path $RepoRoot $f) -Destination $PluginDir -Force
}

Write-Host "Done. In Obsidian: reload and enable 'Email'."
