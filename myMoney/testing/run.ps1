$ErrorActionPreference = "Stop"

param(
  [int]$Port = 8001
)

function Require-Command {
  param([string]$cmd)
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $cmd"
  }
}

Require-Command python

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$appRoot = Join-Path $repoRoot "myMoney"
$serverScript = Join-Path $appRoot "server.py"

if (-not (Test-Path $serverScript)) {
  throw "Could not find $serverScript"
}

Write-Host "Starting myMoney dev server on http://127.0.0.1:$Port"
Start-Process "http://127.0.0.1:$Port/myMoney.html" | Out-Null
Push-Location $appRoot
try {
  & python "$serverScript" --port $Port
} finally {
  Pop-Location
}
