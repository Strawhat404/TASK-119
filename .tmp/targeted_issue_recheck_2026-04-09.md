# HarborGate Targeted Issue Recheck (Static-Only) — 2026-04-09

Scope: targeted re-validation of 4 previously reported issues only.  
Method: static code/document inspection; no runtime execution, no tests run.

## Results

1. **At-rest encryption scope excludes `users` store (password hash/salt)**  
   - **Status:** **Partially Fixed**  
   - **What changed:** `users` is now included in `ENCRYPTED_STORES`.  
   - **Evidence:** `repo/frontend/js/database.js:14-16`  
   - **Remaining gap:** login-critical fields (including `passwordHash`/`passwordSalt`) are still copied into plaintext index fields before write.  
   - **Evidence:** `repo/frontend/js/database.js:70-77`, `repo/frontend/js/database.js:112-113`  
   - **Conclusion:** original “excluded store” defect is fixed, but sensitive-field plaintext persistence risk remains.

2. **Notification retry UI label semantics mismatch with state model**  
   - **Status:** **Partially Fixed**  
   - **What changed:** retry path now includes terminal `failed` notifications and resets them to `pending`.  
   - **Evidence:** `repo/frontend/js/services/notifications.js:51-54`, `repo/frontend/js/services/notifications.js:58-60`  
   - **Remaining mismatch:** button label is “Retry Failed”, but logic also retries `pending` notifications with partial failures.  
   - **Evidence:** `repo/frontend/js/views/notifications.js:64`, `repo/frontend/js/services/notifications.js:52-53`  

3. **Unit crypto tests include stale `deriveSessionKey` model**  
   - **Status:** **Fixed**  
   - **What changed:** test section now uses KEK/DEK model (`deriveKEK`, `wrapDEK`, `unwrapDEK`) matching production crypto design.  
   - **Evidence:** `repo/unit_tests/crypto.test.js:107-113`, `repo/unit_tests/crypto.test.js:116-158`, `repo/frontend/js/crypto.js:106-159`

4. **API/integration tests remain mostly lib-level and miss service/view auth boundaries**  
   - **Status:** **Not Fixed**  
   - **Evidence:** API test imports are still `frontend/js/lib/*` modules only, not `services/*`/`views/*`.  
   - **Evidence:** `repo/API_tests/app.test.js:5-34`  
   - **Additional evidence:** router unit test still uses a mirrored local test router instead of production router.  
   - **Evidence:** `repo/unit_tests/router.test.js:4-7`, `repo/unit_tests/router.test.js:9-23`

## Summary
- Fixed: **1**
- Partially Fixed: **2**
- Not Fixed: **1**
