# TakCakap v2 — Deployment & Setup Guide

This guide provides end-to-end, step-by-step instructions for deploying **TakCakap v2** to both local development environments and production Linux servers (VPS / Dedicated / Docker).

---

## Table of Contents
1. [System Requirements](#1-system-requirements)
2. [Local Development Setup](#2-local-development-setup)
3. [Environment Variables Reference Table](#3-environment-variables-reference-table)
4. [Production Deployment Guide (Ubuntu / Linux + Nginx + PM2)](#4-production-deployment-guide-ubuntu--linux--nginx--pm2)
   - [Step 1: Server Preparation & Firewall](#step-1-server-preparation--firewall)
   - [Step 2: MariaDB Database Setup](#step-2-mariadb-database-setup)
   - [Step 3: Clone Codebase & Install Dependencies](#step-3-clone-codebase--install-dependencies)
   - [Step 4: Configure Production `.env`](#step-4-configure-production-env)
   - [Step 5: Run Database Migrations](#step-5-run-database-migrations)
   - [Step 6: Build Frontend & Start Node Process with PM2](#step-6-build-frontend--start-node-process-with-pm2)
   - [Step 7: Configure Nginx & SSL (Certbot)](#step-7-configure-nginx--ssl-certbot)
5. [Docker Deployment Guide (Alternative)](#5-docker-deployment-guide-alternative)
6. [External Integrations Setup Guide](#6-external-integrations-setup-guide)
   - [A. Curlec (Razorpay MY) Payment Gateway](#a-curlec-razorpay-my-payment-gateway)
   - [B. Lalamove Delivery API v3](#b-lalamove-delivery-api-v3)
   - [C. Cloudflare R2 / AWS S3 CDN Storage](#c-cloudflare-r2--aws-s3-cdn-storage)
   - [D. WebPush VAPID Key Generation](#d-webpush-vapid-key-generation)
   - [E. Google OAuth 2.0 Login](#e-google-oauth-20-login)
   - [F. SMTP Transactional Emails](#f-smtp-transactional-emails)
7. [Post-Deployment Verification Checklist](#7-post-deployment-verification-checklist)

---

## 1. System Requirements

### Hardware Sizing (Recommended Minimum)
- **CPU**: 2 vCPU Cores
- **RAM**: 2 GB RAM (4 GB recommended for high flash-sale traffic)
- **Disk**: 20 GB SSD storage
- **Operating System**: Ubuntu 22.04 LTS or Ubuntu 24.04 LTS

### Software Dependencies
- **Node.js**: v18.x or v20.x LTS
- **Package Manager**: npm 9+
- **Database Engine**: MariaDB 10.6+ or MySQL 8.0+
- **Web Server & Reverse Proxy**: Nginx 1.18+
- **Process Manager**: PM2 (`npm install -g pm2`)
- **SSL Certificates**: Certbot (Let's Encrypt)

---

## 2. Local Development Setup

Follow these steps to set up TakCakap v2 on your local development machine:

### Prerequisites
1. Install [Node.js v20 LTS](https://nodejs.org).
2. Install [MariaDB Server](https://mariadb.org/download/) or MySQL Server locally.

### Step-by-Step Setup
1. **Clone the Repository**:
   ```bash
   git clone https://github.com/your-org/takcakap.com-v2.git
   cd takcakap.com-v2
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Configure Local `.env` File**:
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and set your local database credentials:
   ```env
   NODE_ENV=development
   PORT=3001
   DB_HOST=127.0.0.1
   DB_USER=root
   DB_PASSWORD=your_local_password
   DB_NAME=takcakap
   JWT_SECRET=super_secret_local_jwt_key_at_least_32_characters_long
   ```

4. **Create Database & Run Migrations**:
   Log into your local MariaDB shell and create the database:
   ```sql
   CREATE DATABASE takcakap CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```
   Then run the automated database migration tool:
   ```bash
   npm run db:migrate
   ```

5. **Start Development Servers**:
   Start both the Express API server and the Vite React development server concurrently:
   ```bash
   npm start
   ```
   - **Customer & Admin Web App**: `http://localhost:3000`
   - **Backend Express API**: `http://localhost:3001`

6. **Run Unit Tests**:
   Verify everything is working cleanly:
   ```bash
   npm run test:unit
   ```

---

## 3. Environment Variables Reference Table

Below is the complete reference of all environment variables used by TakCakap v2:

| Variable Name | Required | Default Value | Description / Purpose |
| :--- | :---: | :---: | :--- |
| `NODE_ENV` | Yes | `development` | Set to `production` in live environments. |
| `PORT` | Yes | `3001` | Internal HTTP port for Express backend API. |
| `HOST` | Yes | `0.0.0.0` | Network IP interface binding. |
| `PUBLIC_APP_URL` | **Yes (Prod)**| `https://yourdomain.com` | Absolute public domain URL used in emails and redirects. |
| `DB_HOST` | Yes | `localhost` | MariaDB / MySQL database host IP or hostname. |
| `DB_PORT` | No | `3306` | MariaDB database port. |
| `DB_USER` | Yes | `root` | MariaDB database user. |
| `DB_PASSWORD` | Yes | `""` | MariaDB database user password. |
| `DB_NAME` | Yes | `takcakap` | MariaDB database schema name. |
| `JWT_SECRET` | **Yes** | — | Min 32-character secret key for signing user auth tokens. |
| `ADMIN_EMAIL` | Yes | `admin@yourdomain.com` | Primary admin login email. |
| `ADMIN_PASSWORD` | **Yes (Prod)**| — | Primary admin login password. Must be secure. |
| `CORS_ORIGINS` | **Yes (Prod)**| — | Comma-separated list of allowed HTTPS origins. |
| `CURLEC_KEY_ID` | Optional | — | Curlec (Razorpay MY) API Key ID (`rzp_test_...` / `rzp_live_...`). |
| `CURLEC_KEY_SECRET` | Optional | — | Curlec API Key Secret. |
| `CURLEC_WEBHOOK_SECRET` | Optional | — | Curlec webhook HMAC secret. |
| `LALAMOVE_API_KEY` | Optional | — | Lalamove API Key (`pk_test_...` / `pk_prod_...`). |
| `LALAMOVE_API_SECRET` | Optional | — | Lalamove API Secret key (`sk_test_...` / `sk_prod_...`). |
| `LALAMOVE_WEBHOOK_SECRET` | Optional | — | Lalamove webhook signature secret. |
| `R2_ACCOUNT_ID` | Optional | — | Cloudflare R2 Account ID. |
| `R2_ACCESS_KEY_ID` | Optional | — | Cloudflare R2 / S3 Access Key ID. |
| `R2_SECRET_ACCESS_KEY` | Optional | — | Cloudflare R2 / S3 Secret Access Key. |
| `R2_BUCKET_NAME` | Optional | — | Cloudflare R2 Bucket name (e.g. `takcakap-assets`). |
| `R2_PUBLIC_URL_PREFIX` | Optional | — | Cloudflare R2 CDN domain (e.g. `https://cdn.yourdomain.com`). |
| `VAPID_PUBLIC_KEY` | Optional | — | WebPush VAPID public key. |
| `VAPID_PRIVATE_KEY` | Optional | — | WebPush VAPID private key. |
| `SMTP_HOST` | Optional | — | SMTP mail server hostname (e.g., `smtp.mailspace.id`). |
| `SMTP_PORT` | Optional | `465` | SMTP server port (`465` for SSL, `587` for TLS). |
| `SMTP_USER` | Optional | — | SMTP username / email address. |
| `SMTP_PASS` | Optional | — | SMTP password. |
| `SMTP_FROM_EMAIL` | Optional | — | Sender email address for order notifications. |
| `GOOGLE_CLIENT_ID` | Optional | — | Google OAuth 2.0 Web Client ID. |

---

## 4. Production Deployment Guide (Ubuntu / Linux + Nginx + PM2)

### Step 1: Server Preparation & Firewall
Log into your clean Ubuntu server via SSH:
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential ufw nginx mariadb-server

# Configure UFW Firewall
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

### Step 2: MariaDB Database Setup
1. Secure the MariaDB installation:
   ```bash
   sudo mysql_secure_installation
   ```
2. Log into MariaDB console:
   ```bash
   sudo mysql -u root -p
   ```
3. Create database and dedicated database user:
   ```sql
   CREATE DATABASE takcakap_prod CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'takcakap_user'@'localhost' IDENTIFIED BY 'Strong_DB_Password_Here_9823#';
   GRANT ALL PRIVILEGES ON takcakap_prod.* TO 'takcakap_user'@'localhost';
   FLUSH PRIVILEGES;
   EXIT;
   ```

### Step 3: Clone Codebase & Install Dependencies
1. Install Node.js 20 LTS:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt install -y nodejs
   sudo npm install -g pm2
   ```
2. Clone repository to `/var/www/takcakap`:
   ```bash
   sudo mkdir -p /var/www/takcakap
   sudo chown -R $USER:$USER /var/www/takcakap
   git clone https://github.com/your-org/takcakap.com-v2.git /var/www/takcakap
   cd /var/www/takcakap
   npm install --production=false
   ```

### Step 4: Configure Production `.env`
Create `/var/www/takcakap/.env`:
```env
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
PUBLIC_APP_URL=https://yourdomain.com

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=takcakap_user
DB_PASSWORD=Strong_DB_Password_Here_9823#
DB_NAME=takcakap_prod

JWT_SECRET=production_random_jwt_secret_key_make_it_very_long_64_chars_min
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=ComplexAdminPass_2026!
CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com,https://admin.yourdomain.com

# Curlec Production Keys
CURLEC_KEY_ID=rzp_live_...
CURLEC_KEY_SECRET=...
CURLEC_WEBHOOK_SECRET=curlec_webhook_sec_...

# Lalamove Production Keys
LALAMOVE_API_KEY=pk_prod_...
LALAMOVE_API_SECRET=sk_prod_...
LALAMOVE_WEBHOOK_SECRET=lalamove_webhook_sec_...
```

### Step 5: Run Database Migrations
Run the automated schema migrations to create all production tables:
```bash
npm run db:migrate
```

### Step 6: Build Frontend & Start Node Process with PM2
1. Build the Vite production bundle:
   ```bash
   npm run build
   ```
2. Start the Express server process with PM2:
   ```bash
   pm2 start server/index.js --name "takcakap-api"
   pm2 save
   pm2 startup
   ```

### Step 7: Configure Nginx & SSL (Certbot)
1. Create Nginx configuration `/etc/nginx/sites-available/takcakap`:
   ```nginx
   server {
       server_name yourdomain.com www.yourdomain.com;

       root /var/www/takcakap/dist;
       index index.html;

       # Serve static compiled Vite assets with caching
       location /assets/ {
           alias /var/www/takcakap/dist/assets/;
           expires 30d;
           add_header Cache-Control "public, no-transform";
       }

       # Proxy API requests to Express backend
       location /api/ {
           proxy_pass http://127.0.0.1:3001;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_cache_bypass $http_upgrade;
       }

       # SSE Stream Proxy Configuration (Disable buffering)
       location /api/admin/orders/stream {
           proxy_pass http://127.0.0.1:3001;
           proxy_http_version 1.1;
           proxy_set_header Connection '';
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_buffering off;
           proxy_read_timeout 86400s;
       }

       # SPA Fallback for client routes
       location / {
           try_files $uri $uri/ /index.html;
       }
   }
   ```

2. Enable site and test configuration:
   ```bash
   sudo ln -s /etc/nginx/sites-available/takcakap /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl reload nginx
   ```

3. Obtain Let's Encrypt SSL Certificate:
   ```bash
   sudo apt install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
   ```

---

## 5. Containerized Deployment Guide (Docker & Docker Compose)

TakCakap v2 includes a fully supported production-ready `Dockerfile` and `docker-compose.yml`.

### Docker vs. Native PM2 Comparison
- **Native PM2 + Nginx (Recommended for single small VPS)**: Offers maximum performance, lowest RAM overhead on 1GB–2GB VPS instances, direct MariaDB file backups, and seamless Nginx SSE streaming.
- **Docker Compose (Recommended for Container Infrastructures)**: Ideal for container platforms (e.g. AWS ECS, GCP Cloud Run, Kubernetes), multi-tenant environments, or team workflows requiring identical containerized environments.

### Running with Docker Compose
1. Ensure `.env` is configured.
2. Build and launch containers:
   ```bash
   docker compose up -d --build
   ```
3. Docker will launch:
   - **Backend API container** running Node.js on port `3001`.
   - **MariaDB database container** on port `3306`.

---

## 5.1 Automated Updates, Crash Recovery & One-Click Deployments

Both **PM2** and **Docker** provide automatic crash recovery and one-command deployment updates:

### A. Crash Recovery & Auto-Restart Comparison

| Capability | Native PM2 Setup | Docker Compose Setup |
| :--- | :--- | :--- |
| **Crash Recovery** | `pm2` automatically restarts Node.js in `<100ms` if an unhandled crash occurs. | `restart: always` in `docker-compose.yml` automatically restarts container. |
| **Server Reboot Recovery** | `pm2 startup` configures systemd to automatically relaunch the app when server reboots. | Docker daemon automatically starts `restart: always` containers on boot. |
| **Zero-Downtime Updates** | `pm2 reload takcakap-api` reloads app worker without dropping active HTTP connections. | `docker compose up -d --build` performs rolling container replacement. |

### B. One-Command Update Scripts

#### 1. One-Click PM2 Update Command
Run this single command on your server whenever you pull new code updates:
```bash
git pull origin main && npm install --production=false && npm run db:migrate && npm run build && pm2 reload takcakap-api
```

#### 2. One-Click Docker Compose Update Command
Run this single command on your server for Docker updates:
```bash
git pull origin main && docker compose up -d --build
```

### C. Automated CI/CD (GitHub Actions / Webhook)
You can configure a GitHub Action to deploy code automatically every time you push to `main`:
```yaml
# .github/workflows/deploy.yml
name: One-Click Production Deploy
on:
  push:
    branches: [ main ]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to Server via SSH
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd /var/www/takcakap
            git pull origin main
            npm install --production=false
            npm run db:migrate
            npm run build
            pm2 reload takcakap-api
```

---

## 6. External Integrations Setup Guide

### A. Curlec (Razorpay MY) Payment Gateway
1. Sign up at [Curlec Dashboard](https://curlec.com).
2. Generate API Keys in **Settings ➔ API Keys**.
3. Set `CURLEC_KEY_ID` and `CURLEC_KEY_SECRET` in `.env`.
4. Go to **Settings ➔ Webhooks**:
   - Webhook URL: `https://yourdomain.com/api/webhooks/curlec`
   - Secret: Enter a random secret string and set as `CURLEC_WEBHOOK_SECRET` in `.env`.
   - Events: Select `payment.captured`, `refund.processed`, `refund.failed`.

### B. Lalamove Delivery API v3
1. Register a developer account at [Lalamove Partner Portal](https://partner.lalamove.com).
2. Generate API Key and API Secret.
3. Set `LALAMOVE_API_KEY` and `LALAMOVE_API_SECRET` in `.env`.
4. Configure Webhook URL in Lalamove Portal:
   - Webhook URL: `https://yourdomain.com/api/webhooks/lalamove`

### C. Cloudflare R2 / AWS S3 CDN Storage
1. In Cloudflare Dashboard, navigate to **R2 ➔ Create Bucket** (`takcakap-assets`).
2. Manage R2 API Tokens ➔ Create Access Key with Read/Write permissions.
3. Connect a custom domain (e.g., `cdn.yourdomain.com`) to the bucket.
4. Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, and `R2_PUBLIC_URL_PREFIX` in `.env`.

### D. WebPush VAPID Key Generation
To enable browser web push notifications, generate VAPID keys using `web-push`:
```bash
npx web-push generate-vapid-keys
```
Copy the generated keys into `.env`:
```env
VAPID_PUBLIC_KEY=BJxGp...
VAPID_PRIVATE_KEY=x2L...
```

### E. Google OAuth 2.0 Login
1. Go to [Google Cloud Console](https://console.cloud.google.com) ➔ APIs & Services ➔ Credentials.
2. Create an **OAuth 2.0 Client ID** (Web application).
3. Authorized JavaScript origins: `https://yourdomain.com`.
4. Set `GOOGLE_CLIENT_ID` in `.env`.

### F. SMTP Transactional Emails
Set your email SMTP provider details (e.g. SendGrid, Mailspace, Mailgun) in `.env`:
```env
SMTP_HOST=smtp.mailspace.id
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=no-reply@yourdomain.com
SMTP_PASS=Your_SMTP_Password
SMTP_FROM_NAME=yourdomain.com
SMTP_FROM_EMAIL=no-reply@yourdomain.com
```

---

## 7. Post-Deployment Verification Checklist

After deploying to production, complete this 7-point checklist:

- [ ] **Health Endpoint Check**: Open `https://yourdomain.com/api/health` in your browser. Verify it returns `{"status":"ok"}`.
- [ ] **Database Connection Check**: Inspect PM2 logs (`pm2 logs takcakap-api`) to confirm `✅ Successfully connected to MariaDB/MySQL database!`.
- [ ] **Admin Login Check**: Navigate to `https://yourdomain.com/#/admin/login` and log in with your admin credentials.
- [ ] **Store Setup Check**: Set shop operating hours, store phone, and latitude/longitude in **Manage Shop**.
- [ ] **Test Customer Order**: Place a real test order on `https://yourdomain.com` using Curlec sandbox/live and verify order receipt.
- [ ] **SSE Stream Check**: On the Admin Orders page, verify the connection status displays **"Live Connected"**.
- [ ] **Unit Test Verification**: Run `npm run test:unit` on the server to verify zero regression errors.
