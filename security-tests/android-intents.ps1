param(
  [string]$Serial = "",
  [string]$PackageName = "com.redon.app",
  [string]$ChatId = "",
  [string]$UserId = "",
  [string]$ApkPath = "C:\Users\Nelson\Desktop\WEPA-1.15-test.apk",
  [switch]$Install,
  [switch]$Execute
)

$ErrorActionPreference = "Stop"

$adb = (Get-Command adb -ErrorAction Stop).Source
$adbArgs = @()
if ($Serial) { $adbArgs = @("-s", $Serial) }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$reportDir = Join-Path $PSScriptRoot "reports"
New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
$reportPath = Join-Path $reportDir "android-intents-$stamp.txt"
$lines = New-Object System.Collections.Generic.List[string]

function Add-Line {
  param([string]$Text)
  $lines.Add($Text)
  Write-Host $Text
}

function Invoke-Adb {
  param([string[]]$Arguments)
  & $adb @adbArgs @Arguments 2>&1
}

function Show-Logcat {
  $log = Invoke-Adb @("logcat", "-d", "-v", "time")
  $matches = $log | Select-String -Pattern "AndroidRuntime|FATAL EXCEPTION|SecurityException|Permission Denial|Supabase|Sentry|redon" | Select-Object -Last 80
  if ($matches) {
    Add-Line ($matches | ForEach-Object { $_.Line } | Out-String)
  } else {
    Add-Line "Sin lineas relevantes en logcat."
  }
}

function Start-TestIntent {
  param(
    [string]$Name,
    [string[]]$Arguments
  )

  Add-Line ""
  Add-Line "=== $Name ==="
  Add-Line ("am start " + ($Arguments -join " "))

  Invoke-Adb @("logcat", "-c") | Out-Null
  $output = Invoke-Adb (@("shell", "am", "start", "-W", "-n", "$PackageName/.MainActivity") + $Arguments)
  Add-Line ($output | Out-String)
  Start-Sleep -Seconds 2
  Show-Logcat
}

Add-Line "ADB: $adb"
Add-Line "Paquete: $PackageName"
Add-Line "Modo: $(if ($Execute) { 'EXECUTE' } else { 'DRY-RUN' })"

$devices = Invoke-Adb @("devices")
Add-Line ($devices | Out-String)

if (-not ($devices -match "\tdevice")) {
  Add-Line "No hay dispositivo o emulador conectado."
  $lines | Set-Content -LiteralPath $reportPath -Encoding UTF8
  throw "Conecta un dispositivo/emulador de pruebas. Reporte: $reportPath"
}

$model = Invoke-Adb @("shell", "getprop", "ro.product.model")
Add-Line ("Modelo: " + (($model | Out-String).Trim()))

if ($Install) {
  if (-not (Test-Path -LiteralPath $ApkPath)) {
    throw "No existe el APK: $ApkPath"
  }
  Add-Line "Instalando APK..."
  $install = Invoke-Adb @("install", "-r", $ApkPath)
  Add-Line ($install | Out-String)
}

$packagePath = Invoke-Adb @("shell", "pm", "path", $PackageName)
if (-not ($packagePath -match "package:")) {
  $lines | Set-Content -LiteralPath $reportPath -Encoding UTF8
  throw "El paquete $PackageName no esta instalado. Reporte: $reportPath"
}

Add-Line ("Ruta: " + (($packagePath | Out-String).Trim()))

if (-not $Execute) {
  Add-Line ""
  Add-Line "Comandos preparados:"
  if ($ChatId) {
    Add-Line "OPEN_APP con chatId=$ChatId"
  }
  if ($ChatId -and $UserId) {
    Add-Line "ANSWER_CALL con chatId=$ChatId y callerId=$UserId"
  }
  Add-Line ""
  Add-Line "Ejecuta de nuevo con -Execute y los IDs de prueba para disparar los intents."
  $lines | Set-Content -LiteralPath $reportPath -Encoding UTF8
  Write-Host "Reporte: $reportPath"
  exit 0
}

if (-not $ChatId) {
  Add-Line ""
  Add-Line "Falta -ChatId. No se puede probar OPEN_APP/ANSWER_CALL con datos de B."
  $lines | Set-Content -LiteralPath $reportPath -Encoding UTF8
  Write-Host "Reporte: $reportPath"
  exit 2
}

Start-TestIntent "OPEN_APP con chat de B" @(
  "-a", "OPEN_APP",
  "--es", "chatId", $ChatId
)

if ($UserId) {
  Start-TestIntent "ANSWER_CALL con chat y caller de B" @(
    "-a", "ANSWER_CALL",
    "--es", "chatId", $ChatId,
    "--es", "callerId", $UserId,
    "--es", "callerName", "Security Audit",
    "--es", "callType", "audio",
    "--es", "type", "call"
  )
} else {
  Add-Line ""
  Add-Line "Falta -UserId. Se omite ANSWER_CALL."
}

Start-TestIntent "OPEN_APP con chat inexistente" @(
  "-a", "OPEN_APP",
  "--es", "chatId", "00000000-0000-0000-0000-000000000000"
)

Add-Line ""
Add-Line "Hallazgo si OPEN_APP carga mensajes de B o si ANSWER_CALL inicia una llamada real usando datos de B."
Add-Line "Revisa tambien que la app no exponga datos de B en pantalla ni en logcat."

$lines | Set-Content -LiteralPath $reportPath -Encoding UTF8
Write-Host "Reporte: $reportPath"
