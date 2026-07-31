# TakCakap v2 — Operational & Production Guide

Welcome to the **TakCakap v2 Operational & Production Guide**. This document is written in plain English for store owners, restaurant managers, cashiers, and system operators. It explains what the system is, how it operates daily, all features available to customers and staff, how to manage shop settings, and what to do after the technical setup is finished.

---

## Table of Contents
1. [What is TakCakap?](#1-what-is-takcakap)
2. [Core Features & System Capabilities](#2-core-features--system-capabilities)
   - [Customer Experience](#customer-experience)
   - [Loyalty & Rewards Program](#loyalty--rewards-program)
   - [Admin Backoffice & Store Management](#admin-backoffice--store-management)
3. [Getting Started After Technical Setup](#3-getting-started-after-technical-setup)
   - [Step 1: Admin First Login](#step-1-admin-first-login)
   - [Step 2: Configure Store Details & Operating Hours](#step-2-configure-store-details--operating-hours)
   - [Step 3: Setup Categories & Menu Items](#step-3-setup-categories--menu-items)
   - [Step 4: Configure Payment & Delivery Toggles](#step-4-configure-payment--delivery-toggles)
   - [Step 5: Place a Test Order](#step-5-place-a-test-order)
4. [Day-to-Day Store Operations Manual](#4-day-to-day-store-operations-manual)
   - [Morning Opening Routine](#morning-opening-routine)
   - [Handling Incoming Orders](#handling-incoming-orders)
   - [Understanding Order Statuses](#understanding-order-statuses)
   - [Store Pickup Workflow](#store-pickup-workflow)
   - [Lalamove Delivery Workflow & Rider Tracking](#lalamove-delivery-workflow--rider-tracking)
   - [Handling Cancellations & Refunds](#handling-cancellations--refunds)
   - [Emergency Order Pause Switch](#emergency-order-pause-switch)
   - [Evening Closing Routine](#evening-closing-routine)
5. [Managing Loyalty, Points & Vouchers](#5-managing-loyalty-points--vouchers)
   - [How Customers Earn Points](#how-customers-earn-points)
   - [Redemption Tiers & Voucher Cooldowns](#redemption-tiers--voucher-cooldowns)
   - [Debt Clawback System](#debt-clawback-system)
   - [Manual Point Adjustments](#manual-point-adjustments)
6. [Sales Reports & Accounting](#6-sales-reports--accounting)
7. [Frequently Asked Questions (FAQ)](#7-frequently-asked-questions-faq)

---

## 1. What is TakCakap?

**TakCakap v2** is an all-in-one, full-stack online ordering system designed for single-restaurant or single-store food operations in Malaysia.

It provides a complete solution so your customers can order food online without paying heavy commission fees to third-party delivery platforms. The system handles everything:
- **Online Ordering Web Application (PWA)**: Works seamlessly on smartphones, tablets, and desktop computers.
- **Store Pickup & On-Demand Delivery**: Integrated directly with **Lalamove Malaysia** for automated rider dispatch and real-time delivery tracking.
- **Instant Online Payments**: Integrated with **Curlec by Razorpay** for secure payments via DuitNow FPX online banking, Credit/Debit cards, and e-wallets.
- **Live Admin Operations Dashboard**: Gives your kitchen and management staff real-time notifications (with chime sounds) whenever a new order arrives.
- **Customer Loyalty Program**: Built-in points program and discount vouchers to encourage repeat customer orders.

---

## 2. Core Features & System Capabilities

### Customer Experience
- **Interactive Menu Browsing**: Customers can filter food items by category (e.g. Rice, Drinks, Desserts), search by keyword, view high-resolution food images, and see real-time stock availability.
- **Address Book & Location Pin-Picker**: Saved delivery addresses with latitude/longitude pin-point accuracy for precise Lalamove delivery quotes.
- **Flexible Order Types**:
  - **Self-Pickup**: Customer picks up directly at your store with zero delivery fees.
  - **Lalamove Delivery**: On-demand motorcycle or car delivery to the customer's door.
- **Instant Payment Options**:
  - **Curlec Online Payment**: Secure checkout using FPX online banking or cards.
  - **Cash on Delivery / Pickup**: Pay at store or upon delivery (if enabled by admin).
- **Scheduled & Now Deliveries**: Customers can order immediately ("NOW") or schedule an order for later in the day.
- **Live Order Tracking**: Real-time progress bar (Pending ➔ Preparing ➔ Finding Rider ➔ On The Way ➔ Completed) with live Lalamove driver tracking map link.
- **Fast Reordering & Order History**: One-click reorder from past order history, plus downloadable PDF receipts for tax records.
- **Progressive Web App (PWA)**: Customers can install the web app to their phone home screen with push notification support.

### Loyalty & Rewards Program
- **Points Earnings**: Customers automatically earn **10 points for every RM 1.00** spent on food subtotals.
- **Point Redemption Tiers**: Customers can convert earned points into discount vouchers (e.g., 500 points = RM 5 off).
- **Voucher Validation**: Supports percentage discounts (e.g., 10% off) or fixed amount discounts (e.g., RM 5 off) with minimum spend rules and expiration dates.
- **Fraud & Debt Protection**: If an order is refunded or cancelled after points were awarded, the system deducts points. If a user's points drop below zero, voucher redemptions are automatically locked until they pay off their points balance through new orders.

### Admin Backoffice & Store Management
- **Real-Time Live Order Stream (SSE)**: New orders pop up instantly on the admin screen without needing to refresh the browser page, accompanied by sound alerts.
- **One-Click Order Status Updates**: Easily progress orders from *Preparing* to *Waiting Pickup* or *Completed*.
- **Automated Delivery Dispatch**: When a Lalamove delivery order is placed, the system automatically requests a rider from Lalamove. If a rider search times out, admins can retry dispatch with a single click.
- **Automated & Manual Refunds**: Integrated Curlec refund engine allows admins to issue full or partial refunds directly back to the customer's payment method from the order details screen.
- **Menu & Stock Control**: Add new food items, update prices, change descriptions, upload food photos directly to Cloudflare R2 CDN storage, and update stock counts.
- **Store Opening Hours & Instant Pause**: Set regular opening and closing times, or activate the "Pause Orders" kill-switch if the kitchen is overwhelmed.
- **Customer Management**: View registered customer profiles, phone numbers, order count, and suspend abusive user accounts.
- **Sales Reporting & CSV Export**: Track total revenue, order counts, average order value, and download detailed CSV financial reports.

---

## 3. Getting Started After Technical Setup

Once your technical team or developer has finished installing the server and database, follow these 5 steps to configure your store for live operations:

### Step 1: Admin First Login
1. Open your web browser and navigate to: `https://your-domain.com/#/admin/login` (or `https://admin.your-domain.com`).
2. Log in using your configured **Admin Email** and **Admin Password** (set in your server `.env` file).
3. Upon successful login, you will land on the **Admin Dashboard**.

### Step 2: Configure Store Details & Operating Hours
1. In the admin sidebar navigation, click **Manage Shop** (`#/admin/shop`).
2. Update your store details:
   - **Store Name**: E.g., *TakCakap KL Sentral*
   - **Store Phone Number**: E.g., `+60123456789` (Required for Lalamove pickup contact).
   - **Store Address & Coordinates**: Ensure the store address and exact Latitude/Longitude are accurate. *Lalamove drivers use these coordinates as the pickup location.*
   - **Opening & Closing Hours**: E.g., `09:00` (9:00 AM) to `22:00` (10:00 PM). Orders placed outside these hours will be blocked automatically.
3. Click **Save Settings**.

### Step 3: Setup Categories & Menu Items
1. Click **Categories** (`#/admin/categories`):
   - Add your main food categories (e.g., *Main Dishes*, *Beverages*, *Sides*, *Desserts*).
   - Assign an icon name or emoji to each category.
2. Click **Menu Management** (`#/admin/menu`):
   - Click **Add New Item**.
   - Fill in: **Item Name**, **Category**, **Price (RM)**, **Description**, and initial **Stock Count** (e.g., `50`).
   - Upload a clear photo of the dish (PNG or JPEG file).
   - Toggle **Active** to `ON`.
   - Click **Save**.

### Step 4: Configure Payment & Delivery Toggles
1. Click **Delivery Options** (`#/admin/delivery-options`):
   - Enable **Store Pickup** if customers are allowed to pick up orders at your store.
   - Enable **Lalamove Delivery** if you want on-demand delivery.
2. Click **Payment Options** (`#/admin/payment-options`):
   - Enable **Curlec Online Payment** for online banking and card payments.
   - Set a **Service Fee** if applicable (e.g., RM 1.80 per order or RM 0.00).

### Step 5: Place a Test Order
1. Open an incognito browser window and visit your store frontend website: `https://your-domain.com`.
2. Register a customer account with your phone number.
3. Select an item, add it to your cart, select **Store Pickup** or **Delivery**, and complete checkout.
4. Verify that the order appears immediately on your **Admin Orders** screen with an audible chime alert!

---

## 4. Day-to-Day Store Operations Manual

### Morning Opening Routine
1. Open the Admin Panel on a tablet or desktop computer in the kitchen / cashier counter.
2. Go to **Orders** (`#/admin/orders`). Ensure the volume on your tablet/computer is turned **ON** so you hear incoming order audio alerts.
3. Go to **Menu Management** and update daily stock levels for items that have limited supply.
4. Verify that the **Pause Orders** switch is **OFF**.

### Handling Incoming Orders
1. When a new customer order arrives, an audio chime plays, and a new order card appears at the top of the **Admin Orders** list with status **`Preparing`** (or **`Pending`**).
2. Kitchen staff should prepare the food items listed on the order card.
3. You can click **Print Receipt** or **Download PDF Receipt** to print a hard copy for the kitchen line.

### Understanding Order Statuses

| Status | Order Type | What it Means | Next Action Required |
| :--- | :--- | :--- | :--- |
| **Pending** | All | Order received, awaiting kitchen confirmation. | Review items and start preparation. |
| **Preparing** | All | Food is actively being prepared in the kitchen. | Kitchen cooks the order. |
| **Waiting Pickup** | Store Pickup | Food is ready, packaged, waiting for customer arrival. | Hand food to customer when they present Order Code. |
| **Finding Rider** | Delivery | Food is preparing; Lalamove is searching for a nearby rider. | System automatically dispatches rider. |
| **On The Way** | Delivery | Lalamove rider has accepted or picked up the food. | Monitor tracking link if customer inquires. |
| **Completed** | All | Food delivered or picked up successfully. | Order finished. Points awarded to customer. |
| **Cancelled** | All | Order was cancelled by admin or delivery system. | Stock is restored; payment refunded if applicable. |

### Store Pickup Workflow
1. When food is packaged and ready at the counter, click the status dropdown on the order card and change it to **`Waiting Pickup`**.
2. When the customer arrives at your counter:
   - Ask for their **Short Order Code** (e.g., `#A102`) or customer name.
   - Verify the items in the bag match the order receipt.
   - Hand the package to the customer.
   - Click the status dropdown and change status to **`Completed`**.

### Lalamove Delivery Workflow & Rider Tracking
1. For delivery orders, the system automatically requests a rider from Lalamove as soon as the order is placed.
2. The order card will show the **Lalamove Status** (e.g., `ASSIGNING_DRIVER`, `ON_GOING`, `PICKED_UP`, `COMPLETED`).
3. You can click **Track Delivery** on the order card to open the live Lalamove GPS map.
4. **Handling Dispatch Failures**:
   - If Lalamove cannot find a rider (e.g., during heavy rain or peak hours), the delivery booking status will show `booking_failed`.
   - Click the yellow **Retry Lalamove Dispatch** button on the order card. The system will issue a fresh quotation and attempt to find a rider again.

### Handling Cancellations & Refunds
If a customer calls to cancel an order or an item is out of stock:
1. Click the order card in **Admin Orders**.
2. Click **Cancel Order**.
3. Confirm the cancellation prompt.
4. **What happens automatically**:
   - The order status changes to **`Cancelled`**.
   - Food item stock counts are automatically restored back to the menu.
   - If the order was paid via Curlec, the system automatically triggers a refund request to Curlec and records the refund status on the order card.
   - If a Lalamove rider was assigned, the system attempts to cancel the Lalamove booking (within the 5-minute free cancellation window).

### Emergency Order Pause Switch
If the kitchen becomes overwhelmed by in-store queue lines or peak hour demand:
1. Go to **Manage Shop** (`#/admin/shop`).
2. Toggle the **Pause Orders** switch to **`ON`**.
3. Customers visiting the website will see a message: *"We are currently paused for new orders. Please check back shortly."*
4. Once the kitchen catches up, toggle **Pause Orders** back to **`OFF`**.

### Evening Closing Routine
1. Verify all active orders are marked as **`Completed`** or **`Cancelled`**.
2. Go to **Sales Overview** (`#/admin/sales`).
3. Select date range **Today** and click **Download Sales Report (CSV)** for your daily accounting records.

---

## 5. Managing Loyalty, Points & Vouchers

### How Customers Earn Points
- Customers earn **10 points for every RM 1.00** spent on food subtotals.
- Points are awarded automatically when an order status reaches **`Completed`**.
- Delivery fees and service fees do *not* earn points.

### Redemption Tiers & Voucher Cooldowns
- Admins can define point redemption tiers in **Points Management** (`#/admin/points`):
  - Example Tier 1: 500 Points ➔ RM 5.00 Voucher
  - Example Tier 2: 1000 Points ➔ RM 12.00 Voucher
- To prevent voucher hoarding and abuse, the system enforces a configurable **Voucher Cooldown Period** (default: 24 hours). Once a customer redeems points for a voucher, they must wait until the cooldown expires before redeeming another voucher.

### Debt Clawback System
If a customer earns 500 points from a RM 50 order, but that order is later refunded or cancelled:
- The system automatically deducts 500 points from their account balance.
- If the customer had already spent those points, their balance will become **negative** (e.g. `-300 points`).
- **Safety Lock**: Customers with a negative points balance are blocked from using or redeeming vouchers until their balance returns to 0 or positive through future completed orders.

### Manual Point Adjustments
Admins can manually grant or deduct points for customer service reasons:
1. Go to **Points Management** ➔ **User Balances**.
2. Search for the customer by name or email.
3. Click **Adjust Points**.
4. Select **Add** or **Deduct**, enter the point amount, and enter a reason (e.g., *"Customer complaint compensation"*).

---

## 6. Sales Reports & Accounting

TakCakap provides clear financial visibility for store owners:
1. Go to **Admin Sales** (`#/admin/sales`).
2. View metrics:
   - **Total Gross Revenue**: Total money collected from all orders.
   - **Total Completed Orders**: Number of successfully fulfilled orders.
   - **Average Order Value (AOV)**: Average amount spent per order.
   - **Delivery vs Pickup Breakdown**: Revenue split between delivery and store pickup.
3. **CSV Export**: Click **Download CSV** to export raw sales records (including Order Code, Date, Customer Name, Subtotal, Delivery Fee, Discount, Payment Method, and Status) directly into Microsoft Excel or Google Sheets.

---

## 7. Frequently Asked Questions (FAQ)

#### Q1: What should I do if a customer enters the wrong delivery address?
If the order is still in `Preparing` and no Lalamove rider has picked up the food, cancel the order in the Admin panel and ask the customer to place a new order with the correct address pin.

#### Q2: What happens if a food item runs out of stock during the day?
Go to **Menu Management**, find the item, and set its **Stock** to `0` or toggle **Active** to `OFF`. It will immediately show as "Out of Stock" on the customer website.

#### Q3: Why didn't a customer receive points for their order?
Points are only awarded when the order status is manually or automatically marked as **`Completed`**. Check if the order is still stuck in `Preparing` or `Waiting Pickup`.

#### Q4: How do audio alerts work for new orders?
Browser policies require staff to click anywhere on the Admin Orders page at least once after opening it to allow audio playback. Ensure your tablet volume is up and the tab remains active.
