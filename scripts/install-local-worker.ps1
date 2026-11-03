param([switch]$Start)
# Install only the tested local worker. No notes, authentication or remote platform access.
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$root = Join-Path $env:LOCALAPPDATA 'KeepAligner\LocalAgent'
$python = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$pythonw = Join-Path (Split-Path $python -Parent) 'pythonw.exe'
$name = 'KEEP ALIGNER Local Executor'
if (!(Test-Path -LiteralPath $pythonw)) { throw 'Python interpreter not available.' }
& $python -B -c 'import PIL, lxml'
if ($LASTEXITCODE -ne 0) { throw 'Missing worker dependencies.' }
if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) { throw 'Task already exists: inspect before changing it.' }
$active = Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^pythonw?\.exe$' -and $_.CommandLine -like '*KeepAligner*LocalAgent*agent.py*' }
if ($active) { throw 'Worker already active: do not replace code while running.' }
if (@(Get-ChildItem -LiteralPath (Join-Path $root 'inbox') -Filter '*.json' -File -ErrorAction SilentlyContinue).Count) { throw 'Queue is not empty: deployment stopped.' }
$files = @('agent.py','source_preflight.py','output_validation.py','mock_provider_adapter.py')
foreach ($file in $files) { if (!(Test-Path -LiteralPath (Join-Path $repo "executor\$file"))) { throw 'Incomplete worker distribution.' } }
$backup = Join-Path $root ('backups\' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $backup -Force | Out-Null
$records = @()
foreach ($file in $files) {
  $source = Join-Path $repo "executor\$file"
  $dest = Join-Path $root $file
  if (Test-Path -LiteralPath $dest) { Copy-Item -LiteralPath $dest -Destination (Join-Path $backup $file) }
  Copy-Item -LiteralPath $source -Destination $dest
  $hash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
  if ($hash -ne (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash) { throw 'Installed file differs from tested code.' }
  $records += [pscustomobject]@{name=$file;sha256=$hash}
}
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $pythonw -Argument ('"' + (Join-Path $root 'agent.py') + '" serve --interval 8') -WorkingDirectory $root
$logon = New-ScheduledTaskTrigger -AtLogOn -User $user
$periodic = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $name -Action $action -Trigger @($logon,$periodic) -Principal $principal -Settings $settings -Description 'Local KEEP ALIGNER executor. User-session only, no credentials stored, no publication. Restarts after exit; existing worker singleton prevents duplicates.' | Out-Null
$receipt = [ordered]@{installedAt=[DateTimeOffset]::UtcNow.ToString('o');backup=$backup;task=$name;files=$records;notesChanged=$false;authenticationChanged=$false;publishingEnabled=$false}
$receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $backup 'installation-receipt.json') -Encoding UTF8
if ($Start) { Start-ScheduledTask -TaskName $name }
$receipt | ConvertTo-Json -Depth 5
