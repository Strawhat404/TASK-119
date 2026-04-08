# HarborGate Issue Revalidation (Static)

Date: 2026-04-08
Scope: Static code/doc/test inspection only (no runtime execution)

## Summary
1. Content publish rate-limit action mismatch: **Fixed**
2. Orphaned permission enumeration in `getPermissionsForReservation`: **Fixed**
3. Notification retry contradictory conditions: **Fixed**
4. `docs/api-spec.md` notification contract stale: **Fixed**
5. API/integration tests stale crypto assertions + mostly structural: **Partially Fixed**

## Detailed Results

### 1) High: Content publish rate-limit ineffective (`content_publish` vs `content_workflow`)
- Status: **Fixed**
- Evidence:
  - Rate-limit check still uses `content_publish`: `repo/frontend/js/views/content.js:215-217`
  - CMS now logs explicit publish action when published: `repo/frontend/js/services/cms.js:130-133`
  - Counter logic matches exact action string: `repo/frontend/js/services/rate-limits.js:108-110`
- Conclusion: action-name mismatch is resolved because publish now emits `content_publish` audit events.

### 2) High: Object-level authorization gap when reservation missing
- Status: **Fixed**
- Evidence:
  - Missing reservation now fails closed: `repo/frontend/js/services/permissions.js:94-95`
  - Ownership/privileged check still enforced: `repo/frontend/js/services/permissions.js:96-99`
- Conclusion: unauthorized enumeration via orphaned permission path is blocked by early `[]` return when reservation is absent.

### 3) Medium: Notification retry contradictory conditions
- Status: **Fixed**
- Evidence:
  - Retry selector changed to pending-with-retries-in-progress: `repo/frontend/js/services/notifications.js:49-53`
  - Failure transition remains terminal at `MAX_RETRIES`: `repo/frontend/js/lib/notification-logic.js:56-61`
- Conclusion: prior contradiction (`status==='failed' && retryCount<MAX_RETRIES`) no longer exists.

### 4) Medium: `docs/api-spec.md` notification API stale
- Status: **Fixed**
- Evidence:
  - Docs now list implemented exports: `docs/api-spec.md:108-116`
  - Implementation exports/functions: `repo/frontend/js/services/notifications.js:21-33`, `repo/frontend/js/services/notifications.js:35-70`, `repo/frontend/js/services/notifications.js:72-109`
- Conclusion: notification API documentation is aligned with current service module.

### 5) Medium: API/integration tests stale crypto assertions and mostly structural
- Status: **Partially Fixed**
- Evidence:
  - Stale `deriveSessionKey` checks replaced with KEK/DEK assertions: `repo/API_tests/app.test.js:136-141`, `repo/API_tests/app.test.js:154-161`
  - Test suite still largely static-string/exists checks (structural): `repo/API_tests/app.test.js:19-54`, `repo/API_tests/app.test.js:299-325`
- Conclusion:
  - **Fixed**: stale crypto assertion portion.
  - **Not fully fixed**: API/integration layer remains predominantly structural rather than behavioral.

## Final Revalidation Verdict
- Of the 5 reported issues:
  - **4 fixed**
  - **1 partially fixed** (test-quality depth remains limited)
