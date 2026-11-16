param(
  [string]$SourceEnv = ".env",
  [string]$Target = "staging",
  [switch]$EnableWrites,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

function Read-EnvValue {
  param([string]$File, [string]$Key)
  if (-not (Test-Path -LiteralPath $File)) { return "" }
  $content = Get-Content -LiteralPath $File -Raw
  foreach ($line in ($content -split "`r?`n")) {
    if ($line -match "^\s*$([regex]::Escape($Key))\s*=\s*(.*)\s*$") {
      $value = $matches[1].Trim()
      if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      return $value
    }
  }
  return ""
}

$url = Read-EnvValue $SourceEnv "VITE_SUPABASE_URL"
$anonKey = Read-EnvValue $SourceEnv "VITE_SUPABASE_ANON_KEY"
$productionUrl = Read-EnvValue ".env.production" "VITE_SUPABASE_URL"

if (-not $url -or -not $anonKey) {
  throw "No se encontraron VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en $SourceEnv"
}

Write-Host "URL Supabase: $url"
if ($productionUrl -and $url -eq $productionUrl) {
  Write-Warning "La URL coincide con .env.production."
  if ($EnableWrites) {
    throw "No se habilitan escrituras contra la URL de produccion."
  }
}

$emailA = Read-Host "Email del usuario A"
$passA = Read-Host "Password del usuario A"
$emailB = Read-Host "Email del usuario B"
$passB = Read-Host "Password del usuario B"
$phoneB = Read-Host "Telefono de B en staging (opcional)"
$chatB = Read-Host "Chat ID de B (opcional)"
$storageB = Read-Host "Ruta de un archivo privado de B en chat-media (opcional)"

if ($EnableWrites -and $Target -ne "staging") {
  throw "Para habilitar escrituras usa -Target staging."
}

$allowWrites = if ($EnableWrites) { "1" } else { "0" }
$understand = if ($EnableWrites) { "yes" } else { "no" }

$outputPath = Join-Path $PSScriptRoot "security.env"
if ((Test-Path -LiteralPath $outputPath) -and -not $Force) {
  throw "Ya existe security.env. Usa -Force para sobrescribirlo."
}

$content = @(
  "SECURITY_TARGET=$Target",
  "SECURITY_SUPABASE_URL=$url",
  "SECURITY_SUPABASE_ANON_KEY=$anonKey",
  "SECURITY_A_EMAIL=$emailA",
  "SECURITY_A_PASSWORD=$passA",
  "SECURITY_B_EMAIL=$emailB",
  "SECURITY_B_PASSWORD=$passB",
  "SECURITY_B_PHONE=$phoneB",
  "SECURITY_B_CHAT_ID=$chatB",
  "SECURITY_B_STORAGE_PATH=$storageB",
  "SECURITY_ALLOW_WRITES=$allowWrites",
  "SECURITY_I_UNDERSTAND=$understand"
) -join "`r`n"

Set-Content -LiteralPath $outputPath -Value $content -Encoding UTF8
Write-Host "Creado: $outputPath"
Write-Host "Modo escritura: $allowWrites"
