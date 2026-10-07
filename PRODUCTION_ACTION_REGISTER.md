# PRODUCTION ACTION REGISTER
**RELEASE:** RC-1.0.0-FINAL
**DATE:** 2026-09-17

This document tracks remaining open operational and infrastructure items required for full platform maturity, following the Phase 10.6 operational closure for PAPER/DEMO/SANDBOX.

| ID | Description | Priority | Owner | Dependency | Status | Required Action | Verification Requirement |
|---|---|---|---|---|---|---|---|
| ACT-001 | Firestore Managed Backup/Restore | HIGH | DevOps | GCP IAM, Cloud Storage | **BLOCKED** | Provision GCP IAM roles (`roles/datastore.importExportAdmin`) and configure automated scheduled exports of Firestore to a dedicated cold-storage bucket. | Execute backup, trigger automated alert on success, and perform controlled restore in a dedicated Staging project. |
| ACT-002 | Release Artifact Rollback | HIGH | DevOps | GCP Artifact Registry / CI-CD | **BLOCKED** | Connect Git repository to a CI/CD pipeline (e.g., Cloud Build) that pushes immutable Docker images to Artifact Registry, allowing deterministic Cloud Run rollbacks. | Force rollback to previous image via Cloud Run revisions and verify application state loads safely. |
| ACT-003 | 5paisa SANDBOX Credentials | MEDIUM | Trading Ops | 5paisa Developer API | **RESOLVED** | Acquire Indian Equity broker developer API keys and map them into the `.env` production secrets for the `FIVE_PAISA_DEMO` environment. | Connect to 5paisa Sandbox, retrieve market data, execute simulated options order, and reconcile. |
| ACT-004 | Firebase Outage Simulation | LOW | DevOps | Firebase SDK internals | **BLOCKED** | Cannot artificially induce a platform-wide Google outage. Rely on Firebase offline persistence capabilities inherently built into the client SDK. | Verify local offline caching handles brief network partitions seamlessly. |

