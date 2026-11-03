# KEEP ALIGNER — truthful local request status

## Scope

This change fixes a concrete status error: the desktop IPC previously returned
`queued` whenever a result file was absent, without checking whether the ticket
existed in the inbox. It now distinguishes a queued job from `not_found`.

The lookup is read-only. It never reads clinical case files or the content of
queued requests, writes a file, restarts the worker, re-enqueues a ticket, opens
a browser, publishes, or changes a clinical approval. The UI continues to use
the same `keepJobStatus(id)` interface and displays the returned message.

## Checks

- Validate ticket format and matching identity in the result.
- Bound JSON reads; reject malformed/oversized/redirected status files.
- Check queue existence without parsing the queued request.
- Re-read the result after checking the inbox to cover the worker transition.
- Warn when a queued ticket has no recent valid heartbeat (60 seconds).
- Preserve active result states; a stale heartbeat alone does NOT prove that
  a long-running generator has stopped. A recent heartbeat does NOT prove a
  treatment succeeded or establish clinical approval.
- Return only state, bounded message, bounded progress/artifact count and false
  clinical/publication approval flags. Do not expose request data, file paths
  or generator logs to the renderer.

## Test evidence and delivery boundary

27 synthetic tests passed in an isolated Linux/Node 22 environment, including
execution of the actual main-process IPC handler with an Electron test double.
This is not a real Electron GUI, MSI installation or clinical end-to-end test.

Command: `node --test tests/keep-job-status.test.cjs tests/keep-status-ipc.test.cjs`.
The Windows preflight CI also runs this command. Windows/Android build jobs now
require a successful preflight. The existing native Electron smoke harness
copies the new helper along with main/preload; rerun it on the MSI before rollout.

Remote Desktop Commander reported the selected MSI device offline and refused
the connection probe. No PC files, scheduled tasks, notes, authentication,
clinical data, My Keep or Hirsch Dynamics were changed during this increment.
Keep Remote was not used as a fallback after the owner requested the switch.
This code has not been installed on the MSI; online collection, clinical source
binding and real-capture acceptance remain outside this change.
