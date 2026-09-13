# Architecture

The system is a local-first TypeScript monorepo with three independently runnable processes. The Express 5 `api` owns authenticated HTTP operations, `dashboard` is the Arabic RTL operator interface, and `worker` is the only process that executes queued Facebook actions. Business rules live outside browser automation so they remain deterministic and testable.

SQLite is the source of truth. The queue uses compare-and-set task claims, expiring leases, idempotency keys, retries and reconciliation. Browser operations are behind focused adapters and use one persistent Chromium profile. Security or login challenges pause the Facebook gate and create an operator notification; they are never bypassed.

Data flows from keyword discovery to canonical group upsert, metric snapshots, explainable scoring/rules, membership state tracking, job targeting, campaign post creation and periodic approval monitoring. Every state change has history and every manual decision is attributed in the audit trail.
