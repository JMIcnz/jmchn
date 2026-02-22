# STRATUM — Jamstack E-Commerce

> **Gatsby** · **Cloudflare Workers + Hono** · **Neon PostgreSQL** · **Stripe**

A production-grade, serverless Jamstack e-commerce architecture built for performance,
security, and infinite scalability.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          CDN / Edge Network                             │
│                    (Cloudflare Pages / Netlify)                         │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │ Static HTML + JS
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         GATSBY FRONTEND                                 │
│                                                                         │
│  gatsby-node.js ──→ Fetch all products at BUILD TIME                    │
│                     Generate /products/:slug static pages (SEO ✓)       │
│                                                                         │
│  Client-side React (dynamic):                                           │
│  ├── CartContext    (add/remove items, persists via X-Cart-Token)        │
│  ├── AuthContext    (JWT stored in localStorage)                         │
│  ├── CartDrawer    (slide-out, quantity controls)                        │
│  └── Checkout CTA  (calls API → redirects to Stripe Hosted UI)          │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │ HTTPS / Fetch
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                 CLOUDFLARE WORKERS  +  HONO                             │
│                                                                         │
│  Route                    Method  Description                           │
│  ─────────────────────────────────────────────────────────────────────  │
│  /auth/register           POST    Create account, returns JWT           │
│  /auth/login              POST    Validate creds, returns JWT           │
│  /auth/me                 GET     Verify token, return user profile      │
│  /products                GET     Paginated product listing + search     │
│  /products/:slug          GET     Single product with variants           │
│  /cart                    GET     Get cart (auth or anonymous)           │
│  /cart/items              POST    Add item to cart                       │
│  /cart/items/:id          PATCH   Update quantity                        │
│  /cart/items/:id          DELETE  Remove item (optimistic on frontend)   │
│  /checkout/session        POST    Create Stripe Checkout Session          │
│  /orders                  GET     User's order history                   │
│  /orders/:id              GET     Order detail + items                   │
│  /webhooks/stripe         POST    Receive & verify Stripe events         │
└────────────┬───────────────────────────────────┬────────────────────────┘
             │ @neondatabase/serverless           │ stripe npm SDK
             ▼                                   ▼
┌────────────────────────┐         ┌─────────────────────────────────────┐
│   NEON (PostgreSQL)    │         │              STRIPE                  │
│                        │         │                                      │
│  users                 │         │  Products / Prices                   │
│  sessions              │         │  Checkout Sessions (Hosted UI)       │
│  products              │◄────────│  Payment Intents                     │
│  variants              │  sync   │  Customers                           │
│  categories            │  via    │  Webhooks:                           │
│  carts                 │  hooks  │  ├── checkout.session.completed       │
│  cart_items            │         │  │   → create order in Neon          │
│  orders                │         │  │   → decrement stock               │
│  order_items           │         │  │   → link Stripe customer→user     │
│  stripe_webhook_events │         │  ├── payment_intent.payment_failed   │
│                        │         │  └── charge.refunded                 │
└────────────────────────┘         └─────────────────────────────────────┘
```

---

## Key Design Decisions

### 1 — Static product pages (Gatsby + `gatsby-node.js`)
At build time, `createPages` calls the Worker API to retrieve every active product.
Each product gets its own pre-rendered HTML page at `/products/:slug`, enabling:
- **Perfect SEO**: Full HTML delivered to crawlers — no JS required
- **Sub-50ms TTFB**: Files served from CDN edge
- **Structured data**: `application/ld+json` Product schema on every page

The cart and auth are **client-side only** — they hit the API dynamically.

### 2 — Cloudflare Workers + Hono
Workers run in V8 isolates at Cloudflare's 300+ edge locations, meaning the API
executes as close as possible to both the user and Neon's database.
Hono provides typed routing, built-in middleware (`cors`, `secureHeaders`, `logger`),
and tiny bundle size (~14 kB).

### 3 — Neon Serverless PostgreSQL
Neon's `@neondatabase/serverless` driver uses WebSockets (via `neon()`) instead of
TCP, making it compatible with Workers' edge runtime. Neon's auto-suspend and
scale-to-zero model means zero cost during off-hours.

### 4 — Anonymous + authenticated carts
- **Anonymous**: A UUID is returned as `X-Cart-Token` response header and stored
  in `localStorage`. Every subsequent request passes it back.
- **Authenticated**: The cart is linked to `users.id` via the JWT `Authorization` header.
- Cart data lives in Neon (not localStorage), so it survives device switches.

### 5 — Stripe Checkout (Hosted UI)
The Worker creates a Stripe Checkout Session server-side with full line items.
The frontend redirects to Stripe's hosted payment page — no PCI scope.
After payment, Stripe sends webhooks to `/webhooks/stripe`, which the Worker
verifies via `constructEventAsync` (subtle-crypto compatible) and processes
idempotently using `stripe_webhook_events` as a dedup table.

---

## Local Development

### 1. Database (Neon)
```bash
# Apply schema to your Neon branch
psql $DATABASE_URL -f database/schema.sql
```

### 2. Worker API
```bash
cd worker
npm install
cp ../. env.example .dev.vars   # fill in your secrets
npm run dev                     # wrangler dev — hot reload at localhost:8787
```

### 3. Gatsby Frontend
```bash
cd frontend
npm install
cp ../.env.example .env.development
# Set GATSBY_API_URL=http://localhost:8787
npm run develop                 # http://localhost:8000
```

### 4. Stripe Webhooks (local)
```bash
stripe listen --forward-to localhost:8787/webhooks/stripe
```

---

## Production Deployment

### Worker
```bash
cd worker
wrangler secret put DATABASE_URL
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
wrangler secret put JWT_SECRET
wrangler deploy
```

### Frontend (Cloudflare Pages)
```bash
# Connect your GitHub repo in the Cloudflare Pages dashboard
# Build command:  npm run build
# Output dir:     public
# Env vars:       GATSBY_API_URL, GATSBY_STRIPE_PUBLISHABLE_KEY
```

### Stripe Webhook Endpoint
Register `https://api.yourstore.com/webhooks/stripe` in the Stripe dashboard.
Events to subscribe to:
- `checkout.session.completed`
- `payment_intent.payment_failed`
- `charge.refunded`

---

## Project Structure

```
jamstack-ecommerce/
├── database/
│   └── schema.sql              # Full Neon schema with triggers + seed
├── worker/
│   ├── src/index.ts            # Hono API (auth, products, cart, checkout, webhooks)
│   ├── wrangler.toml           # Cloudflare Worker config
│   └── package.json
├── frontend/
│   ├── gatsby-node.js          # Static page generation from API
│   ├── gatsby-config.js
│   ├── src/
│   │   ├── lib/api.ts          # Typed API client (products, cart, auth, orders)
│   │   ├── hooks/
│   │   │   ├── useCart.tsx     # CartContext with optimistic updates
│   │   │   └── useAuth.tsx     # AuthContext with JWT rehydration
│   │   ├── templates/
│   │   │   └── ProductPage.tsx # Static product page template
│   │   ├── components/
│   │   │   ├── Layout.tsx      # Site header + footer + cart drawer
│   │   │   └── CartDrawer.tsx  # Slide-out cart UI
│   │   ├── pages/
│   │   │   └── order-success.tsx
│   │   └── styles/
│   │       └── global.css      # Dark luxury design system
│   └── package.json
└── .env.example
```

---

## Security Checklist

- [x] JWT RS256-signed tokens (jose, Workers-compatible)
- [x] bcrypt password hashing (cost factor 12)
- [x] Stripe webhook signature verification (`constructEventAsync`)
- [x] Webhook idempotency via `stripe_webhook_events` table
- [x] SQL injection prevention via Neon tagged template literals
- [x] `secureHeaders()` middleware (HSTS, X-Frame-Options, etc.)
- [x] CORS locked to specific origin in production
- [x] Stock decrement in webhook (server-side, not client-trusted)
- [x] Anonymous cart tokens are random UUIDs (crypto.randomUUID)
- [x] No PCI scope — Stripe Hosted Checkout handles card data
