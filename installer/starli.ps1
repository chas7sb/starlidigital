param(
  [Parameter(Position=0)][string]$Command = 'help',
  [switch]$DryRun,
  [switch]$Native,
  [switch]$Docker
)
$ErrorActionPreference = 'Stop'
$launcherArgs = @((Join-Path $PSScriptRoot 'starli.mjs'), $Command)
if ($DryRun) { $launcherArgs += '--dry-run' }
if ($Native) { $launcherArgs += '--native' }
if ($Docker) { $launcherArgs += '--docker' }
& node @launcherArgs
exit $LASTEXITCODE
