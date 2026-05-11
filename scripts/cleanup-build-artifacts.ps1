param(
  [switch]$Deep
)

$repoRoot = Split-Path -Parent $PSScriptRoot

$safeTargets = @(
  (Join-Path $repoRoot "dist"),
  (Join-Path $repoRoot "src-tauri\target"),
  (Join-Path $repoRoot "src-tauri\gen")
)

$deepTargets = @(
  (Join-Path $repoRoot "node_modules"),
  (Join-Path $repoRoot "Agent Limit.exe"),
  (Join-Path $repoRoot "Agent Limit Setup.exe")
)

function Remove-PathIfExists {
  param(
    [string]$TargetPath
  )

  if (-not (Test-Path -LiteralPath $TargetPath)) {
    return
  }

  $resolvedPath = (Resolve-Path -LiteralPath $TargetPath).Path
  if (-not $resolvedPath.StartsWith($repoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove path outside repository root: $resolvedPath"
  }

  Remove-Item -LiteralPath $resolvedPath -Recurse -Force
  Write-Host "Removed $resolvedPath"
}

foreach ($target in $safeTargets) {
  Remove-PathIfExists -TargetPath $target
}

if ($Deep) {
  foreach ($target in $deepTargets) {
    Remove-PathIfExists -TargetPath $target
  }
}
