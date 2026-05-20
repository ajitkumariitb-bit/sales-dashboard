$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$NodeDir = Get-ChildItem -Path (Join-Path $Root ".tools\node") -Directory | Select-Object -First 1
if (-not $NodeDir) {
  throw "Portable Node was not found under .tools\node. Install Node.js from nodejs.org or ask Codex to recreate the portable runtime."
}

$Node = Join-Path $NodeDir.FullName "node.exe"
$NpmCli = Join-Path $NodeDir.FullName "node_modules\npm\bin\npm-cli.js"

& $Node $NpmCli install --cache (Join-Path $Root ".npm-cache") --ignore-scripts
