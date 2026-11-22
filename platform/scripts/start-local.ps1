$ErrorActionPreference = 'Stop'
$workspacePath = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $workspacePath
if (-not (Test-Path -LiteralPath '.env')) {
  throw 'Configurează fișierul .env conform server/.env.example înainte de pornire.'
}
& npm run build
if ($LASTEXITCODE -ne 0) { throw 'Compilarea a eșuat. Serverul nu a fost pornit.' }
$env:SERVE_WEB = 'true'
& npm start
exit $LASTEXITCODE
