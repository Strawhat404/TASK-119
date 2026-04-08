# HarborGate Issue Recheck (Static)

Date: 2026-04-08  
Mode: Static-only (no app run, no tests executed)

## Summary
- Fully fixed: 3
- Partially fixed: 2
- Not fixed: 0

## Issue-by-issue Status

### 1) Stored XSS via unescaped geofence name rendering
- Status: **Partially Fixed**
- What is fixed:
  - Geofence option label is now escaped: `repo/frontend/js/views/map.js:60`
- What remains:
  - Save path still stores raw geofence name without normalization/sanitization: `repo/frontend/js/views/map.js:333`, `repo/frontend/js/services/map.js:61-69`
- Conclusion:
  - The reported UI sink is fixed; hardening recommendation on input normalization is still open.

### 2) Privileged service operations lack function-level authorization checks
- Status: **Partially Fixed**
- What is fixed:
  - CMS service now enforces reviewer/admin role in service layer: `repo/frontend/js/services/cms.js:13-21,27-28,62-64,94-96,133-135,149-151`
  - Rate-limit CRUD now enforces admin role in service layer: `repo/frontend/js/services/rate-limits.js:19-25,38-40,64-66,80-82`
- What remains:
  - `registerWithRole` guard is conditional on `actor` being provided; if omitted, role check is skipped: `repo/frontend/js/services/auth-service.js:68-75`
  - `setupAdmin` calls `registerWithRole` without actor (expected for bootstrap, but confirms nullable guard path): `repo/frontend/js/services/auth-service.js:298-302`
- Conclusion:
  - Major service-layer authorization gaps were addressed, but auth-service helper is not fully fail-closed.

### 3) Object-level authorization guard bypassed by call sites
- Status: **Fixed**
- Evidence:
  - Service now requires actor (returns empty if missing): `repo/frontend/js/services/permissions.js:90-93`
  - Reservation view now passes `user` actor at both call sites: `repo/frontend/js/views/reservations.js:64`, `repo/frontend/js/views/reservations.js:159`
- Conclusion:
  - The previously reported bypass path is closed in current code.

### 4) Documentation/schema/API drift remains after fixes
- Status: **Partially Fixed**
- What is fixed (from your listed drift points):
  - Store naming corrected to `entry_permissions`: `docs/design.md:62`, `docs/api-spec.md:156`
  - `notification_templates` mismatch removed from listed store schema section and `rate_limits` is documented: `docs/api-spec.md:191-196`
  - Crypto API section now matches current exported API surface (no `generateSalt`/old signatures): `docs/api-spec.md:41-50`, `repo/frontend/js/crypto.js:28-150`
  - Import/export now documented as mandatory encrypted (not optional): `docs/design.md:143-145`
- Remaining drift still present:
  - `users` schema says `salt` while implementation uses `passwordSalt`: `docs/api-spec.md:148`, `repo/frontend/js/services/auth-service.js:55,87`
  - `reservations` schema lists `title/startTime/endTime`, but implementation writes `date/time/visitorName/...`: `docs/api-spec.md:153`, `repo/frontend/js/views/reservations.js:221-237`
- Conclusion:
  - Your cited documentation mismatches are mostly corrected, but schema docs are still not fully aligned.

### 5) Global error handlers expose stack/details in DOM and alerts
- Status: **Fixed** (for the reported behavior)
- Evidence:
  - Raw stack details are no longer injected into DOM; user sees generic safe message: `repo/frontend/index.html:21-23,27-29`
  - `alert(...)` calls removed from handlers: `repo/frontend/index.html:19-30`
- Note:
  - Detailed stack is still logged to console (`console.error`) in all environments: `repo/frontend/index.html:20,26`.

## Security note from your item #6 (auth entrypoint comment)
- Status of prior concern: **Partially Fixed**
- Evidence:
  - Session verification is fail-closed in `requireAuth/requireRole`: `repo/frontend/js/services/auth-service.js:243-253,264-282`
  - `registerWithRole` still not strictly fail-closed when `actor` is omitted: `repo/frontend/js/services/auth-service.js:68-75`

