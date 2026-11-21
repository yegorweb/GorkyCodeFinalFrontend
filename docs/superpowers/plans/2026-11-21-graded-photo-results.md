# Graded Photo Results Implementation Plan

> **For agentic workers:** Use incremental-implementation with independent file ownership; verify each deliverable and perform one final independent review.

**Goal:** Automatically display graded submissions and error regions on uploaded photographs.

**Architecture:** Reuse BatchWorkflow cursor polling through the authenticated backend, with a results reader independent of scanner session restoration. Show owner-scoped persisted tasks and normalized error boxes on the exact uploaded pages.

**Tech Stack:** Nuxt 4, Vue 3, Vuetify, TypeScript, IndexedDB; Python AI worker.

**Spec:** ../specs/2026-11-21-graded-photo-results-design.md

## Global Constraints

- Poll every 2500 ms; never automatically ACK.
- Coordinates use 0–1000 image units, with 1-based page numbers.
- Preserve owner isolation, cursor persistence, and existing scanner behavior.
- No new product dependencies; use existing test commands.

## Review Focus

- Finished sessions and modern batchId links must restore correctly.
- Empty cursor responses must not reset saved cursors.
- Slow requests and page unmount must not create overlapping polling loops.
- Multi-page coordinates must bind to the exact page_id, with invalid coordinates ignored.
- All-manual solver cells must still carry diagnosis evidence and wrong-answer boxes.

### Task 1: Owner-scoped results polling

**Files:** app/composables/useGradingResults.ts, app/utils/grading-results.ts, tests/grading-results.test.ts.

**Interfaces:** useGradingResults(scanId?: string) returns batches, captures, loading, polling, error, ready, refresh(), poll(), acknowledge(). Use existing WorkflowBatch, CaptureRecord, IndexedDBWorkflowStore and BatchWorkflow.

- [ ] Write tests for finished-session discovery, owner isolation, scanId/batchId selection and terminal completion.
- [ ] Run focused tests and observe failure, implement minimum selection/polling behavior, then pass focused tests.
- [ ] Auto-refresh and poll pending closed batches; preserve local data and manual ACK.

### Task 2: Photo and error interpretation

**Files:** app/utils/results.ts, app/types/results.d.ts, tests/results.test.ts, app/components/ScanResultPreview.vue.

- [ ] Test normalized box conversion: (100,200,300,400) becomes left=10%,top=20%,width=20%,height=20%; ignore other pages and malformed boxes.
- [ ] Test manual AI proposals and exact page matching before implementing helpers.
- [ ] Display uploaded photos and numbered accessible overlays with explanatory text.

### Task 3: Checked-work table and result navigation

**Files:** app/components/CheckedWorksSection.vue, app/pages/works/index.vue, app/pages/works/results.vue, README.md.

- [ ] Connect Task 1 to both pages; show a checked-work section alongside existing work groups.
- [ ] Open selected task via /works/results?scanId=...&taskId=... and show Task 2 photo preview.
- [ ] Verify npm test, npm run typecheck and npm run build plus browser rendering/polling.

### Task 4: Preserve error coordinates in AI results

**Files in backend repo:** ai-service/errorlab/worker.py, ai-service/tests/test_worker.py.

- [ ] Reproduce find_boxes seeing only manual cells with a regression test.
- [ ] Compute boxes after diagnosis and before manual review conversion; preserve manual statuses and review_required.
- [ ] Run pytest tests/test_worker.py and related coordinate tests.

### Completion

- [ ] Review both repository diffs independently, resolve material findings, report verified commands and remaining storage limitation.
