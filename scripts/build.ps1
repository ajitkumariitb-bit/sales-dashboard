$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$NodeDir = Get-ChildItem -Path (Join-Path $Root ".tools\node") -Directory | Select-Object -First 1
if (-not $NodeDir) {
  throw "Portable Node was not found under .tools\node. Install Node.js from nodejs.org or ask Codex to recreate the portable runtime."
}

$Node = Join-Path $NodeDir.FullName "node.exe"
$Next = Join-Path $Root "node_modules\next\dist\bin\next"

& $Node $Next build
