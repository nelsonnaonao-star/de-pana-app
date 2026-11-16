param(
  [switch]$Write,
  [switch]$RateLimit,
  [string]$ApkPath = "",
  [string]$ChatId = "",
  [string]$UserId = "",
  [string]$Serial = "",
  [switch]$ExecuteAndroid
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

$auditArgs = @("security-tests/security-audit.mjs")
if ($Write) { $auditArgs += "--write" }
if ($RateLimit) { $auditArgs += "--rate-limit" }

Write-Host "Ejecutando auditoria API/RLS..."
& node @auditArgs
$auditExit = $LASTEXITCODE

if ($ApkPath) {
  Write-Host ""
  Write-Host "Ejecutando auditoria del APK..."
  & (Join-Path $PSScriptRoot "apk-audit.ps1") -ApkPath $ApkPath
}

if ($ExecuteAndroid) {
  Write-Host ""
  Write-Host "Ejecutando pruebas de intents Android..."
  $androidArgs = @(
    "-PackageName", "com.redon.app",
    "-Execute"
  )
  if ($Serial) { $androidArgs += @("-Serial", $Serial) }
  if ($ChatId) { $androidArgs += @("-ChatId", $ChatId) }
  if ($UserId) { $androidArgs += @("-UserId", $UserId) }
  if ($ApkPath) { $androidArgs += @("-ApkPath", $ApkPath) }
  & (Join-Path $PSScriptRoot "android-intents.ps1") @androidArgs
}

if ($auditExit -ne 0) {
  exit $auditExit
}
