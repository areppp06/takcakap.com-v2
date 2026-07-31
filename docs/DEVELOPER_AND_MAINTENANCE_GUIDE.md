# TakCakap v2 — Developer & Maintenance Guide

This document provides a comprehensive technical reference for software engineers, backend developers, and system administrators maintaining or extending **TakCakap v2**.

---

## Table of Contents
1. [Technology Stack & System Architecture](#1-technology-stack--system-architecture)
2. [Codebase Map & Directory Structure](#2-codebase-map--directory-structure)
3. [Database Schema & Migration Engine](#3-database-schema--migration-engine)
4. [Backend Server Architecture & Middleware](#4-backend-server-architecture--middleware)
5. [Order Pipeline & Concurrency Control](#5-order-pipeline--concurrency-control)
6. [Curlec Payment Subsystem](#6-curlec-payment-subsystem)
7. [Lalamove Delivery Subsystem](#7-lalamove-delivery-subsystem)
8. [Real-Time SSE Stream & Event Bus](#8-real-time-sse-stream--event-bus)
9. [Loyalty, Points & Fraud Engine](#9-loyalty-points--fraud-engine)
10. [Frontend Architecture & State Management](#10-frontend-architecture--state-management)
11. [Testing Suite & Quality Assurance](#11-testing-suite--quality-assurance)
12. [Maintenance & Observability Playbook](#12-maintenance--observability-playbook)

---

## 1. Technology Stack & System Architecture

TakCakap v2 is built as a single-repository, modern web app with a decoupled API server and single-page client interface:

```
                          ┌────────────────────────────────────────────────────────┐
                          │                Client (Browser / PWA)                  │
                          │   React 18 + TypeScript + Vite + Tailwind CSS + PWA    │
                          └──────────────────────────┬─────────────────────────────┘
                                                     │ HTTP REST API / SSE
                                                     ▼
                          ┌────────────────────────────────────────────────────────┐
                          │               Express Node.js Backend API              │
                          │        (Port 3001, CJS, Prom-client, Web Push)         │
                          └──────┬──────────────┬──────────────┬──────────────┬────┘
                                 │              │              │              │
           ┌─────────────────────┴──┐    ┌──────┴──────┐ ┌─────┴──────┐ ┌─────┴──────────┐
           │     MariaDB / MySQL    │    │ Curlec API  │ │Lalamove API│ │ Cloudflare R2  │
           │  (Connection Pool +    │    │ (Payments & │ │(Delivery & │ │ (Images & CDN  │
           │ FOR UPDATE Row Locks)  │    │  Refunds)   │ │ Quotations)│ │    Storage)    │
           └────────────────────────┘    └─────────────┘ └────────────┘ └────────────────┘
```

- **Backend Runtime**: Node.js (v18/v20 LTS), CommonJS modules.
- **Web Framework**: Express.js 4.x.
- **Database Layer**: MariaDB / MySQL 8.x using `mysql2/promise` pool with explicit `FOR UPDATE` transaction locks.
- **Frontend Framework**: React 18, React Router v6, TypeScript 5, Vite 7, Tailwind CSS 3.
- **Media Storage**: Cloudflare R2 (S3-compatible bucket via `@aws-sdk/client-s3`).
- **Push Notifications**: WebPush VAPID (`web-push`) & Google Firebase Admin FCM.
- **Observability**: `prom-client` metrics endpoint (`/api/metrics`) and structured JSON logger.

---

## 2. Codebase Map & Directory Structure

```
takcakap.com-v2/
├── backend/
│   └── schema.sql                 # Base MariaDB schema definition
├── components/                    # React UI components (Nav, Alerts, PWA banner, Bridge)
│   ├── AdminOrderAlert.tsx        # Audio chime & alert popup for admin live orders
│   ├── NativeAppManager.tsx       # Android WebView bridge listener
│   └── PushNotificationManager.tsx# Browser WebPush VAPID subscription manager
├── contexts/                      # React Context providers for global application state
│   ├── AddressContext.tsx         # User saved addresses state
│   ├── AuthContext.tsx            # Auth session token & customer/admin user profile
│   ├── CartContext.tsx            # Shopping cart state & local persistence
│   └── CategoryContext.tsx        # Active category selection & menu filter
├── docs/                          # Comprehensive System Documentation
│   ├── DEPLOYMENT_AND_SETUP_GUIDE.md
│   ├── DEVELOPER_AND_MAINTENANCE_GUIDE.md
│   └── OPERATIONAL_GUIDE.md
├── pages/                         # React SPA page routes (28 pages: Customer & Admin)
│   ├── AdminDashboard.tsx         # Backoffice main metrics dashboard
│   ├── AdminOrders.tsx            # Live order management, status updates & refunds
│   ├── Checkout.tsx               # Customer checkout flow (Quotes, Curlec & Address pin)
│   └── PointsDashboard.tsx        # Customer loyalty points & voucher redemption portal
├── server/                        # Express Backend Node.js codebase
│   ├── config.js                  # Central configuration & startup env validation
│   ├── createApp.js               # Express application setup & static asset serving
│   ├── db.js                      # MariaDB connection pool & connection probe
│   ├── domain/
│   │   └── pointsPolicy.js        # Pure domain rules for point calculations & debt locks
│   ├── emailService.js            # Nodemailer SMTP transactional email worker
│   ├── index.js                   # Server entrypoint, route binding & migration check
│   ├── lalamoveService.js         # Lalamove v3 API client (HMAC signatures & quotes)
│   ├── lib/
│   │   ├── authTokens.js          # JWT signing & verification helpers
│   │   ├── money.js               # Minor unit (cents) currency math helpers
│   │   └── primitives.js          # Lat/lng, date formatting, and string primitives
│   ├── middleware/                # Express middleware pipeline
│   │   ├── apiAlias.js            # Legacy API URL alias remapping (/orders -> /api/orders)
│   │   ├── auth.js                # JWT & Admin role verification middleware
│   │   ├── bodyParser.js          # JSON & raw-body parsers (retains raw body for HMAC)
│   │   ├── cors.js                # Dynamic origin CORS delegate
│   │   └── rateLimit.js           # Auth & Webhook rate limiters
│   ├── migrationRunner.js         # Migration executor & schema version checker
│   ├── migrations/                # 13 sequential SQL database migration scripts (001-013)
│   ├── observability.js           # Prometheus metrics & structured JSON console logger
│   ├── pushService.js             # Web Push VAPID & Firebase FCM push notifications
│   ├── r2Service.js               # Cloudflare R2 image upload service
│   ├── routes/                    # Express domain route handlers
│   │   ├── adminCustomers.js      # Customer directory & account suspension
│   │   ├── adminSales.js          # Sales metrics & CSV export report generator
│   │   ├── auth.js                # Login, Register, Google OAuth & Me endpoints
│   │   ├── delivery.js            # Delivery options & quotation proxy
│   │   ├── menu.js                # Menu item CRUD & category management
│   │   ├── orders/                # Modularized order processing routes
│   │   │   ├── adminActions.js    # Status update, dispatch retry, cancel & refund
│   │   │   ├── adminList.js       # Admin paginated order search & filtering
│   │   │   ├── adminStream.js     # SSE order event stream router
│   │   │   ├── create.js          # Order creation pipeline with transaction locks
│   │   │   └── receipt.js         # PDF order receipt generator
│   │   ├── payments.js            # Curlec order initialization & checkout sessions
│   │   └── webhooks.js            # Curlec & Lalamove HMAC webhook endpoints
│   └── services/                  # Business logic services
│       ├── cartService.import.js  # Cart stock sync
│       ├── curlec.js              # Curlec session persistence & webhook reconciliation
│       ├── curlecClient.js        # Curlec Razorpay HTTP API client
│       ├── lalamoveHelpers.js     # Lalamove quote reservation & status mapping
│       ├── orders/                # Order code generation & event emitter
│       └── webhookInbox.js        # Webhook idempotency inbox reservation logic
├── services/                      # Frontend API client library
│   ├── api.ts                     # Type-safe Fetch wrapper for all backend endpoints
│   └── mockData.ts                # Standalone demo data
├── src/
│   └── sw.ts                      # Service Worker for PWA asset caching & web push
├── types.ts                       # Shared TypeScript interfaces & types
└── vite.config.ts                 # Vite bundler configuration & PWA plugin options
```

---

## 3. Database Schema & Migration Engine

### Database Pool (`server/db.js`)
Configured using `mysql2/promise`. Default connection limit is set to 10 connections.

### Migration Architecture (`server/migrationRunner.js` & `server/migrations/`)
Database schema evolution is managed via pure JavaScript migration scripts executed sequentially:
- `001_bootstrap_schema.js`: Core `users`, `categories`, `menu_items`, `orders`, `order_items`, `saved_addresses`.
- `002_curlec_checkout_sessions.js`: Curlec checkout session tracking.
- `003_order_items_foreign_key_set_null.js`: Soft deletion safety for menu items.
- `004_push_subscriptions.js`: WebPush VAPID subscriptions table.
- `005_add_short_code_to_orders.js`: Sequential short order code generation (`#A101`).
- `006_add_admin_fcm_tokens.js`: Admin mobile FCM push tokens.
- `007_add_category_active.js`: Category activation status.
- `008_loyalty_and_vouchers.js`: Loyalty points balances, transaction logs, vouchers.
- `009_update_vouchers_table.js`: Usage caps (`max_uses`) and times used tracking.
- `010_point_redemption_tiers.js`: Point redemption options table.
- `011_add_voucher_cooldown.js`: Voucher cooldown system setting.
- `012_points_hardening_and_curlec_only.js`: Points debt calculation & payment options.
- `013_delivery_booking_status.js`: Lalamove dispatch status & error logging columns.

**Creating a New Migration**:
1. Create a file `server/migrations/014_short_description.js`.
2. Export `id: 14` and an `up(connection)` function.
3. Add any schema changes inside `up(connection)`.
4. Startup validation will automatically apply the migration when the server boots.

---

## 4. Backend Server Architecture & Middleware

### Server Entry & Lifecycle (`server/index.js`)
1. Calls `createApp()` to configure Express middleware.
2. Registers domain route handlers.
3. Registers SPA fallback for client-side React routing.
4. Executes startup validations:
   - `validateStartupConfig()` verifies required `.env` values (JWT secret, API keys).
   - `assertNoPendingMigrations()` runs database migrations.
   - Starts email queue background worker (`emailService.startWorker()`).
   - Binds server to `HOST:PORT`.

### Key Middleware Stack (`server/middleware/`)
- `requestContextMiddleware`: Generates a unique `x-request-id` UUID for tracing.
- `bodyParser.js`: Uses `express.json()` with a custom `verify` option to preserve `req.rawBody` (essential for HMAC signature verification).
- `cors.js`: Validates request origin against configured `CORS_ORIGINS` in `.env`.
- `apiAlias.js`: Intercepts non-prefixed API routes (e.g. `/orders`) and aliases them to `/api/orders` while preventing browser document navigation loops.
- `rateLimit.js`: Implements window-based rate limiting on authentication and webhook endpoints.

---

## 5. Order Pipeline & Concurrency Control

Order creation (`server/routes/orders/create.js`) is the most critical pipeline in the application.

```
                    ┌─────────────────────────────────────────┐
                    │       POST /api/orders Request          │
                    └────────────────────┬────────────────────┘
                                         │
                                         ▼
                    ┌─────────────────────────────────────────┐
                    │      1. Validate Input & Curlec         │
                    │         Payment Proof (if paid)         │
                    └────────────────────┬────────────────────┘
                                         │
                                         ▼
                    ┌─────────────────────────────────────────┐
                    │      2. Begin MySQL Transaction         │
                    │       (connection.beginTransaction)     │
                    └────────────────────┬────────────────────┘
                                         │
                                         ▼
                    ┌─────────────────────────────────────────┐
                    │      3. Lock Menu Items & Stock         │
                    │         SELECT ... FOR UPDATE           │
                    └────────────────────┬────────────────────┘
                                         │
                                         ▼
                    ┌─────────────────────────────────────────┐
                    │      4. Validate Stock Availability     │
                    │         & Subtotal Price Calculation    │
                    └────────────────────┬────────────────────┘
                                         │
                                         ▼
                    ┌─────────────────────────────────────────┐
                    │      5. Validate Delivery Quote &       │
                    │         Voucher Spend Constraints       │
                    └────────────────────┬────────────────────┘
                                         │
                                         ▼
                    ┌─────────────────────────────────────────┐
                    │      6. Insert Order & Order Items      │
                    │         & Deduct Stock Atomic Update    │
                    └────────────────────┬────────────────────┘
                                         │
                                         ▼
                    ┌─────────────────────────────────────────┐
                    │      7. Commit MySQL Transaction        │
                    │           (connection.commit)           │
                    └────────────────────┬────────────────────┘
                                         │
                                         ▼
                    ┌─────────────────────────────────────────┐
                    │      8. Dispatch Lalamove Rider         │
                    │        (If orderType === Delivery)      │
                    └─────────────────────────────────────────┘
```

### Stock Deduction Guard
Stock is updated atomically using a strict guard clause:
```sql
UPDATE menu_items 
SET stock = stock - ? 
WHERE id = ? AND stock >= ?
```
If `affectedRows !== 1`, the transaction immediately rolls back, preventing negative inventory.

---

## 6. Curlec Payment Subsystem

Integrated in `server/services/curlec*.js` and `server/routes/payments.js`.

### Curlec Session Lifecycle
1. Frontend requests checkout initialization via `POST /api/payments/curlec/order`.
2. Server creates an entry in `curlec_checkout_sessions` with status `initiated`.
3. Customer completes payment via Razorpay/Curlec web modal.
4. Curlec issues a `payment.captured` webhook.

### Webhook Idempotency & Reconciliation (`server/services/webhookInbox.js`)
When Curlec sends a webhook to `POST /api/webhooks/curlec`:
1. Signature is verified using `x-razorpay-signature` and `CURLEC_WEBHOOK_SECRET`.
2. `reserveWebhookEventForProcessing()` inserts the `event_id` into `webhook_events`.
3. If the `event_id` already exists, the server returns HTTP `200 OK` with `{ ignored: true, reason: 'duplicate_event' }`.
4. Order status is updated, Curlec session is marked `consumed`, and points/emails are triggered.

---

## 7. Lalamove Delivery Subsystem

Integrated in `server/lalamoveService.js` and `server/services/lalamoveHelpers.js`.

### Authentication & HMAC Signature
Lalamove API v3 requires an HMAC-SHA256 signature on every HTTP request:
```
Signature = HMAC-SHA256(timestamp + "\r\n" + HTTP_METHOD + "\r\n" + REQUEST_PATH + "\r\n\r\n" + BODY_JSON, SECRET)
Header: Authorization: hmac KEY:TIMESTAMP:SIGNATURE
```

### Quotation Expiration & Auto-Refresh
Lalamove quotations expire after 5 minutes. During order creation (`create.js`), if a quotation is expired or invalid, the backend automatically calls `refreshDeliveryQuoteReservation()`, obtains a new quotation, updates the price/stop IDs, and proceeds with rider dispatch without failing the customer's checkout.

---

## 8. Real-Time SSE Stream & Event Bus

The admin live order dashboard communicates via Server-Sent Events (SSE):

### Connection Endpoint (`/api/admin/orders/stream`)
- Requires a short-lived stream token obtained via `POST /api/admin/orders/stream-token`.
- Standard Bearer token authentication in headers is enforced.
- Sends a heartbeat comment (`: ping`) every 25 seconds to keep reverse proxy connections alive.

### Internal Event Emitter (`server/services/orders/orderEvents.js`)
Whenever an order is created, status updated, or updated via Lalamove webhook, `emitOrdersChangedEvent()` broadcasts an event:
```json
{
  "source": "order_create",
  "orderId": 142,
  "reason": "created"
}
```
The admin frontend receives this event and triggers an immediate background order fetch and chime alert.

---

## 9. Loyalty, Points & Fraud Engine

Core rules are defined in `server/domain/pointsPolicy.js` and tested in `server/test_points_policy.js`.

- **Earnings Rate**: `POINTS_PER_RM = 10`.
- **Subtotal Rule**: Calculated as `Math.floor(foodSubtotal) * 10`. Service fee and delivery fee yield 0 points.
- **Clawback & Debt**: If an order is refunded/cancelled, points earned from that order are deducted. If `points_balance < 0`, the customer is in "points debt".
- **Voucher Lock**: `isVoucherUseBlockedByDebt(pointsBalance)` returns `true` if balance is negative. All voucher validation and redemption requests return HTTP `400 Bad Request` until debt is paid off.

---

## 10. Frontend Architecture & State Management

### Context State Management (`contexts/`)
- `AuthContext`: Tracks current customer JWT, user profile, admin status, and login/logout functions.
- `CartContext`: Manages items in cart, quantities, subtotal calculations, and synchronizes with browser `localStorage`.
- `AddressContext`: Stores saved customer delivery addresses.
- `CategoryContext`: Manages active category filter for the menu page.

### API Client Layer (`services/api.ts`)
Unified, type-safe API interface. Automatically attaches `Authorization: Bearer <token>` from `localStorage`. Includes a 502 Gateway Timeout recovery handler that prevents infinite reload loops on network blips.

---

## 11. Testing Suite & Quality Assurance

TakCakap v2 includes a comprehensive automated test suite.

### 1. Unit Test Suite (`npm run test:unit`)
Executes 6 isolated test modules:
```bash
node server/test_points_policy.js
node server/test_loyalty_e2e_logic.js
node server/test_config.js
node server/test_extraction_pure.js
node server/test_no_undef_scan.js
node server/test_app_smoke.js
```
- Tests points calculation math & debt rules.
- Tests config validation rules.
- Scans all 21 route files for undeclared free variables.
- Runs Express app smoke tests.

### 2. TypeScript Static Compilation Check
```bash
npx tsc --noEmit
```
Verifies zero type errors across all React pages, components, and services.

### 3. Production Bundle Build
```bash
npm run build
```
Compiles Vite client assets into `dist/` and generates service worker manifests.

---

## 12. Maintenance & Observability Playbook

### Database Backups & Restore
To perform a full MariaDB database backup:
```bash
# Dump database to file
mysqldump -u root -p takcakap > backup_takcakap_$(date +%F).sql

# Restore from backup
mysql -u root -p takcakap < backup_takcakap_2026-08-01.sql
```

### Log File Inspection
Logs are output in structured JSON format when `NODE_ENV=production`. Inspect logs via PM2:
```bash
pm2 logs takcakap-backend --json
```

### Prometheus Metrics Monitoring
Metrics are exposed at `GET /api/metrics`.
- If `METRICS_REQUIRE_AUTH=true`, pass header: `Authorization: Bearer <METRICS_AUTH_TOKEN>`.
- Metrics exported include: `http_requests_total`, `http_request_duration_seconds`, `orders_created_total`, `lalamove_dispatches_total`.

### Secret & Key Rotation
When rotating JWT secrets or API keys:
1. Update values in `.env`.
2. Restart the backend process (`pm2 restart takcakap-backend`).
3. Note: Active user JWT sessions will expire and require re-login after `JWT_SECRET` rotation.
