<#
.SYNOPSIS
    Instalare sarcină programată Windows (Scheduled Task) pentru conectorul discret Starli Device.
.DESCRIPTION
    Configurează executabilul `starli-device` ca serviciu utilizator în fundal (fără drepturi de administrator de sistem),
    cu repornire automată la autentificarea utilizatorului și conexiune WSS securizată către backendul Starlidigital.
#>

[CmdletBinding()]
param(
    [string]$TaskName = "StarliDeviceConnector",
    [string]$ApiUrl = "https://api.starlidigital.ro"
)

Write-Host "=== Configurare Sarcină Programată Starli Device pe Windows ===" -ForegroundColor Cyan

$nodePath = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $nodePath) {
    Write-Error "Node.js 24+ nu a fost găsit în PATH. Asigură-te că Node.js este instalat."
    exit 1
}

$repoDir = Split-Path -Parent $PSScriptRoot
$deviceScript = Join-Path $repoDir "device\bin\starli-device.mjs"

if (-not (Test-Path $deviceScript)) {
    Write-Error "Scriptul de intrare starli-device nu a fost găsit la: $deviceScript"
    exit 1
}

$action = New-ScheduledTaskAction -Execute $nodePath -Argument "`"$deviceScript`" connect" -WorkingDirectory $repoDir
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 365) -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "Conector WSS Starli Device pentru administrarea platformei Starlidigital" -Force

Write-Host "Sarcina programată '$TaskName' a fost configurată cu succes." -ForegroundColor Green
Write-Host "Pentru a porni acum conectorul în fundal, rulează:" -ForegroundColor Yellow
Write-Host "Start-ScheduledTask -TaskName '$TaskName'" -ForegroundColor White
