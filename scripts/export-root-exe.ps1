param(
  [string]$Configuration = "release"
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourceExe = Join-Path $repoRoot "src-tauri\target\$Configuration\agent-limit.exe"
$targetExe = Join-Path $repoRoot "Agent Limit.exe"
$installerPattern = Join-Path $repoRoot "src-tauri\target\$Configuration\bundle\nsis\*.exe"
$targetInstaller = Join-Path $repoRoot "Agent Limit Setup.exe"

if (-not (Test-Path -LiteralPath $sourceExe)) {
  Write-Error "Expected executable was not found: $sourceExe"
  exit 1
}

Copy-Item -LiteralPath $sourceExe -Destination $targetExe -Force
Write-Host "Exported root executable to $targetExe"

$installer = Get-ChildItem -LiteralPath (Split-Path $installerPattern) -Filter *.exe -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if ($installer) {
  Copy-Item -LiteralPath $installer.FullName -Destination $targetInstaller -Force
  Write-Host "Exported installer to $targetInstaller"
}
