param([Parameter(Mandatory=$true)][ValidateSet('A','B','C')][string]$Role)
$ErrorActionPreference='Stop'
$repoRoot=Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $repoRoot
$promptPath=Join-Path $repoRoot "docs/hosted-agents/GEMINI-$Role.txt"
$logDirectory=Join-Path $repoRoot 'output/private/hosted-agents'
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$sessionId=[guid]::NewGuid().ToString()
$metaPath=Join-Path $logDirectory "gemini-$Role-process.json"
$meta=@{role=$Role;pid=$PID;sessionId=$sessionId;state='running';startedAt=(Get-Date).ToUniversalTime().ToString('o')}
$meta | ConvertTo-Json | Set-Content -LiteralPath $metaPath
$geminiPath=(Get-Command gemini.cmd -ErrorAction Stop).Source
$arguments=@('--prompt',"Execute the assigned task from docs/hosted-agents/GEMINI-$Role.txt. The full task is also on stdin. Read the shared contract first, implement only owned files, and update your own status.",'--session-id',$sessionId,'--approval-mode','auto_edit','--allowed-tools','run_shell_command','--allowed-mcp-server-names','__hosted_agents_no_mcp__','--skip-trust','--output-format','stream-json')
try {
  Get-Content -LiteralPath $promptPath -Raw | & $geminiPath @arguments 2>&1 | Out-File -LiteralPath (Join-Path $logDirectory "gemini-$Role.jsonl") -Encoding utf8
  $meta.exitCode=$LASTEXITCODE
  $meta.state=if($LASTEXITCODE -eq 0){'finished'}else{'failed'}
}catch{$meta.state='failed';$meta.error=$_.Exception.Message}
$meta.finishedAt=(Get-Date).ToUniversalTime().ToString('o')
$meta | ConvertTo-Json | Set-Content -LiteralPath $metaPath
