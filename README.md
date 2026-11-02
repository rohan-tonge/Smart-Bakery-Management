# Smart Bakery Management System

A production-ready ERP and e-commerce platform for artisanal and commercial bakeries, featuring customer storefront ordering, UPI and Razorpay payment processing, comprehensive inventory and recipe costing, production batch planning, and real-time operational analytics.

---

## Architecture Overview

```
smart-bakery-management/
├── client/                     # React 19 + Vite frontend
│   ├── src/
│   │   ├── api/client.js       # Centralized HTTP request client & token refresher
│   │   ├── components/         # Shared UI components (Navbar, Footer, etc.)
│   │   ├── context/            # AuthContext and CartContext
│   │   ├── pages/
│   │   │   ├── auth/           # Login & Registration pages
│   │   │   ├── customer/       # Customer orders & dashboard
│   │   │   ├── owner/          # Combined OwnerManagerDashboard
│   │   │   ├── production/     # ProductionStaffDashboard
│   │   │   └── public/         # Storefront (Home, Cart, Checkout, Track)
│   │   └── utils/              # Cart pricing & responsive utilities
│   ├── .env.example            # Client environment configuration template
│   └── vite.config.js          # Vite config with API dev proxy
├── server/                     # Node.js + Express + MongoDB backend
│   ├── docs/                   # API audit matrix & architectural specifications
│   ├── src/
│   │   ├── config/             # Zod-validated environment & MongoDB configuration
│   │   ├── controllers/        # Express route controllers
│   │   ├── middlewares/        # Auth, role authorization, rate-limit, error handlers
│   │   ├── models/             # Mongoose schemas & indexes
│   │   ├── routes/             # 146 registered /api/v1 endpoints
│   │   ├── services/           # Domain business logic (orders, inventory, costing, etc.)
│   │   ├── utils/              # Token utils, money formatting, logger
│   │   ├── validators/         # Zod request payload schemas
│   │   ├── app.js              # Express app setup, Helmet, CORS, raw body webhook parser
│   │   └── server.js           # HTTP server startup & graceful shutdown
│   ├── tests/                  # Integration test suite (101 automated scenarios)
│   └── .env.example            # Backend environment configuration template
└── README.md                   # This documentation
```

---

## Role Model & Authorization

The system enforces three primary operational roles with strict server-side access controls:

1. **`CUSTOMER`**:
   - Accesses public storefront, category browsing, cart, checkout, payment submission, and order tracking.
   - Accesses authenticated `/customer` portal for order history and profile management.
   - Strictly denied access to management, production, inventory, recipes, and cost data.

2. **`OWNER_MANAGER`** (Unified Management Role):
   - Accesses `/owner` ([`OwnerManagerDashboard`](client/src/pages/owner/OwnerManagerDashboard.jsx)).
   - Manages products, categories, variants, inventory lots, stock adjustments, and recipes.
   - Manages vendors, purchase orders, worker wage rates, and production batch scheduling.
   - Inspects financial costing, margin analysis, customer engagement, complaints, and operational alerts.
   - Performs manual UTR payment verification and status updates.
   - *Legacy compatibility*: Accepts legacy `OWNER` and `MANAGER` tokens and automatically maps them to appropriate management permissions. Requests to `/manager` redirect to `/owner`.

3. **`PRODUCTION_STAFF`**:
   - Accesses `/production` ([`ProductionStaffDashboard`](client/src/pages/production/ProductionStaffDashboard.jsx)).
   - Views assigned production batches and batch recipes/instructions.
   - Updates batch workflow states (`IN_PROGRESS`, `QUALITY_CHECK`, `COMPLETED`).
   - Records ingredient usage and packaging outputs.
   - Strictly denied supplier purchase costs, margins, profit analytics, and payment management.

---

## Getting Started

### Prerequisites

- **Node.js**: v20.x or v22.x LTS
- **MongoDB**: v6.x or v7.x running locally or via MongoDB Atlas
- **npm**: v10.x+

### 1. Backend Setup

```bash
cd server
npm install

# Create environment configuration from template
cp .env.example .env
```

Edit `server/.env` with your local settings. Minimum required variables for development:

```env
NODE_ENV=development
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/smart_bakery_db
MONGO_DB_NAME=smart_bakery_db
CORS_ORIGIN=http://localhost:5173
FRONTEND_URL=http://localhost:5173
ACCESS_TOKEN_SECRET=dev_access_token_secret_min_16_characters_long
REFRESH_TOKEN_SECRET=dev_refresh_token_secret_min_16_characters_long
COOKIE_SECRET=dev_cookie_signing_secret_min_16_characters_long
```

Start the backend server:

```bash
# Development with hot-reload
npm run dev

# Or production start
npm start
```

Verify backend health:
- Liveness check: `http://localhost:5000/api/v1/health`
- Readiness check: `http://localhost:5000/api/v1/health/ready`

### 2. Frontend Setup

```bash
cd ../client
npm install

# Create client environment configuration (optional in dev)
cp .env.example .env

# Start Vite development server
npm run dev
```

The storefront will be available at `http://localhost:5173`. Vite proxies `/api` requests to `http://localhost:5000`.

---

## Account Bootstrap & Administration

To maintain zero-trust security:
- The public registration endpoint (`POST /api/v1/auth/register`) strictly assigns the `CUSTOMER` role. Users cannot self-register as `OWNER_MANAGER` or `PRODUCTION_STAFF`.
- Initial administrative accounts are provisioned via administrative CLI or direct database seeding:

```javascript
// Example administrative user initialization script:
const bcrypt = require('bcryptjs');
const passwordHash = await bcrypt.hash('SecurePasswordHere!', 12);
await db.collection('users').insertOne({
  name: 'Head Baker / Owner',
  email: 'owner@smartbakery.com',
  password: passwordHash,
  role: 'OWNER_MANAGER',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date()
});
```

---

## Testing & Quality Assurance

### Run Backend Integration Tests

```bash
cd server
npm test
```
*Executes all 101 automated integration tests against an isolated `smart_bakery_db_test` database serially.*

### Run Frontend Unit Tests

```bash
cd client
node --test src/utils/cartPricing.test.js
```
*Validates cart line pricing derivation, legacy cart format compatibility, and unit price calculations.*

### Run Frontend Lint & Build

```bash
cd client
npm run lint    # Oxlint static analysis
npm run build   # Production Vite compilation
```

### Browser Acceptance Testing (Headless CDP)

Edge headless with Chrome DevTools Protocol (CDP) is used to inspect responsive views (375px, 430px, 768px, 1366px, 1920px) without third-party browser automation overhead:

```powershell
# Set credentials in PowerShell to execute authenticated journeys:
$env:BAKERY_TEST_OWNER_MANAGER_EMAIL = 'owner@example.com'
$env:BAKERY_TEST_OWNER_MANAGER_PASSWORD = 'password'
$env:BAKERY_TEST_STAFF_EMAIL = 'staff@example.com'
$env:BAKERY_TEST_STAFF_PASSWORD = 'password'
```

---

## Payments & Financial Safeguards

### Manual UPI Verification Workflow
- Customers submit payment proof via a manual UTR/reference number.
- **Critical Security Safeguard**: Submitting a UTR transitions the payment to `PENDING_VERIFICATION` and keeps the order in `PENDING_PAYMENT`. It **never** auto-confirms payment or releases orders.
- Only an authenticated user with `OWNER_MANAGER` or `OWNER` privileges can call `PATCH /api/v1/orders/:id/confirm-payment` after reconciling bank receipts.

### Razorpay Integration
- Optional payment gateway integration using Razorpay Test Mode (`rzp_test_...`).
- Raw request bodies are preserved for cryptographic webhook signature verification (`req.rawBody`).
- Webhook events are processed idempotently; duplicate events are discarded safely without re-crediting or duplicate status transitions.

---

## Production Deployment & Operations

### Cloud Deployment Guide (Vercel + Render + MongoDB Atlas)

This repository is pre-configured for a modern decoupled cloud deployment:

```
┌──────────────────────────┐         REST API / SSE        ┌──────────────────────────┐
│      Vercel (Client)     │ ────────────────────────────> │      Render (Server)     │
│  React 19 + Vite + PWA   │ <──────────────────────────── │   Node.js 20+ / Express  │
└──────────────────────────┘      Credentials: 'include'   └─────────────┬────────────┘
                                  SameSite=None; Secure                  │
                                                                         │ Mongoose (TLS)
                                                                         ▼
                                                           ┌──────────────────────────┐
                                                           │   MongoDB Atlas Cluster  │
                                                           │    (Replica Set / M0+)   │
                                                           └──────────────────────────┘
```

#### Step 1: Database Hosting on MongoDB Atlas
1. Sign in to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas).
2. Create a new project and provision a cluster (Free Tier M0 or dedicated).
3. **Database Access**: Create a dedicated database user (e.g. `bakery_app`) using SCRAM-SHA-256 authentication with least-privilege `readWrite` access restricted solely to the `smart_bakery_db` database (never grant cluster-wide administrative privileges like `atlasAdmin` to application services).
4. **Network Access (IP Access List Options)**:
   - **Option A (Dynamic Container IPs — Render Free / Starter Plans)**: Render web services on Free and Starter tiers run in dynamic containers with non-deterministic outbound IP addresses that rotate on each redeploy or container restart. In Atlas Network Access, add `0.0.0.0/0` (Allow Access from Anywhere) to permit dynamic outbound container connections. When using this option, network security relies on mandatory TLS encryption in transit, strict username/password SCRAM-SHA-256 authentication, and least-privilege database user scopes.
   - **Option B (Static Outbound IP Add-on — Render Team / Enterprise Plans)**: If organizational security policy prohibits `0.0.0.0/0`, provision Render's Static Outbound IP add-on (or VPC Peering / AWS PrivateLink for dedicated clusters) and whitelist only the specific assigned static IP addresses in the Atlas IP Access List.
5. **Connection String**: Under Database > Connect > Drivers > Node.js, copy the connection string (TLS is enforced by default via `mongodb+srv://`):
   ```
   mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority&appName=SmartBakery
   ```

#### Step 2: Backend Deployment on Render
1. Push the repository to GitHub.
2. Sign in to [Render](https://dashboard.render.com/) and create a **New Web Service**:
   - Connect your GitHub repository.
   - **Root Directory**: `server`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/health`
3. Configure **Environment Variables** in Render:
   - `NODE_ENV`: `production`
   - `PORT`: `10000`
   - `TRUST_PROXY_HOPS`: `1` (required for Render reverse proxy)
   - `MONGO_URI`: `mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority&appName=SmartBakery`
   - `MONGO_DB_NAME`: `smart_bakery_db`
   - `ACCESS_TOKEN_SECRET`: (Random string >= 32 characters)
   - `REFRESH_TOKEN_SECRET`: (Different random string >= 32 characters)
   - `COOKIE_SECRET`: (Third different random string >= 32 characters)
   - `COOKIE_SAME_SITE`: `none` (enables cross-site refresh token cookies from Vercel)
   - `CORS_ORIGIN`: `https://<your-vercel-domain>.vercel.app`
   - `FRONTEND_URL`: `https://<your-vercel-domain>.vercel.app`
4. Deploy the service. Once deployed, copy your Render service URL (e.g., `https://smart-bakery-api.onrender.com`).
*(Alternatively, use Render Blueprints to automatically provision using [`render.yaml`](file:///C:/Users/Rohan/OneDrive/Desktop/bakery%20management/render.yaml).)*

#### Step 3: Frontend Deployment on Vercel
1. Sign in to [Vercel](https://vercel.com/) and click **Add New > Project**.
2. Import the GitHub repository.
3. In the project configuration:
   - **Framework Preset**: `Vite`
   - **Root Directory**: Click `Edit` and select `client`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
4. Configure **Environment Variables** in Vercel:
   - `VITE_API_URL`: `https://smart-bakery-api.onrender.com` (your Render service URL)
5. Click **Deploy**. Vercel will build the frontend and register the SPA route rewrites defined in [`client/vercel.json`](file:///C:/Users/Rohan/OneDrive/Desktop/bakery%20management/client/vercel.json).
6. Copy your Vercel deployment URL (e.g. `https://smart-bakery-client.vercel.app`) and ensure it matches the `CORS_ORIGIN` and `FRONTEND_URL` configured in your Render service.

#### Step 4: Provision First Owner Account on Production
To seed the initial owner account in your production MongoDB Atlas cluster:
Run this one-line administrative bootstrap script against your Atlas connection:
```bash
MONGO_URI="mongodb+srv://..." OWNER_EMAIL="owner@smartbakery.com" OWNER_PASSWORD="YourStrongPassword123!" node server/scripts/bootstrap-owner.js
```

---

### Deployment Checklist

1. **Environment & Secrets**:
   - Set `NODE_ENV=production`.
   - Provide distinct `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`, and `COOKIE_SECRET` with at least 32 cryptographically random characters.
   - Configure explicit HTTPS URLs for `CORS_ORIGIN` and `FRONTEND_URL`. Wildcards (`*`) are rejected.
2. **Reverse Proxy (Nginx / Cloudflare)**:
   - Terminate TLS at the edge.
   - Set `TRUST_PROXY_HOPS` to match your exact reverse proxy topology (e.g., `1`).
   - Forward `X-Forwarded-For`, `X-Forwarded-Proto`, and `Host`.
3. **Database (MongoDB)**:
   - Use a MongoDB replica set for multi-document transaction atomicity. On standalone MongoDB, best-effort compensating rollback is used for multi-document operations. See [MongoDB Transaction Architecture](server/docs/mongodb-transaction-architecture.md) for complete details.
   - Configure automated daily snapshots with point-in-time recovery.
4. **Static Assets**:
   - Build frontend assets using `npm run build` in `client/`. Serve `dist/` via Nginx or Cloudflare Pages.
5. **Process Management**:
   - Run backend using PM2 (`pm2 start src/server.js -i max --name bakery-api`) or Docker (`docker build -t smart-bakery-api server/`).

### Progressive Web App (PWA) Architecture & Offline Support

Smart Bakery is fully equipped as a production-ready Progressive Web App (PWA) using `vite-plugin-pwa` and Workbox:

1. **Installability & Manifest**:
   - Web App Manifest: Located at `/manifest.webmanifest`, registered with standalone display, `#ea580c` theme color, and `#fbf9f6` background.
   - App Icons: 192×192 and 512×512 PNG icons in standard and maskable variants (with full-bleed safe zones), plus Apple Touch Icon (`180×180`) and SVGs.
   - Install Banner & Actions: User-dismissible install banner on mobile and desktop browsers, iOS Safari "Add to Home Screen" instructions modal, and a dedicated "Install App" button in navigation.
   - Standalone Detection: Detects `display-mode: standalone` and suppresses redundant prompts.

2. **Safe, Honest Offline Strategy**:
   - **App Shell Precache**: HTML, CSS, JavaScript, fonts, local SVGs, and brand icons are precached and served instantly.
   - **Public Catalog Caching**: `GET /api/v1/categories` and `GET /api/v1/products` use a `NetworkFirst` strategy with a 3-second timeout and 24-hour expiration (`bakery-catalog-cache`). Cached catalog items are clearly badged as offline data.
   - **Zero Leaks of Sensitive Data**: Authenticated endpoints (`/auth/*`), customer orders (`/orders/*`), cart mutations, payments, inventory mutations, and production workstation state transitions are **strictly excluded** from service worker caches.
   - **Honest Mutation Guards**: Placing orders or submitting UPI payment references while offline displays an explicit warning and prevents simulated success or accidental replay.

3. **Controlled Update Handling**:
   - Service worker uses `registerType: 'prompt'`. When a new deployment is ready, an unobtrusive banner notifies the user with an "Update Now" action to prevent interrupting active checkout or kitchen batch operations.

4. **Testing & Verification Commands**:
   ```bash
   cd client
   # Verify static manifest, icon signatures, and cache rules
   npm run test:pwa

   # Regenerate icons from source SVGs
   npm run icons:generate
   ```

### Documentation & Verification Matrices

- [API Audit Matrix](server/docs/api-audit-matrix.md): Full static inventory of all 146 `/api/v1` routes, automated integration coverage, and browser acceptance status.
- [MongoDB Transaction Specification](server/docs/mongodb-transaction-architecture.md): Topology-aware multi-document atomicity vs standalone compensating rollback details.
- [Production Quality Workflow](server/docs/production-quality-workflow.md): Production batch lifecycle, quality assurance checks, and finished stock updates.

### Rollback Strategy

1. **Application Code**: In the event of a deployment defect, revert to the previous git tag or container digest and restart the process.
2. **Database Migrations**: Database schemas are backward-compatible. Maintain daily `mongodump` archives prior to major releases.
