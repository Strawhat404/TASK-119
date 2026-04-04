# HarborGate — Internal API Specification

> This project has no backend server. This document specifies the internal JavaScript module APIs, IndexedDB schema, and service layer contracts.

## Core Module APIs

### store.js

```js
store.getState()                    // Returns full state object
store.setState(partial)             // Merges partial state, notifies subscribers
store.subscribe(listener)           // Registers state change listener
store.dispatch(action, payload)     // Dispatches named action
```

### router.js

```js
router.navigate(hash)               // Navigate to route (e.g. '#/reservations')
router.register(hash, renderFn)     // Register route handler
router.getCurrentRoute()            // Returns current hash fragment
```

### db.js

```js
db.get(store, id)                   // Get record by ID
db.getAll(store)                    // Get all records from store
db.put(store, record)               // Insert or update record
db.delete(store, id)                // Delete record by ID
db.query(store, indexName, value)   // Query by index
db.clear(store)                     // Clear all records in store
```

### crypto.js

```js
crypto.deriveKey(password, salt)    // PBKDF2 → AES-GCM key
crypto.encrypt(key, plaintext)      // AES-GCM encrypt → base64 ciphertext
crypto.decrypt(key, ciphertext)     // AES-GCM decrypt → plaintext
crypto.hashPassword(password)       // Returns { hash, salt }
crypto.verifyPassword(password, hash, salt)  // Returns boolean
crypto.generateSalt()               // Returns random 16-byte salt (base64)
```

## Service Layer APIs

### auth.js

```js
auth.register(username, password, role)   // Creates user, returns { success, userId }
auth.login(username, password)            // Returns { success, token, user } or { locked, remainingMs }
auth.logout()                             // Clears session token
auth.getCurrentUser()                     // Returns current user from session
auth.extendSession()                      // Resets idle timeout
auth.checkSession()                       // Returns { valid, expiresIn }
auth.validatePassword(password)           // Returns { valid, errors[] }
```

### permissions.js

```js
permissions.create(reservationId, policy)  // Creates entry permission
permissions.getForReservation(reservationId) // Returns permission record
permissions.consume(permissionId)          // Marks single-use as used, increments multi-use counter
permissions.getStatus(permissionId)        // Returns 'active'|'used'|'expired'|'pending'
permissions.isValid(permissionId)          // Returns boolean (within time window + not exhausted)
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
notifications.send(templateId, vars, userId)  // Renders template, queues notification
notifications.getInbox(userId)                // Returns notification list
notifications.markRead(notificationId)        // Marks as read
notifications.retry(notificationId)           // Retries failed notification (max 3)
notifications.scheduleReminder(reservationId) // Schedules 24h and 1h reminders
notifications.renderTemplate(templateId, vars) // Returns rendered string
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
importexport.exportAll(encrypt, password)  // Downloads encrypted/plain JSON bundle
importexport.importBundle(file, password)  // Imports and restores all stores
```

## IndexedDB Schema

### users
```
{ id, username, passwordHash, salt, role, createdAt, failedAttempts, lockedUntil, banned }
```

### reservations
```
{ id, userId, title, startTime, endTime, status, createdAt }
```

### permissions
```
{ id, reservationId, policy, usesRemaining, startWindow, endWindow, status }
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

### notification_templates
```
{ id, name, subject, body, variables[] }
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
