<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/temp/1

## Run Locally

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
