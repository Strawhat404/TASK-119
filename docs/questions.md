# HarborGate — Clarifying Questions & Answers

## Authentication

**Q: Should user registration be open or admin-only?**
A: Initial admin account is seeded on first run. Subsequent user registration is admin-controlled (admin creates accounts and assigns roles).

**Q: What happens to a locked account after 15 minutes?**
A: The lockout automatically expires. The user can attempt login again. The failed attempt counter resets on successful login.

**Q: Is the session token a JWT or a random token?**
A: A random UUID-based token stored in LocalStorage. No JWT — the system is fully client-side with no server to verify signatures.

## Reservations & Permissions

**Q: Can a reservation have multiple entry permissions?**
A: No. Each reservation generates exactly one entry permission with the configured policy (single-use or multi-use).

**Q: What happens if a reservation is cancelled — does the permission become invalid?**
A: Yes. Cancelling a reservation sets the linked permission status to `expired` immediately.

**Q: Can the time window be customized per reservation?**
A: The default window is 15 min before → 30 min after. Operators and Administrators can override this per reservation.

## Remote Unlock

**Q: Can a Visitor trigger a remote unlock?**
A: No. Remote unlock is restricted to Operator and Administrator roles only.

**Q: What if the device adapter is not configured?**
A: The command is created and immediately enters `queued` state. It will retry when an adapter becomes available or can be manually resolved by an Administrator.

**Q: Is the reason note stored encrypted?**
A: Yes. All audit log entries are stored encrypted at rest via AES-GCM.

## Venue Map

**Q: Are coordinates in feet relative to a fixed origin point?**
A: Yes. The origin (0, 0) is the top-left corner of the venue map canvas. All coordinates are in feet from that origin.

**Q: Can POIs be imported in bulk?**
A: Yes, via the import/export feature which supports JSON bundles containing POI records.

**Q: Does route planning support multi-stop routes?**
A: The current implementation supports point-to-point routing (from → to). Multi-stop is not in scope for this version.

## Notifications

**Q: Are notifications pushed in real-time?**
A: No. The system is fully client-side. Notifications are checked/triggered on page load and on a polling interval (every 60 seconds) using `setInterval`.

**Q: What happens after 3 failed delivery attempts?**
A: The notification is marked `failed` and shown with a failed receipt in the UI. No further automatic retries occur.

**Q: Can users opt out of specific notification types?**
A: Not in this version. All notifications are delivered to the user's inbox. Future versions may add per-type preferences.

## CMS

**Q: Who can approve content for publishing?**
A: Reviewer and Administrator roles can approve content. Authors (any role) can create drafts.

**Q: How many versions are kept in history?**
A: All versions are retained. There is no automatic pruning.

**Q: Are multilingual variants required for publishing?**
A: No. A content item can be published with only the default language variant.

## Admin Console

**Q: Can a banned user's data be deleted?**
A: Banning prevents login but does not delete data. Data deletion is a separate admin action available in the import/export and settings screens.

**Q: Are audit log entries ever deleted?**
A: No. Audit log entries are immutable and are never deleted through the UI. They can only be exported.

## Data & Security

**Q: What encryption key is used for data at rest?**
A: A key derived from the user's password via PBKDF2 (100,000 iterations, SHA-256, 256-bit key). The key is derived fresh on each login and held in memory only for the session duration.

**Q: What happens to encrypted data if the user forgets their password?**
A: Data cannot be recovered without the original password. Administrators can reset a user's account, but encrypted data from the old password will be inaccessible.

**Q: Is data shared between users on the same device?**
A: Each user's sensitive data is encrypted with their own derived key. IndexedDB records are scoped by userId where applicable.

## Deployment

**Q: Does the app require an internet connection?**
A: No. The app runs fully offline. The only network activity is optional device adapter communication on the local network.

**Q: Can multiple users use the app simultaneously?**
A: The app is designed for single-user sessions in a browser tab. Multiple users can use the same device by logging out and logging in with different credentials.
