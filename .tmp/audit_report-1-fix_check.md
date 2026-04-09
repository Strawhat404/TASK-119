# HarborGate Issue Recheck v2 (Static)

Date: 2026-04-08
Scope: Revalidation of the 6 issues you listed (static only, no runtime execution)

## Result Summary
- 1) Stored XSS via geofence name rendering: **Fixed**
- 2) Missing function-level authorization on privileged services: **Fixed**
- 3) Object-level auth bypass via missing actor at call sites: **Fixed**
- 4) Documentation/schema/API drift: ** Fixed**
- 5) Global error handlers exposing stack/details in DOM + alerts: **Fixed**
- 6) Auth entrypoint concern (registerWithRole guard): **Fixed**

## Detailed Status

### 1) Stored XSS via unescaped geofence name rendering
- Status: **Fixed**
- Evidence:
  - Geofence option is escaped in template: `repo/frontend/js/views/map.js:60`
  - Save path now normalizes/sanitizes name before persistence: `repo/frontend/js/views/map.js:333-335`

### 2) Privileged service operations lacked function-level authorization checks
- Status: **Fixed**
- Evidence:
  - `registerWithRole` now fails closed without admin actor: `repo/frontend/js/services/auth-service.js:93-98`
  - CMS mutations enforce reviewer/admin via service guard: `repo/frontend/js/services/cms.js:15-21,27-28,62-64,94-96,133-135,149-151`
  - Rate-limit CRUD enforces admin via service guard: `repo/frontend/js/services/rate-limits.js:19-25,38-40,64-66,80-82`

### 3) Object-level auth guard bypassed by call sites
- Status: **Fixed**
- Evidence:
  - Service enforces actor presence (`[]` if missing): `repo/frontend/js/services/permissions.js:90-93`
  - Both reservation call sites now pass actor: `repo/frontend/js/views/reservations.js:64,159`

### 4) Documentation/schema/API drift remains
- Status: **Fixed**
- Fixed evidence:
  - Store naming updated (`entry_permissions`): `docs/design.md:62`, `docs/api-spec.md:156`
  - Crypto API docs aligned with current module surface: `docs/api-spec.md:41-50`, `repo/frontend/js/crypto.js:28-50,71-150`
  - Import/export encryption documented as mandatory: `docs/design.md:143-145`


### 5) Global error handlers exposing stack/details in DOM and alerts
- Status: **Fixed** (for the reported risk)
- Evidence:
  - User-facing message is generic; stack not injected into DOM: `repo/frontend/index.html:21-23,27-29`
  - `alert(...)` removed: `repo/frontend/index.html:17-31`

### 6) Authentication entrypoint note (registerWithRole lacked function-level role guard)
- Status: **Fixed**
- Evidence:
  - `registerWithRole` now requires actor and `actor.role === 'admin'`: `repo/frontend/js/services/auth-service.js:93-98`
  - Bootstrap admin setup uses separate internal helper path (explicit bootstrap-only flow): `repo/frontend/js/services/auth-service.js:299-303`

