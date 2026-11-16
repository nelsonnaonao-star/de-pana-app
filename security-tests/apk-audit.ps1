param(
  [string]$ApkPath = "C:\Users\Nelson\Desktop\WEPA-1.15-test.apk",
  [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $ApkPath)) {
  throw "No existe el APK: $ApkPath"
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
if (-not $OutDir) {
  $OutDir = Join-Path $PSScriptRoot "reports"
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$reportPath = Join-Path $OutDir "apk-audit-$stamp.txt"
$lines = New-Object System.Collections.Generic.List[string]
$findings = New-Object System.Collections.Generic.List[string]

function Add-Line {
  param([string]$Text)
  $lines.Add($Text)
  Write-Host $Text
}

function Add-Finding {
  param([string]$Severity, [string]$Text)
  $findings.Add("[$Severity] $Text")
  Add-Line "[$Severity] $Text"
}

$apkanalyzer = (Get-Command apkanalyzer -ErrorAction SilentlyContinue).Source
if (-not $apkanalyzer) {
  $candidate = Get-ChildItem "C:\Android\cmdline-tools" -Recurse -Filter apkanalyzer.bat -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
  if ($candidate) { $apkanalyzer = $candidate.FullName }
}
if (-not $apkanalyzer) {
  throw "apkanalyzer no encontrado. Instala Android SDK cmdline-tools."
}

$apksigner = (Get-Command apksigner -ErrorAction SilentlyContinue).Source
if (-not $apksigner) {
  $candidate = Get-ChildItem "C:\Android\build-tools" -Recurse -Filter apksigner.bat -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
  if ($candidate) { $apksigner = $candidate.FullName }
}

$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $ApkPath
Add-Line "APK: $ApkPath"
Add-Line "SHA256: $($hash.Hash)"
Add-Line "Tamano: $((Get-Item -LiteralPath $ApkPath).Length) bytes"

$summary = & $apkanalyzer apk summary $ApkPath 2>&1
Add-Line ""
Add-Line "=== Resumen ==="
Add-Line ($summary | Out-String)

$appId = & $apkanalyzer manifest application-id $ApkPath 2>&1
$versionName = & $apkanalyzer manifest version-name $ApkPath 2>&1
$versionCode = & $apkanalyzer manifest version-code $ApkPath 2>&1
$minSdk = & $apkanalyzer manifest min-sdk $ApkPath 2>&1
$targetSdk = & $apkanalyzer manifest target-sdk $ApkPath 2>&1
$debuggable = & $apkanalyzer manifest debuggable $ApkPath 2>&1
$permissions = & $apkanalyzer manifest permissions $ApkPath 2>&1
$manifest = & $apkanalyzer manifest print $ApkPath 2>&1

Add-Line "App ID: $appId"
Add-Line "Version: $versionName ($versionCode)"
Add-Line "Min SDK: $minSdk"
Add-Line "Target SDK: $targetSdk"
Add-Line "Debuggable: $debuggable"

Add-Line ""
Add-Line "=== Permisos ==="
Add-Line ($permissions | Out-String)

$permissionText = $permissions | Out-String
$dangerous = @(
  "READ_CONTACTS",
  "WRITE_CONTACTS",
  "CAMERA",
  "RECORD_AUDIO",
  "ACCESS_FINE_LOCATION",
  "ACCESS_COARSE_LOCATION",
  "READ_MEDIA_IMAGES",
  "READ_MEDIA_VIDEO",
  "READ_EXTERNAL_STORAGE",
  "WRITE_EXTERNAL_STORAGE",
  "REQUEST_INSTALL_PACKAGES",
  "POST_NOTIFICATIONS",
  "USE_FULL_SCREEN_INTENT",
  "RECEIVE_BOOT_COMPLETED",
  "SCHEDULE_EXACT_ALARM"
)

foreach ($permission in $dangerous) {
  if ($permissionText -match [regex]::Escape($permission)) {
    Add-Line "Permiso presente: $permission"
  }
}

if ($permissionText -match "REQUEST_INSTALL_PACKAGES") {
  Add-Finding "HIGH" "La app puede pedir instalacion de APK; validar firma/hash del update."
}

Add-Line ""
Add-Line "=== Componentes exportados ==="
$manifestText = $manifest | Out-String
try {
  $xml = [xml]$manifestText
  $androidNs = "http://schemas.android.com/apk/res/android"
  $tags = @("activity", "activity-alias", "service", "receiver", "provider")
  foreach ($tag in $tags) {
    $nodes = $xml.SelectNodes("//*[local-name()='$tag']")
    foreach ($node in $nodes) {
      $exported = $node.GetAttribute("exported", $androidNs)
      if ($exported -eq "true") {
        $name = $node.GetAttribute("name", $androidNs)
        Add-Line "exported=true: $tag $name"
        if ($tag -eq "activity" -and $name -eq "${appId}.MainActivity") {
          Add-Finding "INFO" "MainActivity es exportada y acepta intents externos."
        } else {
          Add-Finding "MEDIUM" "Componente exportado: $tag $name"
        }
      }
    }
  }

  $application = $xml.SelectSingleNode("//*[local-name()='application']")
  if ($application) {
    $allowBackup = $application.GetAttribute("allowBackup", $androidNs)
    $cleartext = $application.GetAttribute("usesCleartextTraffic", $androidNs)
    $networkConfig = $application.GetAttribute("networkSecurityConfig", $androidNs)
    Add-Line "allowBackup: $allowBackup"
    Add-Line "usesCleartextTraffic: $cleartext"
    Add-Line "networkSecurityConfig: $networkConfig"

    if ($allowBackup -eq "true") {
      Add-Finding "HIGH" "allowBackup=true puede exponer datos locales."
    }
    if ($cleartext -eq "true") {
      Add-Finding "HIGH" "usesCleartextTraffic=true permite HTTP sin cifrar."
    }
  }
} catch {
  Add-Line "No se pudo parsear el manifest: $($_.Exception.Message)"
  Add-Finding "MEDIUM" "Revisar manifest manualmente; fallo el parseo."
}

if ($debuggable -match "true") {
  Add-Finding "CRITICAL" "El APK es debuggable."
}

if ($manifestText -match "ANSWER_CALL") {
  Add-Line "Accion presente: ANSWER_CALL"
}
if ($manifestText -match "OPEN_APP") {
  Add-Line "Accion presente: OPEN_APP"
}

Add-Line ""
Add-Line "=== Firma ==="
if ($apksigner) {
  $signature = & $apksigner verify --print-certs $ApkPath 2>&1
  Add-Line ($signature | Out-String)
} else {
  Add-Line "apksigner no encontrado; no se pudo verificar la firma."
}

Add-Line ""
Add-Line "=== Busqueda de secretos ==="
$temp = Join-Path $env:TEMP ("wepa-apk-audit-" + [guid]::NewGuid().ToString("N"))
$zip = Join-Path $temp "app.zip"
$unpacked = Join-Path $temp "unpacked"
$scanFindings = New-Object System.Collections.Generic.List[string]

try {
  New-Item -ItemType Directory -Force -Path $temp | Out-Null
  Copy-Item -LiteralPath $ApkPath -Destination $zip
  Expand-Archive -LiteralPath $zip -DestinationPath $unpacked -Force

  $extensions = @(".js", ".json", ".html", ".xml", ".properties", ".txt", ".map", ".yaml", ".yml")
  $files = Get-ChildItem -LiteralPath $unpacked -Recurse -File | Where-Object {
    $_.Length -lt 5000000 -and $extensions -contains $_.Extension.ToLower()
  }

  $patterns = @(
    @{ Name = "service_role"; Regex = "service_role" },
    @{ Name = "SUPABASE_SERVICE"; Regex = "SUPABASE_SERVICE" },
    @{ Name = "private_key"; Regex = "BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY" },
    @{ Name = "keystore_password"; Regex = "storePassword|keyPassword" },
    @{ Name = "google_api_key"; Regex = "AIza[0-9A-Za-z\-_]{35}" }
  )

  foreach ($file in $files) {
    $content = Get-Content -LiteralPath $file.FullName -Raw -ErrorAction SilentlyContinue
    if (-not $content) { continue }
    foreach ($pattern in $patterns) {
      if ($content -match $pattern.Regex) {
        $relative = $file.FullName.Replace($unpacked, "")
        $scanFindings.Add("$($pattern.Name): $relative")
        Add-Line "$($pattern.Name): $relative"
      }
    }
  }

  if ($scanFindings.Count -eq 0) {
    Add-Line "No se encontraron patrones de secretos en archivos de texto."
  }
} finally {
  if (Test-Path -LiteralPath $temp) {
    Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

foreach ($item in $scanFindings) {
  if ($item -match "service_role|SUPABASE_SERVICE|private_key|keystore_password") {
    Add-Finding "CRITICAL" "Posible secreto en APK: $item"
  } elseif ($item -match "google_api_key") {
    Add-Finding "MEDIUM" "Google API key en APK; validar restricciones: $item"
  }
}

Add-Line ""
Add-Line "=== Hallazgos ==="
if ($findings.Count -eq 0) {
  Add-Line "Sin hallazgos automaticos."
} else {
  foreach ($finding in $findings) {
    Add-Line $finding
  }
}

$lines | Set-Content -LiteralPath $reportPath -Encoding UTF8
Write-Host "Reporte: $reportPath"
if ($findings | Where-Object { $_ -match "CRITICAL" }) {
  exit 1
}
