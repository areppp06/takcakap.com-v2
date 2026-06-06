# Project: TakCakap - Lalamove API Integration Handover

## 1. Project Overview
TakCakap is a full-stack food delivery application featuring a User Portal (ordering) and an Admin Portal (dashboard/management).
*   **Frontend:** React 18, Tailwind CSS, React Router v6, Leaflet Maps.
*   **Backend:** Node.js (Express), MariaDB (MySQL compatible).
*   **Current State:** The app currently supports a "Hybrid Mode" where it can run entirely in the browser using Mock Data/LocalStorage OR connect to a real Node.js/MariaDB backend via a toggle in the Admin Dashboard.

## 2. Immediate Task: Lalamove API Integration
The primary goal is to integrate **Lalamove v3 API** for on-demand delivery fulfillment. This requires backend-side implementation due to **HMAC-SHA256 Authentication**.

### Security Requirement
*   **NEVER** expose `LALAMOVE_API_SECRET` or HMAC generation logic on the frontend.
*   All Lalamove calls must be proxied through the Node.js backend.

## 3. Architecture & Data Flow

### A. Database Schema Changes (MariaDB)
The `orders` table needs to be expanded to support external delivery providers.
**Required Columns:**
*   `delivery_provider`: ENUM('Internal', 'Lalamove')
*   `external_order_id`: VARCHAR (Lalamove Order ID)
*   `quotation_id`: VARCHAR (Required to place order)
*   `tracking_url`: TEXT (ShareLink for user tracking)
*   `driver_id`: VARCHAR

### B. Backend Implementation (Node.js)
**1. Service Layer (`services/lalamoveService.js`)**
*   Implement HMAC Signature Generation: `Signature = HmacSHA256(TIMESTAMP + METHOD + PATH + BODY, SECRET)`
*   Headers required: `Authorization: hmac {KEY}:{TIMESTAMP}:{SIGNATURE}`, `Market: {ISO_CODE}`, `Request-ID`.

**2. API Endpoints (`server/index.js` or `routes/delivery.js`)**
*   `POST /api/delivery/quote`:
    *   Accepts: `pickupLocation` (Store fixed lat/lng), `dropoffLocation` (User lat/lng).
    *   Calls Lalamove `POST /v3/quotations`.
    *   Returns: `totalPrice`, `quotationId`.
*   `POST /api/orders` (Update existing):
    *   If `orderType === 'Delivery'`, use the `quotationId` to call Lalamove `POST /v3/orders`.
    *   Save `orderId` and `shareLink` to database.
*   `POST /api/webhooks/lalamove`:
    *   Handle events: `ORDER_STATUS_CHANGED`, `DRIVER_ASSIGNED`.
    *   Update local `orders` table status.

### C. Frontend Integration
**1. Checkout Page (`pages/Checkout.tsx`)**
*   Replace static delivery fee ($5.00) with dynamic fetching.
*   Call internal endpoint `/api/delivery/quote` when address is selected.
*   Pass `quotationId` to the order creation payload.

**2. Order History (`pages/OrderHistory.tsx`)**
*   Display "Track Driver" button if `tracking_url` exists.
*   Map Lalamove statuses (`ASSIGNING_DRIVER`, `ON_GOING`, `PICKED_UP`) to app UI.

## 4. Environment Variables
The next environment must have `.env` configured with:
```env
LALAMOVE_API_KEY=pk_test_...
LALAMOVE_API_SECRET=sk_test_...
LALAMOVE_MARKET=MY  # e.g., MY, SG, PH
LALAMOVE_BASE_URL=https://rest.sandbox.lalamove.com
```

## 5. Mock Data / Simulation
If working in an environment without immediate API credentials:
*   Mock the backend response for `/api/delivery/quote` to return a static price and a fake UUID for `quotationId`.
*   Mock the webhook trigger to simulate driver assignment after 10 seconds.

## 6. Current File Structure
*   `server/index.js`: Main entry point for backend.
*   `backend/schema.sql`: Database definition.
*   `pages/Checkout.tsx`: Frontend logic needing the Quote API hook.
*   `services/api.ts`: Frontend API layer (needs new methods for `getQuote`).

Good luck, Agent Codex 5.3! 🚀
