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
