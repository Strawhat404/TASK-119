# HarborGate — Clarifying Questions & Answers

### Open vs Admin-Controlled Registration

**Question**: Should user registration be open or admin-only?

**My Understanding**: The system needs a seeded initial admin account, and subsequent accounts should be controlled to prevent unauthorized access.

**Solution**: Initial admin account is seeded on first run. Subsequent user registration is admin-controlled — admin creates accounts and assigns roles.

---

### Account Lockout Expiry

**Question**: What happens to a locked account after 15 minutes?

**My Understanding**: A time-based lockout is preferable to a manual unlock to reduce admin burden while still deterring brute-force attacks.

**Solution**: The lockout automatically expires after 15 minutes. The user can attempt login again. The failed attempt counter resets on successful login.

---

### Session Token Type

**Question**: Is the session token a JWT or a random token?

**My Understanding**: Since the system is fully client-side with no server, JWT signatures cannot be verified server-side, making random tokens more appropriate.

**Solution**: A random UUID-based token stored in LocalStorage. No JWT — the system is fully client-side with no server to verify signatures.

---

### Reservation to Permission Cardinality

**Question**: Can a reservation have multiple entry permissions?

**My Understanding**: A 1:1 relationship simplifies permission management and avoids conflicting access policies on the same reservation.

**Solution**: No. Each reservation generates exactly one entry permission with the configured policy (single-use or multi-use).

---

### Cancelled Reservation Permission Behaviour

**Question**: What happens if a reservation is cancelled — does the permission become invalid?

**My Understanding**: Keeping a permission active after cancellation would be a security gap, so it should be invalidated immediately.

**Solution**: Yes. Cancelling a reservation sets the linked permission status to `expired` immediately.

---

### Reservation Time Window Customisation

**Question**: Can the time window be customized per reservation?

**My Understanding**: A default window covers most cases, but operators need flexibility for special events or VIP guests.

**Solution**: The default window is 15 min before → 30 min after. Operators and Administrators can override this per reservation.

---

### Remote Unlock Role Restriction

**Question**: Can a Visitor trigger a remote unlock?

**My Understanding**: Remote unlock is a privileged action that should be restricted to staff roles to prevent misuse.

**Solution**: No. Remote unlock is restricted to Operator and Administrator roles only.

---

### Unconfigured Device Adapter

**Question**: What if the device adapter is not configured?

**My Understanding**: The command should still be recorded so it can be fulfilled once an adapter is available, rather than silently dropped.

**Solution**: The command is created and immediately enters `queued` state. It will retry when an adapter becomes available or can be manually resolved by an Administrator.

---

### Audit Log Encryption

**Question**: Is the reason note stored encrypted?

**My Understanding**: Audit log entries may contain sensitive operational details and should be protected at rest.

**Solution**: Yes. All audit log entries are stored encrypted at rest via AES-GCM.

---

### Venue Map Coordinate System

**Question**: Are coordinates in feet relative to a fixed origin point?

**My Understanding**: A fixed origin ensures consistent positioning across all devices and sessions.

**Solution**: Yes. The origin (0, 0) is the top-left corner of the venue map canvas. All coordinates are in feet from that origin.

---

### Bulk POI Import

**Question**: Can POIs be imported in bulk?

**My Understanding**: Manual entry for large venues would be impractical, so bulk import is needed.

**Solution**: Yes, via the import/export feature which supports JSON bundles containing POI records.

---

### Multi-Stop Route Planning

**Question**: Does route planning support multi-stop routes?

**My Understanding**: Multi-stop routing adds significant complexity and is not required for the initial version.

**Solution**: The current implementation supports point-to-point routing (from → to). Multi-stop is not in scope for this version.

---

### Real-Time Notifications

**Question**: Are notifications pushed in real-time?

**My Understanding**: Since the system is fully client-side with no persistent server connection, real-time push is not feasible.

**Solution**: No. The system is fully client-side. Notifications are checked/triggered on page load and on a polling interval (every 60 seconds) using `setInterval`.

---

### Failed Notification Delivery

**Question**: What happens after 3 failed delivery attempts?

**My Understanding**: Indefinite retries could cause noise; capping retries and surfacing failures gives admins visibility.

**Solution**: The notification is marked `failed` and shown with a failed receipt in the UI. No further automatic retries occur.

---

### Notification Opt-Out

**Question**: Can users opt out of specific notification types?

**My Understanding**: Per-type preferences add UX value but are out of scope for the initial version.

**Solution**: Not in this version. All notifications are delivered to the user's inbox. Future versions may add per-type preferences.

---

### Content Approval Roles

**Question**: Who can approve content for publishing?

**My Understanding**: Approval should require elevated permissions to prevent unreviewed content from going live.

**Solution**: Reviewer and Administrator roles can approve content. Authors (any role) can create drafts.

---

### Content Version History Retention

**Question**: How many versions are kept in history?

**My Understanding**: Unlimited retention avoids data loss and supports audit requirements.

**Solution**: All versions are retained. There is no automatic pruning.

---

### Multilingual Publishing Requirement

**Question**: Are multilingual variants required for publishing?

**My Understanding**: Requiring all language variants before publishing would block content for venues that only operate in one language.

**Solution**: No. A content item can be published with only the default language variant.

---

### Banned User Data Deletion

**Question**: Can a banned user's data be deleted?

**My Understanding**: Banning and deletion are separate concerns — banning is a reversible access control action, deletion is permanent.

**Solution**: Banning prevents login but does not delete data. Data deletion is a separate admin action available in the import/export and settings screens.

---

### Audit Log Deletion

**Question**: Are audit log entries ever deleted?

**My Understanding**: Audit logs must be immutable to maintain a trustworthy record of system activity.

**Solution**: No. Audit log entries are immutable and are never deleted through the UI. They can only be exported.

---

### Encryption Key Derivation

**Question**: What encryption key is used for data at rest?

**My Understanding**: A password-derived key ties data access to the user's credentials without requiring a separate key management system.

**Solution**: A key derived from the user's password via PBKDF2 (100,000 iterations, SHA-256, 256-bit key). The key is derived fresh on each login and held in memory only for the session duration.

---

### Forgotten Password Data Recovery

**Question**: What happens to encrypted data if the user forgets their password?

**My Understanding**: Without the original key, AES-GCM encrypted data is unrecoverable — this is a deliberate security trade-off.

**Solution**: Data cannot be recovered without the original password. Administrators can reset a user's account, but encrypted data from the old password will be inaccessible.

---

### Multi-User Data Isolation

**Question**: Is data shared between users on the same device?

**My Understanding**: Per-user encryption keys ensure that one user cannot read another user's sensitive data even on a shared device.

**Solution**: Each user's sensitive data is encrypted with their own derived key. IndexedDB records are scoped by userId where applicable.

---

### Internet Connectivity Requirement

**Question**: Does the app require an internet connection?

**My Understanding**: The app is designed for venue environments where internet connectivity may be unreliable.

**Solution**: No. The app runs fully offline. The only network activity is optional device adapter communication on the local network.

---

### Simultaneous Multi-User Sessions

**Question**: Can multiple users use the app simultaneously?

**My Understanding**: Browser-based IndexedDB is shared within a tab context, so concurrent sessions in the same tab would conflict.

**Solution**: The app is designed for single-user sessions in a browser tab. Multiple users can use the same device by logging out and logging in with different credentials.
