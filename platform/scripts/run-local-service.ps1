$ErrorActionPreference = 'Stop'
$workspacePath = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $workspacePath
$logDirectory = Join-Path $workspacePath 'logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$logPath = Join-Path $logDirectory 'api.log'
if ((Test-Path -LiteralPath $logPath) -and (Get-Item -LiteralPath $logPath).Length -gt 10485760) {
    Move-Item -LiteralPath $logPath -Destination (Join-Path $logDirectory ('api-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log'))
}
foreach ($variableName in @('OPENAI_API_KEY')) {
    $configuredValue = [Environment]::GetEnvironmentVariable($variableName, 'User')
    if ($configuredValue) { [Environment]::SetEnvironmentVariable($variableName, $configuredValue, 'Process') }
}
$env:SERVE_WEB = 'true'
$nodePath = (Get-Command node -ErrorAction Stop).Source
& $nodePath --import tsx server/src/index.ts *>> $logPath
exit $LASTEXITCODE
