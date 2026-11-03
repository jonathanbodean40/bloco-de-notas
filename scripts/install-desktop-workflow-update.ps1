param([Parameter(Mandatory=$true)][string]$PreparationJson)
# Install only a tested ASAR workflow hotfix. No user profile, notes, auth or clinical files.
$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
$runtime=[IO.Path]::GetFullPath((Join-Path $repo '.runtime'))+[IO.Path]::DirectorySeparatorChar
$preparationPath=[IO.Path]::GetFullPath($PreparationJson)
if(!$preparationPath.StartsWith($runtime,[StringComparison]::OrdinalIgnoreCase)){throw 'Preparation must be in this worktree runtime directory.'}
$m=Get-Content -LiteralPath $preparationPath -Raw | ConvertFrom-Json
$testPath=Join-Path (Split-Path $preparationPath -Parent) 'packaged-test.json'
$t=Get-Content -LiteralPath $testPath -Raw | ConvertFrom-Json
$target=Join-Path $env:LOCALAPPDATA 'Programs\Bloco de Notas Pro\resources\app.asar'
if([IO.Path]::GetFullPath([string]$m.installedArchive) -ne [IO.Path]::GetFullPath($target)){throw 'Unexpected installation target.'}
$candidate=[IO.Path]::GetFullPath([string]$m.candidateArchive)
if(!$candidate.StartsWith($runtime,[StringComparison]::OrdinalIgnoreCase)){throw 'Candidate outside prepared runtime.'}
if($m.unrelatedResourcesPreserved -ne $true -or $t.passed -ne $true -or $t.productionProfileUsed -ne $false -or $t.originalInstalledArchiveUnchanged -ne $true){throw 'Successful isolated acceptance required.'}
if($t.candidateSha256 -ne $m.candidateSha256){throw 'Test does not correspond to this candidate.'}
$requiredChecks=@('real_asar_starts_with_isolated_profile','missing_ticket_is_not_found','packaged_ipc_writes_isolated_queue_and_reads_heartbeat','stale_worker_warning','packaged_ipc_python_executor_result_no_clinical_generator')
foreach($check in $requiredChecks){if($check -notin $t.checks){throw 'Incomplete packaged acceptance.'}}
$allowed=@('desktop/main.cjs','desktop/preload.cjs','desktop/keep-job-status.cjs','www/keep-aligner-tool.js')
foreach($file in $m.changedFiles){if($file -notin $allowed){throw 'Unexpected changed resource.'}}
if(Get-Process -Name 'Bloco de Notas Pro' -ErrorAction SilentlyContinue){throw 'Application is running. Close it normally; do not terminate unsaved work.'}
$agent=Join-Path $env:LOCALAPPDATA 'KeepAligner\LocalAgent'
if(@(Get-ChildItem -LiteralPath (Join-Path $agent 'inbox') -File -Filter '*.json' -ErrorAction SilentlyContinue).Count){throw 'Pending workflow jobs: update stopped.'}
foreach($file in @($target,$candidate)){
 $item=Get-Item -LiteralPath $file
 if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Redirected archive not supported.'}
}
$hash={param($p)(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
if((& $hash $target) -ne $m.originalSha256 -or (& $hash $candidate) -ne $m.candidateSha256){throw 'Installation or candidate changed after acceptance.'}
$executable=Join-Path (Split-Path (Split-Path $target -Parent) -Parent) 'Bloco de Notas Pro.exe'
if($m.nativeAsarIntegrityDisabled -ne $true -or $m.nativeFusesModified -ne $false -or (& $hash $executable) -ne $m.executableSha256){throw 'Native executable differs or requires a full rebuild; no integrity setting will be changed.'}
$backup=Join-Path $env:LOCALAPPDATA ('KeepAligner\DesktopBackups\'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $backup | Out-Null
$previous=Join-Path $backup 'app.asar'
[IO.File]::Copy($target,$previous,$false)
if((& $hash $previous) -ne $m.originalSha256){throw 'Backup verification failed.'}
Copy-Item -LiteralPath $preparationPath -Destination (Join-Path $backup 'preparation.json')
Copy-Item -LiteralPath $testPath -Destination (Join-Path $backup 'packaged-test.json')
$staging=$target+'.keep-new-'+[guid]::NewGuid().ToString('N')
[IO.File]::Copy($candidate,$staging,$false)
if((& $hash $staging) -ne $m.candidateSha256){throw 'Staged archive verification failed.'}
# Re-check immediately before the atomic switch. Do not stop user processes.
if(Get-Process -Name 'Bloco de Notas Pro' -ErrorAction SilentlyContinue){throw 'Application started during preparation; no replacement performed.'}
if((& $hash $target) -ne $m.originalSha256){throw 'Installed archive changed before replacement.'}
[IO.File]::Replace($staging,$target,(Join-Path $backup 'app.before-switch.asar'))
if((& $hash $target) -ne $m.candidateSha256){
 $rollback=$target+'.rollback-'+[guid]::NewGuid().ToString('N')
 [IO.File]::Copy($previous,$rollback,$false)
 [IO.File]::Replace($rollback,$target,(Join-Path $backup 'app.failed-candidate.asar'))
 throw 'Installed verification failed; previous archive restored.'
}
$receipt=[ordered]@{installedAt=[DateTimeOffset]::UtcNow.ToString('o');baseVersion=$m.installedVersion;workflowRevision=$m.revision;installedSha256=(& $hash $target);backup=$backup;backupSha256=(& $hash $previous);changedFiles=$m.changedFiles;installed=$true;userProfileAccessed=$false;notesChanged=$false;authenticationChanged=$false;clinicalCollectionEnabled=$false;clinicalApproval=$false;publishingAuthorized=$false}
$json=$receipt | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText((Join-Path $backup 'installation-receipt.json'),$json,[Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path (Split-Path $target -Parent) 'keep-workflow-update.json'),$json,[Text.UTF8Encoding]::new($false))
Write-Output $json
