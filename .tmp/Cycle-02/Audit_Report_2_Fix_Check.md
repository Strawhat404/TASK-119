# HarborGate Issue Revalidation (Static) — Pass 2

Date: 2026-04-08
Scope: Static inspection only (no project run/tests/docker)

## Results for Requested 5 Issues

1. High: Content publish rate-limit mismatch (`content_publish` checked vs `content_workflow` logged)
- Status: **Fixed**
- Evidence:
  - Check uses `content_publish`: `repo/frontend/js/views/content.js:215-217`
  - Publish path now logs `content_publish` explicitly: `repo/frontend/js/services/cms.js:130-133`
- Note: `content_workflow` is still logged too (`repo/frontend/js/services/cms.js:128`), which is fine.

2. High: Object-level auth gap in `getPermissionsForReservation` when reservation missing
- Status: **Fixed**
- Evidence:
  - Missing reservation now returns empty (fail-closed): `repo/frontend/js/services/permissions.js:94-95`
  - Ownership/privileged checks preserved: `repo/frontend/js/services/permissions.js:96-99`

3. Medium: Notification retry contradictory condition (`failed` + `retryCount < MAX_RETRIES`)
- Status: **Fixed**
- Evidence:
  - Retry selector no longer requires `failed`; it retries pending items with retries in progress: `repo/frontend/js/services/notifications.js:49-53`
  - Failure transition remains terminal at max retries: `repo/frontend/js/lib/notification-logic.js:56-61`

4. Medium: `docs/api-spec.md` notifications API stale vs exports
- Status: **Fixed**
- Evidence:
  - API doc now lists current notification service functions: `docs/api-spec.md:108-116`

5. Medium: API/integration tests stale crypto assertions (`deriveSessionKey`) and mostly structural
- Status: **Partially Fixed**
- Evidence:
  - Stale crypto assertions replaced with KEK/DEK model checks: `repo/API_tests/app.test.js:141-145`, `repo/API_tests/app.test.js:159-166`
  - Tests remain largely structural/file-string checks: `repo/API_tests/app.test.js:24-54`, `repo/API_tests/app.test.js:308-325`

## Final
- Fixed: **4 / 5**
- Partially fixed: **1 / 5** (integration test depth still mostly structural)
