param(
  [Parameter(Position=0)][string]$Command = 'help',
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$launcherArgs = @((Join-Path $PSScriptRoot 'starli.mjs'), $Command)
if ($DryRun) { $launcherArgs += '--dry-run' }
& node @launcherArgs
exit $LASTEXITCODE
