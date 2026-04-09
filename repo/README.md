# HarborGate — Visitor Access & Content Compliance

A browser-based visitor management and content compliance system. Runs entirely client-side with no backend server.

## Quick Start

```bash
docker compose up -d
# Open http://localhost:8080
```

### First-Run Setup

On first launch (when no users exist in the database), you will be presented with a **Setup** screen prompting you to create the administrator account with a username and password of your choice. There are no hardcoded default credentials.

> **Security tip:** Choose a strong, unique password during setup. You can change the admin password at any time via the Admin Console → User Management.

Self-registration through the login screen creates visitor-only accounts. Privileged roles (operator, reviewer, admin) can only be assigned by an administrator through the Admin Console.

## Features

- **Authentication** — Password policy (12+ chars, mixed case, number, symbol), 5-attempt lockout, 30-min idle timeout
- **Role-Based Access** — Visitor, Operator, Reviewer, Administrator with permission-gated routes
- **Reservations** — Create, approve, deny; auto-generated time-bound entry permissions (single-use / multi-use)
- **Remote Unlock** — Drawer panel for device unlock with audit trail, ACK timeout, retry queue
- **Venue Map** — SVG map with POIs, radius/zone/polygon search, route planning, configurable walk speed
- **Content Management** — Draft → Review → Publish workflow, multilingual variants, diff & rollback
- **Notification Center** — Template-based inbox, scheduled reminders, retry logic, delivery receipts
- **Admin Console** — User management, bans, role assignment, immutable audit log, reports
- **Import/Export** — Encrypted JSON bundle backup and restore
- **Encryption at Rest** — Sensitive IndexedDB stores encrypted via AES-GCM with user-derived PBKDF2 key

## Tech Stack

- Vanilla HTML/CSS/JavaScript (no frameworks, no build tools)
- IndexedDB for data persistence (with at-rest encryption for sensitive stores)
- LocalStorage for settings and session tokens
- Web Crypto API for encryption (AES-GCM, PBKDF2)
- Hash-based client-side routing
- Docker (nginx:alpine) for serving static files

## Running Tests

```bash
./run_tests.sh
```

Or manually:

```bash
node --test unit_tests/*.test.js
```


