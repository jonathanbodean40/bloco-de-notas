# KEEP ALIGNER — installed desktop workflow update, 2026-11-03

## Delivery actually completed

Remote Desktop Commander reported the MSI online and successfully executed the commands in this session. Keep Remote was not used as a fallback.

The clean development worktree was fast-forwarded from a3f35ae to 9657686. The already-installed Python worker matched all four tested source modules, had an active scheduled task and an empty queue.

At 17:14:15 UTC the installed Windows application's ASAR was atomically updated with the workflow code from 9657686. This is a **local workflow hotfix to base application version 0.1.3**, not a new full installer release. The native executable and its security fuses were not changed.

Only these three resources changed:

- `desktop/main.cjs`
- `desktop/keep-job-status.cjs`
- `www/keep-aligner-tool.js`

Of the 171 files in the updated package, the other 168 were compared byte-for-byte with the previous installed package and remained identical. This includes the notes editor, authentication, configuration, sync and export code. The update scripts do not read or modify the real notes profile, authentication store or clinical files.

Installed ASAR SHA-256: `13a93d005d4116ca2596c9400b0e933b482a5818858ffd54bc0df7c317e476d7`.
Previous ASAR SHA-256: `ebd980e421571380bcc2978e1e5c63f89cc11adaa5121aba5d8240a34a17aa89`.

The previous package and installation/test receipts are preserved under `%LOCALAPPDATA%\KeepAligner\DesktopBackups\20261103-171415-650769c3`. A second pre-switch copy is also retained. No backups were removed.

## Observed tests on the MSI

- Python: 80 executed; 79 passed, one symlink test skipped because of Windows account permissions.
- Status reader and IPC tests: 27 executed; 26 passed, one symlink test skipped for the same reason.
- Node progress, isolated queue and application independence: passed.
- Real Electron GUI test of progress and manual status recheck: passed using a disposable offline fixture/profile.
- Prepared actual ASAR: started successfully with development Electron 38.8.6, a disposable profile and blocked networking. Five checks passed: startup, `not_found`, isolated queue/heartbeat, stale heartbeat warning, Python worker result. The production profile and installed archive remained untouched during this pre-install test.
- Atomic file replacement: verified with synthetic sentinel files before installation. An initial PowerShell call with a null backup argument had failed before replacement; the original package hash was verified unchanged, and the corrected call uses an explicit retained backup filename.
- **Installed-code/live-worker probe:** the actual installed ASAR was launched with development Electron and a disposable notes profile, without registering OAuth protocols or enabling network access. It submitted one explicitly synthetic missing-case request to the real installed worker. The observed transition was `queued` to `awaiting_case_data`; no generator was invoked and no clinical document was created. Clinical approval and publication flags remained false.
- Post-install package comparison: exactly three changed resources; 168 unchanged resources.
- At 17:16:58 UTC: worker process active, heartbeat age two seconds, queue empty, scheduled task Running, installed worker modules matching tested source.

These tests do not claim a login through the user's real notes profile, a Windows reboot, or a clinical end-to-end run.

## Reproducible tools

`scripts/prepare-desktop-workflow-update.cjs` builds a candidate package in `.runtime`, refuses independent changes to the notes/auth code, checks native integrity compatibility without modifying fuses, and verifies every unchanged resource.

`tests/keep-packaged-update-smoke.cjs` tests the prepared actual package with an isolated profile and isolated queue.

`scripts/install-desktop-workflow-update.ps1` requires matching successful test evidence, original/candidate/executable hashes, an idle app and empty queue. It preserves verified backups and performs an atomic replacement. No forced shutdown of the user's app is performed.

`scripts/verify-installed-workflow.cjs --synthetic-probe` is opt-in and targets only a randomly named synthetic case that does not exist. It tests the installed code with the existing worker and retains the result for audit. It must not be reinterpreted as a clinical test.

The JavaScript tools use the existing development dependencies `@electron/asar`, `@electron/fuses` and Playwright. `KEEP_ELECTRON_TEST_EXE` must explicitly identify the development Electron binary. Local test/deployment receipts stay in ignored `.runtime` or local backup directories, not the public repository.

## Still outside this completed increment

The Browser connector again reported that the originating browser context was unavailable. No My Keep/Hirsch navigation or online capture was performed in this session. No direct connector for those providers was returned by discovery.

Authenticated source collection, complete case-to-source binding, anatomical 3D capture acceptance and clinical validation remain incomplete. The previously blocked binding implementation was not retried through this alternative PC connector. The existing synthetic-only generation gate was not removed or bypassed.

The owner's authorization for read-only real-case tests remains valid; authorization is not the outstanding technical issue. No changes, messages, uploads, publication or treatment decisions were made in My Keep/Hirsch; no Supabase change or patient archive operation was performed.

This increment closes the gap between the tested desktop status code and the installed app. It does **not** certify the full clinical workflow as complete.
