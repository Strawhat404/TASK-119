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
register(username, password)              // Creates visitor user, returns { success, userId }
registerWithRole(username, password, role) // Admin-only: creates user with specific role
login(username, password)                 // Returns { success, session } or { error }
logout()                                  // Clears session, verified user cache, encryption key
getCurrentUser()                          // Returns DB-verified { id, username, role } or null
hasRole(roles)                            // Checks role from verified cache; returns boolean
requireAuth()                             // Async; verifies session user from DB by userId; fail-closed
requireRole(roles)                        // Async; verifies user + role from DB by userId; fail-closed
validatePassword(password)                // Returns { valid, errors[] }
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
device.getAll()                            // Returns all registered devices
device.unlock(deviceId, reason, actorId)   // Sends unlock command, returns { commandId, status }
device.getCommandStatus(commandId)         // Returns 'sent'|'acked'|'queued'|'failed'
device.processOutbox()                     // Retries queued commands
device.registerAdapter(type, config)       // Registers HTTP/MQTT/WebSocket adapter
```

### map.js

```js
map.addPOI(poi)                            // Adds POI { id, name, x, y, zone, type }
map.searchByRadius(cx, cy, radiusFt)       // Returns POIs within radius (feet)
map.searchByZone(zoneName)                 // Returns POIs in administrative zone
map.searchByPolygon(points)                // Returns POIs inside polygon [[x,y],...]
map.planRoute(fromPOI, toPOI, speedMph)    // Returns { entryPoints, estimatedMinutes }
map.distanceFt(x1, y1, x2, y2)            // Returns distance in feet
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
cms.create(content)                        // Creates draft content item
cms.submit(contentId)                      // Moves draft → review
cms.approve(contentId, reviewerId)         // Moves review → published
cms.reject(contentId, reviewerId, reason)  // Moves review → draft
cms.archive(contentId)                     // Moves published → archived
cms.rollback(contentId, versionIndex)      // Restores previous version
cms.getDiff(contentId, v1, v2)             // Returns diff between two versions
cms.addVariant(contentId, locale, text)    // Adds multilingual variant
```

### audit.js

```js
audit.log(action, actorId, before, after)  // Writes immutable audit entry
audit.getAll()                             // Returns all audit entries
audit.getByActor(actorId)                  // Returns entries by actor
audit.getByAction(action)                  // Returns entries by action type
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
{ id, name, location, type, status, secret }
```

### command_outbox
```
{ id, deviceId, command, reason, actorId, createdAt, status, attempts, lastAttempt }
```

### pois
```
{ id, name, x, y, zone, type, description }
```

### content
```
{ id, title, body, status, authorId, versions[], variants{}, createdAt, updatedAt }
```

### reports
```
{ id, type, description, evidence[], status, reportedBy, resolvedBy, decision, createdAt }
```

### audit_logs
```
{ id, timestamp, actorId, actorRole, action, before, after }
```

### notifications
```
{ id, userId, templateId, vars, renderedBody, status, attempts, createdAt, deliveredAt }
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
