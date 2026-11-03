# KEEP ALIGNER — report layout and verified previews (2026-11-03)

## Scope and authorization

Owner-authorized implementation and local testing through Remote Desktop Commander. My Keep and Hirsch Dynamics are read-only in scope; this increment performs no platform actions. No patient identifiers, templates, screenshots or clinical sources are included in this public repository.

## Automatic report fitting

`generator_support/ka_report_layout.py` adjusts only explicit 14 pt body properties to 12 pt in the single report box on slide 2 of a newly generated copy. It preserves headings, empty paragraphs, clinical text, geometry and every other ZIP member. Existing destinations, redirected inputs and unsupported structures are refused.

The generator measures the initial draft using the real PowerPoint renderer. Only a measured overflow limited to slide 2 / shape 2 can trigger fitting. Any other overflow remains an error. The final draft must pass the existing independent guide validation and a fresh native render with zero overflow. Text still too long at 12 pt is blocked; it is not truncated, rewritten or shrunk further.

The raw draft, measurements and layout receipt are retained inside the generator job. Layout is part of a hashed, resumable stage. Repeating an unchanged request reuses completed stages rather than generating a new document.

Tools:
- `scripts/prepare-generator-layout-update.py`: creates a candidate from the exact reviewed generator source; keeps templates read-only.
- `scripts/test-generator-layout-native.py`: requires an explicit owner-authorized local case, copies sources privately and tests regression, native fitting, resume and excessive-text rejection.
- `scripts/install-generator-layout-update.py`: requires matching acceptance evidence and hashes, an idle generator and empty queue; preserves a verified rollback.

The tested generator code was installed on the MSI at 19:06 UTC. Only `keep_aligner.py` and the new `ka_report_layout.py` changed. Templates, original patient guides, source files, notes and authentication were not modified. The previous code is retained in the local GeneratorBackups directory.

## Verified preview in the application

`desktop/keep-job-preview.cjs` projects only the expected PNG images for one completed technical result. The renderer supplies only a ticket ID, never a file path. The helper checks the result identity, expected case/version job directory, receipt state, exact output list, sizes and SHA-256, PNG signature/dimensions, containment and redirected-file restrictions.

No generated HTML or scripts are executed. Images are returned as PNG data URLs with no filesystem paths, raw logs, credentials or case JSON. `clinicalApproval` and `publishingAuthorized` remain false. The feature is not clinical source validation and does not establish provider authenticity.

The interface shows **Ver prévias verificadas** only for a prepared technical package. Closing the preview or locking/changing the form clears its images. A changed image is refused. The preview does not publish, archive, approve or modify a treatment.

## Tests observed before desktop deployment

- Workflow Python suite: 97 tests, 95 passed and 2 Windows symlink-permission skips.
- Status/IPC/preview Node suite: 55 tests, 53 passed and 2 symlink-permission skips.
- Native generator regression: all 66 tests passed.
- Owner-authorized local guide: 193 independent checks passed; automatic 12 pt body; 36 font properties changed; native rendering with zero overflow; original sources/templates/guide unchanged.
- Repeated local generation: completed stages reused.
- Deliberately excessive synthetic report: remained blocked after fitting.
- Synthetic native pipeline with the candidate generator: guide, presentation and repeat all passed.
- Electron GUI: previews opened, modified PNG rejected, images removed when session locked.
- Browser fixture regression: 20 checks passed, including offline cache and synthetic note preservation.
- Independence check passed. Test notes profiles are disposable; the owner's notes/authentication profile is not used.

Private test evidence is retained under `Documents/KeepAligner_LocalTests/report-layout-q95df35q` on the MSI. It must not be uploaded to this public repository.

## Installed generation acceptance tools

`stage-installed-synthetic-acceptance.py --confirm-synthetic` creates a unique, entirely fictitious case and stages it without enqueueing or overwriting anything. `verify-installed-generation.cjs --synthetic-generation <staging-receipt>` sends that test through the installed application IPC and existing worker, verifies actual generation, and reads back all four preview images. It uses an isolated notes profile and blocked networking, not the owner's login. An interrupted dispatch must be inspected, never blindly retried.

## Boundaries still open

Authenticated My Keep/Hirsch collection and anatomical capture acceptance are not completed. Browser reported that this conversation lacked its originating browser context. The previously blocked case/source-binding implementation is not retried through another connector, and the synthetic-only production gate is unchanged. A real local layout test is not an online case/version acceptance and is not clinical approval.

Desktop preview deployment and installed full-generation acceptance will be recorded below only after they are actually verified.

## Desktop deployment and installed full-generation acceptance — verified

At **2026-11-03 19:20:04 UTC**, the tested preview update from commit `7a179de38a4589de5869d2bd5a8db54f7da75548` was installed as a local hotfix to application base version 0.1.3. The actual ASAR candidate passed its five isolated package checks before the switch. The native executable and security fuses were not changed.

Installed ASAR SHA-256: `5ff5c65e1d3fe458c8f344ffe4af63e2ab73b1554cde4877a3b8bfe6ac2f1151`.
Previous ASAR SHA-256: `13a93d005d4116ca2596c9400b0e933b482a5818858ffd54bc0df7c317e476d7`.
Backup retained at `%LOCALAPPDATA%\KeepAligner\DesktopBackups\20261103-192004-8e225648`.

Post-install verification compared the 172 packaged files with the prior archive: precisely four workflow resources changed and 168 files were unchanged. The notes editor, configuration, authentication and sync resources remained byte-identical. The user's notes profile was not read or modified.

At **19:20:49 UTC**, the full installed-generation test passed. The actual installed ASAR, running under development Electron with a disposable notes profile and blocked networking, submitted a new entirely fictitious presentation request to the existing installed service. The installed generator and PowerPoint actually ran. Observed states were `queued`, `generating`, `awaiting_visual_review`; shorter intermediate states need not appear at the polling interval.

The installed service verified all **nine output files**. The installed preview IPC returned four PNGs with hashes matching those outputs:

| Image | Dimensions |
| --- | --- |
| Guide page 1 | 1304 x 1701 |
| Guide page 2 | 1304 x 1701 |
| Before/after comparison | 3840 x 2160 |
| Synthetic movement table | 841 x 421 |

The test uses the official local presentation/guide templates but wholly fictitious inputs and non-anatomical placeholder capture images. Unlike the previous missing-case smoke test, this test **did invoke the actual installed generator**. Unlike clinical end-to-end acceptance, it **did not connect to My Keep, Hirsch or Onyx**, authenticate the current real plan, or acquire anatomical captures. Technical readiness must not be represented as clinical approval.

The returned two guide pages and comparison were inspected visually after reading them back through the preview IPC. Private source/result evidence remains under `Documents/KeepAligner_LocalTests/keep-mock-installed-5e6uwmrf`. The original synthetic staged inputs and result are retained for audit; nothing was archived to a patient folder or published.

At **19:24:42 UTC** the installed worker process was active, heartbeat age four seconds, queue depth zero and scheduled task Running. Installed generator/helper hashes matched the tested candidate. This is not a physical Windows-reboot test.

The synthetic-only execution gate is still unchanged. The outstanding work is authenticated source acquisition/anatomical capture acceptance, complete pre-generation case/source binding, and a final real-case end-to-end acceptance. The owner's read-only authorization already exists; these are remaining technical limitations.

## Remote CI confirmation

GitHub Actions run `41702205813`, for code commit `7a179de38a4589de5869d2bd5a8db54f7da75548`, completed successfully for all three jobs: **preflight**, **Windows build**, and **Android build**. This confirms the development build/test jobs; no Android application was installed on the user's phone in this session.
