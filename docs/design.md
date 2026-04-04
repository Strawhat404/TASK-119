# HarborGate — System Design

## Overview

HarborGate is a browser-based Visitor Access & Content Compliance system. It runs entirely client-side with no backend server. All state is managed in the browser using IndexedDB and LocalStorage, with Web Crypto API for encryption at rest.

## Architecture

### Single-Page Application (SPA)

- Entry point: `frontend/index.html`
- Hash-based routing (`#/dashboard`, `#/reservations`, `#/map`, etc.)
- No build tools, no frameworks — vanilla HTML/CSS/JavaScript

### Layer Structure

```
┌─────────────────────────────────────────┐
│              Views (UI Layer)           │
│  dashboard, reservations, map, unlock,  │
│  notifications, content, admin, settings│
├─────────────────────────────────────────┤
│           Components (Shared UI)        │
│  Modal, Drawer, Table, Notifications,   │
│  SessionWarning                         │
├─────────────────────────────────────────┤
│           Services (Business Logic)     │
│  auth, permissions, device, map, cms,   │
│  notifications, audit, importexport     │
├─────────────────────────────────────────┤
│         Core Modules                    │
│  store.js, router.js, db.js, crypto.js  │
├─────────────────────────────────────────┤
│         Browser Storage                 │
│  IndexedDB (primary) + LocalStorage     │
│  (settings/session)                     │
└─────────────────────────────────────────┘
```

## Core Modules

### store.js
Lightweight reactive state store. Coordinates Views, Modals, Drawers, and Table pagination/sorting. Provides `getState()`, `setState()`, and `subscribe()`.

### router.js
Hash-based router. Maps URL fragments to view render functions. Handles role-based route guards.

### db.js
IndexedDB wrapper. Provides async CRUD operations for all object stores. Handles database versioning and migrations.

### crypto.js
Web Crypto API helpers. PBKDF2 key derivation from user password. AES-GCM encryption/decryption for data at rest and import/export bundles.

## Data Model (IndexedDB Stores)

| Store | Key | Description |
|-------|-----|-------------|
| users | id | User accounts with hashed passwords, roles, lockout state |
| roles | id | Role definitions and permission sets |
| reservations | id | Visit reservations with time windows |
| permissions | id | Time-bound entry permissions linked to reservations |
| devices | id | Door/device registry |
| command_outbox | id | Queued device commands for offline fault tolerance |
| pois | id | Points of interest with feet-based coordinates |
| content | id | CMS content items with version history |
| reports | id | Compliance reports with evidence chains |
| audit_logs | id | Immutable audit trail entries |
| notifications | id | Notification inbox items |
| notification_templates | id | Templates with variable placeholders |

## Authentication & Sessions

- Local-only username/password authentication
- Password policy: min 12 chars, 1 upper, 1 lower, 1 number, 1 symbol
- PBKDF2 key derivation (100,000 iterations, SHA-256)
- 5 failed attempts → 15-minute account lockout
- Session token stored in LocalStorage
- 30-minute idle timeout; "Extend Session" prompt at 25 minutes
- All sensitive fields (password hashes, salts, device secrets) never rendered in UI

## Roles & Permissions

| Role | Access |
|------|--------|
| Visitor | Dashboard, Reservations (own), Map, Notifications |
| Operator | + Remote Unlock, all Reservations |
| Reviewer | + Content moderation, CMS review queue |
| Administrator | Full access, User management, Audit logs, Reports |

## Entry Permissions

- Auto-generated when a reservation is created
- Time window: 15 min before → 30 min after reservation start
- Single-use: consumed on first successful unlock
- Multi-use: up to 5 entries allowed
- Status badge: Active / Used / Expired / Pending

## Device Service Layer

- Simulated device integration via frontend Service layer
- Supports HTTP, MQTT, WebSocket adapters (local network only)
- ACK required within 2 seconds → else command enters queued state
- Retry every 10 seconds for up to 2 minutes
- Local command outbox persists queued commands in IndexedDB

## Venue Map

- SVG-based map with POI markers
- Coordinates in feet-based display
- Search modes: radius, administrative zone, polygon geofence
- Canvas overlay for drawing polygon geofences
- Route planning: suggested entry points + estimated walk time
- Configurable walk speed (default 3 mph), no external map providers

## Notification System

- In-app inbox for approvals, overdue items, missing materials
- Template engine with variable substitution: `{reservationId}`, `{doorName}`, etc.
- Scheduled reminders: 24h and 1h before reservation start
- Local retry: up to 3 attempts per notification
- Delivered/failed receipts shown in UI

## CMS Workflow

```
Draft → Review → Published → Archived
```
- Multilingual variants per content item
- Version history with diff view
- Rollback to any previous version

## Audit Trail

- Immutable entries written for all privileged actions
- Timestamp format: MM/DD/YYYY, 12-hour time (e.g., 04/02/2026, 02:30:00 PM)
- Fields: timestamp, actor ID, actor role, action, before snapshot, after snapshot

## Import/Export

- Browser-side Blob downloads and file pickers
- Optional AES-GCM encrypted JSON bundles
- Covers all IndexedDB stores for full backup/migration

## Deployment

- Docker: nginx:alpine serving `frontend/` as static files on port 8080
- No server-side processing required
