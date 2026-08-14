$ErrorActionPreference = "Stop"
$device = "AMFIDIKNNR8HDQ69"
$out = Join-Path $env:TEMP "depana_live_log.txt"
Remove-Item $out -ErrorAction SilentlyContinue

Write-Host "Limpiando logcat..."
adb -s $device logcat -c

Write-Host "Capturando en vivo -> $out"
Write-Host "Reproduce el bug y luego presiona Ctrl+C (empezaremos cuando veas mensajes)."
adb -s $device logcat -v threadtime | Select-String -Pattern "Capacitor/Console" | Out-File -FilePath $out -Encoding utf8