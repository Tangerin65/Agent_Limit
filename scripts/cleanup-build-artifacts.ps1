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
  (Join-Path $repoRoot "node_modules")
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

  try {
    Remove-Item -LiteralPath $resolvedPath -Recurse -Force -ErrorAction Stop
    Write-Host "Removed $resolvedPath"
  } catch {
    Write-Warning "Failed to fully remove $resolvedPath. Close processes that may lock files and retry. Details: $($_.Exception.Message)"
  }
}

foreach ($target in $safeTargets) {
  Remove-PathIfExists -TargetPath $target
}

if ($Deep) {
  foreach ($target in $deepTargets) {
    Remove-PathIfExists -TargetPath $target
  }
}
