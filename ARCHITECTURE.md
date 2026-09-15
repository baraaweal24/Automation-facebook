# Architecture

The system is a local-first TypeScript monorepo with three independently runnable processes. The Express 5 `api` owns authenticated HTTP operations, `dashboard` is the Arabic RTL operator interface, and `worker` is the only process that executes queued Facebook actions. Business rules live outside browser automation so they remain deterministic and testable.

SQLite is the source of truth. The queue uses compare-and-set task claims, expiring leases, idempotency keys, retries and reconciliation. Browser operations are behind focused adapters and use one persistent Chromium profile. Security or login challenges pause the Facebook gate and create an operator notification; they are never bypassed.

Data flows from keyword discovery to canonical group upsert, metric snapshots, explainable scoring/rules, membership state tracking, job targeting, campaign post creation and periodic approval monitoring. Every state change has history and every manual decision is attributed in the audit trail.

## Reviewed content workflow

The API owns the separate ChatGPT browser session and persistent ContentDraft records. Generation sends the operator's supplied facts and the selected groups' names/descriptions to the browser, reads only a completed new assistant turn, and never initiates Facebook publication. One generation runs at a time; login/challenges are manual. A failed or interrupted generation is not automatically resubmitted. The editor supports manually pasted text when the external UI changes.

The worker imports candidates from the personal account's joined-groups page and verifies the explicit membership button before upserting membership. A partial scan never removes existing memberships. The browser adapter can miss inaccessible or differently rendered groups; the completion notification reports verified counts.

Campaign creation transactionally stores the reviewed content snapshot, dry-run mode, explicit group IDs, request key, audit record and preparation task. Preparation materializes all targets with a unique dispatch key, then admits batches into the queue. The scheduler replenishes batches and reconciles completion. Campaigns do not change mode after creation.

## Failure boundaries

Before the final Facebook click, a post becomes POSTING durably. Any crash or uncertainty after that point requires manual review instead of resubmission. Only full matching content plus a new same-group permalink confirms publication; a pending notification is a separate state. Approval monitoring requires a known post permalink. A missing pending message is never treated as approval.

The worker renews leases and checks automation state while running. Stop closes its browser and guards are checked immediately before side effects. An already submitted remote request cannot be recalled, so the outcome may remain uncertain. Process locks enforce one API and one worker per workspace; browser profile locks separately protect browser ownership. The API's status reads do not take over the Facebook profile.

Tests use independently migrated temporary databases, plus local HTML browser fixtures. The UI smoke check intercepts API responses and verifies selection, review invalidation, desktop/mobile layout and campaign submission. Real-account compatibility remains an operator acceptance check. Backup/restore includes database and uploads, checks file hashes and SQLite integrity, preserves the previous database and starts restored automation stopped.
