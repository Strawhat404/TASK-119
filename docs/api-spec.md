# HarborGate — Internal API Specification

> This project has no backend server. This document specifies the internal JavaScript module APIs, IndexedDB schema, and service layer contracts.

## Core Module APIs

### store.js

```js
store.get(key)                      // Returns value for key
store.set(key, value)               // Sets key, notifies subscribers
store.getAll()                      // Returns full state snapshot
store.subscribe(listener)           // Registers state change listener; returns unsubscribe fn
```

### router.js

```js
router.register(hash, renderFn)     // Register route handler
router.navigate(hash)               // Navigate to route (e.g. '#/reservations')
router.currentRoute()               // Returns current hash fragment
```

### database.js

```js
DB.get(store, id)                   // Get record by ID (auto-decrypts)
DB.getAll(store)                    // Get all records from store (auto-decrypts)
DB.getByIndex(store, index, value)  // Query by index, returns array
DB.getOneByIndex(store, index, val) // Query by index, returns first match
DB.add(store, record)               // Insert record (auto-encrypts)
DB.put(store, record)               // Update record (auto-encrypts; rejected for audit_logs)
DB.remove(store, id)                // Delete record (rejected for audit_logs)
DB.clear(store)                     // Clear all records (rejected for audit_logs)
DB.count(store)                     // Returns record count
```

### crypto.js

```js
crypto.encrypt(plaintext, password)            // AES-GCM encrypt with PBKDF2-derived key → base64 ciphertext
crypto.decrypt(encoded, password)              // AES-GCM decrypt → plaintext
crypto.hashPassword(password, salt?)           // PBKDF2 hash; returns { hash, salt } (both base64)
crypto.verifyPassword(password, hash, salt)    // Returns boolean
crypto.generateId()                            // Returns random 32-char hex string
crypto.encryptObject(obj, password)            // JSON-serializes then encrypts → base64
crypto.decryptObject(encrypted, password)      // Decrypts then JSON-parses → object
crypto.deriveKEK(password)                     // PBKDF2 → Key Encryption Key (for wrapping/unwrapping DEK)
crypto.generateDEK()                           // Generates random AES-256 Data Encryption Key
crypto.wrapDEK(dek, kek)                       // Wraps DEK with KEK → { iv, wrapped } (base64)
crypto.unwrapDEK(wrappedData, kek)             // Unwraps DEK with KEK → CryptoKey
crypto.encryptRecord(record, cryptoKey)        // AES-GCM encrypt record with CryptoKey → { _encrypted, _payload }
crypto.decryptRecord(encRecord, cryptoKey)     // AES-GCM decrypt record with CryptoKey → object
```

## Service Layer APIs

### auth-service.js

```js
register(username, password)                    // Creates visitor-only user, returns { success, userId }
registerWithRole(username, password, role, actor) // Requires admin actor; creates user with specific role and wraps DEK
login(username, password)                       // Verifies credentials, unwraps DEK via KEK, returns { success, session } or { error }
logout()                                        // Clears session, verified user cache, encryption key
getCurrentUser()                                // Returns DB-verified { id, username, role } or null (fail-closed)
hasRole(roles)                                  // Checks role from verified cache; returns boolean
requireAuth()                                   // Async; verifies session user from DB by userId; fail-closed
requireRole(roles)                              // Async; verifies user + role from DB by userId; fail-closed
validatePassword(password)                      // Returns { valid, errors[] }
needsSetup()                                    // Async; returns true if no users exist (first-run)
setupAdmin(username, password)                  // Bootstrap-only: creates first admin account with new DEK
```

### permissions.js

```js
createEntryPermission(reservation, policy)              // Creates time-bound entry permission from reservation
getPermissionsForReservation(reservationId, actor)      // Returns permissions; requires actor for ownership check (returns [] if unauthorized)
consumeEntry(permissionId, actor)                       // Marks single-use as used or increments multi-use counter; validates actor ownership
expirePermissions()                                     // Expires all active permissions past their window
getPermissionStatusLabel(permission)                    // Returns human-readable status label
calculatePermissionWindow(startTime)                    // Returns { windowStart, windowEnd }
isWithinPermissionWindow(permission)                    // Returns boolean
```

### device.js

```js
DeviceService.init()                                  // Loads devices from DB, processes pending outbox commands
DeviceService.registerDevice(device)                  // Registers new device { name, type, zone }
DeviceService.getDevices()                            // Returns all registered devices from DB
DeviceService.sendUnlockCommand(deviceId, reason, actor) // Sends unlock command; returns { success, status, commandId }
DeviceService.registerAdapter(type, config)           // Registers HTTP/MQTT/WebSocket adapter (local-network enforced)
DeviceService.getOutbox()                             // Returns all command outbox entries
DeviceService.setDeviceStatus(deviceId, status)       // Updates device status (online/offline)
DeviceService.onEvent(callback)                       // Subscribes to device events; returns unsubscribe fn
DeviceService.destroy()                               // Clears all retry timers and listeners
```

### map.js

```js
addPOI(poi)                                          // Adds POI { name, x, y, zone, type, description }
updatePOI(poi)                                       // Updates existing POI
deletePOI(id)                                        // Deletes POI by ID
getAllPOIs()                                          // Returns all POIs from DB
saveGeofence(geofence)                                // Saves polygon geofence { name, zone, points[] } (sanitizes name)
getAllGeofences()                                     // Returns all geofences from DB
deleteGeofence(id)                                    // Deletes geofence by ID
setWalkSpeed(mph)                                     // Persists walk speed to localStorage
getWalkSpeed()                                        // Returns walk speed (default 3 mph)
// Re-exported from lib/map-logic.js:
distanceFeet(p1, p2)                                  // Returns Euclidean distance in feet
searchByRadius(pois, center, radiusFeet)              // Returns POIs within radius
searchByZone(pois, zone)                              // Returns POIs in zone
searchByPolygon(pois, polygon)                        // Returns POIs inside polygon geofence
planRoute(from, to, waypoints?, speedMph?)            // Returns { segments[], totalDistanceFeet, totalWalkTimeMinutes }
suggestNearestEntry(pois, target, speedMph?)           // Returns { poi, distanceFeet, walkTimeMinutes } or null
```

### notifications.js

```js
createNotification({ userId, templateId, variables, type, scheduledFor })  // Renders template via lib, stores and attempts delivery
deliverNotification(notification)                                          // Attempts delivery; applies delivered/failed status
retryFailedNotifications()                                                 // Retries pending notifications with retryCount > 0 and < MAX_RETRIES
processScheduledNotifications()                                            // Delivers all due scheduled notifications
scheduleReservationReminders(reservation)                                  // Schedules 24h and 1h reminder notifications
getUserNotifications(userId)                                               // Returns notifications for user (or all if no userId)
getTemplates()                                                             // Returns copy of template registry
resolveTemplate(templateId, variables)                                     // Re-exported from lib: renders template string with {var} substitution
```

### cms.js

```js
createContent(data)                              // Creates draft content item (requires reviewer/admin role)
updateContent(id, updates, actor)                // Updates content fields, increments version (requires reviewer/admin)
transitionWorkflow(id, newState, actor)           // Validates and applies workflow transition; logs content_publish on publish
reviewContent(id, decision, actor, notes?)        // Approves (→ published) or rejects (→ draft) content
rollbackContent(id, targetVersion, actor)         // Restores content to a previous version
generateDiff(oldText, newText)                    // Returns line-by-line diff array
getContentInReview()                              // Returns all content in 'review' state
getAllContent()                                   // Returns all content items
getWorkflowStates()                               // Returns copy of valid workflow states
```

### audit.js

```js
addAuditLog(action, actor, details?, before?, after?)  // Writes immutable audit entry with role from session
getAuditLogs(filters?)                                 // Returns audit entries; filters: { actor, action, from, to }
formatAuditTimestamp(timestamp)                         // Returns MM/DD/YYYY h:mm:ss AM/PM string
createAuditEntry(action, actor, details, before, after, actorRole)  // Pure: creates audit entry object
```

### rate-limits.js

```js
getRateLimits()                                        // Returns all rate-limit rules from DB
getRateLimitByScope(scope, action)                     // Returns matching rule or null
createRateLimit(rule, actorUsername)                    // Creates rate-limit rule (requires admin role)
updateRateLimit(id, changes, actorUsername)             // Updates rule fields (requires admin role)
deleteRateLimit(id, actorUsername)                      // Deletes rule (requires admin role)
checkRateLimit(scopeType, scopeValue, action)          // Checks action count against rule; returns { allowed, remaining, rule }
```

### importexport.js

```js
exportData(password)                       // Returns encrypted JSON bundle (password required; plaintext export rejected)
importData(fileContent, password)          // Decrypts and restores stores (password required; plaintext import rejected); audit_logs are merge-only (append, not replace)
downloadJSON(data, filename)              // Triggers browser download of JSON blob
pickFile()                                // Opens file picker; returns file content string
```

## IndexedDB Schema

### users
```
{ id, username, passwordHash, passwordSalt, role, failedAttempts, lockedUntil, banned, createdAt }
```

### reservations
```
{ id, userId, visitorName, date, time, zone, entryPolicy, notes, status, createdAt }
```

### entry_permissions
```
{ id, reservationId, userId, zone, policy, maxEntries, usedEntries, windowStart, windowEnd, status, createdAt }
```

### devices
```
{ id, name, zone, type, status, lastSeen, createdAt }
```

### command_outbox
```
{ id, deviceId, type, reason, actor, status, createdAt, ackAt, retryCount, lastRetry }
```

### pois
```
{ id, name, x, y, zone, type, description }
```

### content
```
{ id, title, body, source, workflowState, locale, variants{}, version, history[], flagged, violations[], violationCount, scannedAt, author, authorId, reviewedBy, publishedBy, createdAt, updatedAt }
```

### reports
```
{ id, type, description, evidence[], status, reportedBy, resolvedBy, decision, createdAt }
```

### audit_logs
```
{ id, timestamp, formattedTimestamp, actor, actorRole, action, details, before, after }
```

### notifications
```
{ id, userId, templateId, variables, message, type, read, status, retryCount, scheduledFor, createdAt, deliveredAt, failedAt }
```

### rate_limits
```
{ id, scope, action, maxCount, windowSec, enabled, createdAt, updatedAt }
```

### zones
```
{ id }
```

### geofences
```
{ id, name, zone, points[], createdAt }
```

## Hash Routes

| Route | View | Min Role |
|-------|------|----------|
| `#/` | Dashboard | Visitor |
| `#/reservations` | Reservations | Visitor |
| `#/map` | Venue Map | Visitor |
| `#/notifications` | Notification Center | Visitor |
| `#/unlock` | Remote Unlock | Operator |
| `#/content` | CMS / Content | Reviewer |
| `#/admin` | Admin Console | Administrator |
| `#/settings` | Settings | Visitor |
| `#/login` | Login | Public |
