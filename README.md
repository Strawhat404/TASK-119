# HarborGate — Visitor Access & Content Compliance

A browser-based visitor management and content compliance system for venues and managed properties. Runs entirely client-side with no backend server required.

## Roles

| Role | Description |
|------|-------------|
| Visitor | Register, create reservations, view map and notifications |
| Operator | + Remote unlock, manage all reservations |
| Reviewer | + Content moderation, CMS review queue |
| Administrator | Full access, user management, audit logs, reports |

## Quick Start

```bash
cd repo
docker compose up -d
# Open http://localhost:8080
```

On first run, a setup screen will prompt you to create the administrator account with a username and password of your choice. No default credentials are hardcoded.

## Running Tests

```bash
cd repo
./run_tests.sh
```

## Project Structure

```
Harborgate/
├── docs/
│   ├── design.md        # System architecture and design
│   ├── api-spec.md      # Internal module API specifications
│   └── questions.md     # Clarifying questions and answers
├── repo/
│   ├── frontend/        # Vanilla HTML/CSS/JS SPA
│   │   ├── index.html
│   │   ├── css/
│   │   └── js/
│   │       ├── store.js
│   │       ├── router.js
│   │       ├── db.js
│   │       ├── crypto.js
│   │       ├── views/
│   │       ├── components/
│   │       └── services/
│   ├── unit_tests/      # Node.js unit tests (node:test)
│   ├── API_tests/       # Integration/E2E tests
│   ├── docker-compose.yml
│   ├── nginx.conf
│   └── run_tests.sh
├── sessions/            # Development session traces
└── metadata.json
```

## Tech Stack

- **Frontend**: Vanilla HTML/CSS/JavaScript (no frameworks, no build tools)
- **Routing**: Hash-based client-side routing
- **Storage**: IndexedDB (primary data) + LocalStorage (session/settings)
- **Crypto**: Web Crypto API — PBKDF2 key derivation, AES-GCM encryption
- **Serving**: nginx:alpine (Docker)
- **Tests**: Node.js built-in test runner (`node:test`)
