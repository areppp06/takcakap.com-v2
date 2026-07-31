<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# TakCakap v2 — Full Stack Single Restaurant Ordering System

TakCakap v2 is a professional, full-stack food delivery and restaurant management system built for single-restaurant operations in Malaysia. It features automated Lalamove delivery fulfillment, Curlec (Razorpay MY) payment gateway integration, real-time admin order board via SSE, and a customer loyalty points program.

---

## 📚 Official Documentation Suite

Comprehensive, professional documentation is available in the [`docs/`](docs/) directory:

1. **[Operational & Production Guide](docs/OPERATIONAL_GUIDE.md)**
   - Plain English guide for store owners, managers, and cashiers.
   - Explains what the system is, core features, day-to-day store operations, managing orders, refunds, opening/closing hours, pause switch, loyalty points, vouchers, and sales CSV exports.

2. **[Developer & Maintenance Guide](docs/DEVELOPER_AND_MAINTENANCE_GUIDE.md)**
   - Complete technical reference for software engineers and maintainers.
   - Codebase structure, Express architecture, MariaDB `FOR UPDATE` transaction locks, migration runner, Curlec & Lalamove state machines, SSE stream bus, unit testing, and maintenance playbook.

3. **[Deployment & Setup Guide](docs/DEPLOYMENT_AND_SETUP_GUIDE.md)**
   - Professional end-to-end setup guide for local dev and production servers.
   - Hardware requirements, complete `.env` reference table, Ubuntu + Nginx + PM2 + SSL (Certbot) setup, Docker deployment, and API integrations setup (Curlec, Lalamove, Cloudflare R2, VAPID WebPush, SMTP, Google OAuth).

---

## Quick Start (Local Development)


**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Start backend + frontend together (separate ports, no Vite API proxy):
   `npm start`
   - Backend: `:3001`
   - Frontend: `:3000`
   - API base: uses `VITE_API_BASE_URL` from `.env`
3. Start backend only (production style):
   `npm run start:prod`
4. Frontend-only dev server (with proxy):
   `npm run dev`

## Critical E2E Safety Test

Run this before production deploy:

- `npm test`

This executes `server/webhook_sim_runner.js` and validates end-to-end critical flows against your real DB with an isolated local app instance:

- Curlec `payment.captured` webhook reconciliation -> order creation
- Lalamove webhook signature + status transition update
- Admin SSE security (`Authorization` header required, query token rejected)
- Admin SSE `orders_changed` emission for:
  - order create
  - admin status update
  - lalamove webhook update

If any critical flow breaks, the script exits non-zero and deployment should be blocked.

## LAN / Domain Configuration

Set these values in `.env` as needed:

- `HOST=0.0.0.0` and `PORT=3001` for backend bind/port
- `VITE_DEV_HOST=0.0.0.0` and `VITE_DEV_PORT=3000` for Vite dev bind/port
- `VITE_API_BASE_URL=/api` for same-domain API routing
- `VITE_API_PROXY_TARGET=http://127.0.0.1:3001` for local dev proxy target
- `VITE_USE_DEV_PROXY=true|false` to enable/disable Vite proxy in dev
- `LALAMOVE_*` variables for Malaysia sandbox integration
- `STORE_*` variables for configurable pickup coordinates/address
- `ADMIN_EMAIL` and `ADMIN_PASSWORD` for admin panel email/password login
- `SMTP_*`, `SMTP_FROM_*`, and `PUBLIC_APP_URL` for transactional order emails

## Split Frontend/API Domain

If you deploy frontend and backend on different domains (for example `example.cloud` and `api.example.cloud`):

- Frontend `.env`:
  - `VITE_API_BASE_URL=https://api.example.cloud/api`
- Backend `.env`:
  - `CORS_ORIGINS=https://example.cloud,https://www.example.cloud`
- Keep Google login client ID the same on frontend and backend:
  - `VITE_GOOGLE_CLIENT_ID=...`
  - `GOOGLE_CLIENT_ID=...`

## Malaysia Defaults

- Lalamove market: `MY`
- Currency display: `MYR` (`RM`)

## Google Login Setup

1. Open Google Cloud Console -> API & Services -> Credentials.
2. Create an OAuth 2.0 Client ID with type `Web application`.
3. Add JavaScript origins:
   - `http://localhost:3000`
   - `https://example.cloud` (or your real frontend HTTPS domain)
4. Add authorized redirect URI (optional for GIS button flow, but safe to include):
   - `http://localhost:3000`
   - `https://example.cloud`
5. Copy the client ID and set in `.env`:
   - `GOOGLE_CLIENT_ID=...apps.googleusercontent.com`
   - `VITE_GOOGLE_CLIENT_ID=...apps.googleusercontent.com`
6. Restart backend and frontend after updating env:
   - `npm run server:dev`
   - `npm run dev`

## Admin Login

- Admin panel login URL: `/admin/login`
- Admin routes (`#/admin`, `#/admin/orders`, `#/admin/categories`, `#/admin/menu`) require an admin JWT session.
- Admin accounts are blocked from Google sign-in and must use `ADMIN_EMAIL` + `ADMIN_PASSWORD`.
