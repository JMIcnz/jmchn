/**
 * Cloudflare Workers + Hono — E-Commerce API
 *
 * Routes:
 *   Auth      POST /auth/register  POST /auth/login  DELETE /auth/logout
 *   Products  GET  /products       GET  /products/:slug
 *   Cart      GET  /cart           POST /cart/items  PATCH /cart/items/:id  DELETE /cart/items/:id
 *   Checkout  POST /checkout/session
 *   Orders    GET  /orders         GET  /orders/:id
 *   Webhooks  POST /webhooks/stripe
 */
/**
 * Cloudflare Workers + Hono — E-Commerce API
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'
import { HTTPException } from 'hono/http-exception'
import { neon } from '@neondatabase/serverless'
import Stripe from 'stripe'
import { SignJWT, jwtVerify } from 'jose'
import { hash, compare } from 'bcryptjs'
import admin from './admin'

// ─── Types ───────────────────────────────────────────────────────────────────

type Env = {
  DATABASE_URL: string
  STRIPE_SECRET_KEY: string
  STRIPE_WEBHOOK_SECRET: string
  JWT_SECRET: string
  CORS_ORIGIN: string
  ENVIRONMENT: 'development' | 'production'
}

// ─── App bootstrap ───────────────────────────────────────────────────────────

const app = new Hono<{ Bindings: Env }>()

app.use('*', logger())
app.use('*', secureHeaders())
app.use('*', async (c, next) => {
  const requestOrigin = c.req.header('Origin') || ''
  const configuredOrigin = c.env.CORS_ORIGIN || ''

  // Allow exact match, any *.pages.dev preview, localhost, and workers.dev
  const isAllowed =
    !requestOrigin ||
    requestOrigin === configuredOrigin ||
    /^https:\/\/[a-z0-9-]+\.pages\.dev$/.test(requestOrigin) ||
    /^https?:\/\/localhost(:\d+)?$/.test(requestOrigin) ||
    /^https:\/\/[a-z0-9-]+\.workers\.dev$/.test(requestOrigin)

  const corsMiddleware = cors({
    origin: isAllowed ? (requestOrigin || '*') : configuredOrigin,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Cart-Token'],
    exposeHeaders: ['X-Cart-Token'],
    credentials: true,
    maxAge: 86400,
  })
  return corsMiddleware(c, next)
})

// ─── DB helper ───────────────────────────────────────────────────────────────

const getDb = (env: Env) => neon(env.DATABASE_URL)

// ─── JWT helpers ─────────────────────────────────────────────────────────────

async function createToken(userId: string, secret: string, role = 'customer') {
  const key = new TextEncoder().encode(secret)
  return new SignJWT({ sub: userId, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(key)
}

async function verifyToken(token: string, secret: string): Promise<string> {
  const key = new TextEncoder().encode(secret)
  const { payload } = await jwtVerify(token, key)
  return payload.sub as string
}

// ─── Auth middleware ──────────────────────────────────────────────────────────

const requireAuth = async (c: any, next: any) => {
  const authHeader = c.req.header('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/, '')
  if (!token) throw new HTTPException(401, { message: 'Missing auth token' })
  try {
    const userId = await verifyToken(token, c.env.JWT_SECRET)
    c.set('userId', userId)
    await next()
  } catch {
    throw new HTTPException(401, { message: 'Invalid or expired token' })
  }
}

const optionalAuth = async (c: any, next: any) => {
  const authHeader = c.req.header('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/, '')
  if (token) {
    try {
      const userId = await verifyToken(token, c.env.JWT_SECRET)
      c.set('userId', userId)
    } catch { /* anonymous */ }
  }
  await next()
}

// ─── AUTH routes ─────────────────────────────────────────────────────────────

const auth = new Hono<{ Bindings: Env }>()

auth.post('/register', async (c) => {
  const { email, password, full_name } = await c.req.json()
  if (!email || !password) throw new HTTPException(400, { message: 'email and password required' })

  const sql = getDb(c.env)
  const existing = await sql`SELECT id FROM users WHERE email = ${email.toLowerCase()}`
  if (existing.length) throw new HTTPException(409, { message: 'Email already registered' })

  const password_hash = await hash(password, 12)
  const [user] = await sql`
    INSERT INTO users (email, password_hash, full_name)
    VALUES (${email.toLowerCase()}, ${password_hash}, ${full_name ?? null})
    RETURNING id, email, full_name, created_at
  `

  const token = await createToken(user.id, c.env.JWT_SECRET)
  return c.json({ user, token }, 201)
})

auth.post('/login', async (c) => {
  const { email, password } = await c.req.json()
  if (!email || !password) throw new HTTPException(400, { message: 'email and password required' })

  const sql = getDb(c.env)
  const [user] = await sql`
    SELECT id, email, full_name, password_hash, stripe_customer_id
    FROM users WHERE email = ${email.toLowerCase()}
  `
  if (!user || !user.password_hash) throw new HTTPException(401, { message: 'Invalid credentials' })

  const valid = await compare(password, user.password_hash)
  if (!valid) throw new HTTPException(401, { message: 'Invalid credentials' })

  const token = await createToken(user.id, c.env.JWT_SECRET)
  const { password_hash: _, ...safeUser } = user
  return c.json({ user: safeUser, token })
})

auth.get('/me', requireAuth, async (c) => {
  const sql = getDb(c.env)
  const [user] = await sql`
    SELECT id, email, full_name, avatar_url, created_at
    FROM users WHERE id = ${c.get('userId')}
  `
  if (!user) throw new HTTPException(404, { message: 'User not found' })
  return c.json(user)
})

// ─── PRODUCTS routes ──────────────────────────────────────────────────────────

const products = new Hono<{ Bindings: Env }>()

products.get('/', async (c) => {
  const sql = getDb(c.env)
  const { category, featured, search, page = '1', limit = '24' } = c.req.query()
  const offset = (parseInt(page) - 1) * parseInt(limit)

  // Build queries conditionally — Neon cannot type bare `null` parameters
  let rows
  if (search) {
    const pattern = '%' + search + '%'
    rows = await sql`
      SELECT p.*, c.name AS category_name
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.is_active = TRUE
        AND (p.name ILIKE ${pattern} OR p.description ILIKE ${pattern})
      ORDER BY p.is_featured DESC, p.created_at DESC
      LIMIT ${parseInt(limit)} OFFSET ${offset}
    `
  } else if (category && featured !== undefined) {
    rows = await sql`
      SELECT p.*, c.name AS category_name
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.is_active = TRUE
        AND c.slug = ${category}
        AND p.is_featured = ${featured === 'true'}
      ORDER BY p.is_featured DESC, p.created_at DESC
      LIMIT ${parseInt(limit)} OFFSET ${offset}
    `
  } else if (category) {
    rows = await sql`
      SELECT p.*, c.name AS category_name
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.is_active = TRUE
        AND c.slug = ${category}
      ORDER BY p.is_featured DESC, p.created_at DESC
      LIMIT ${parseInt(limit)} OFFSET ${offset}
    `
  } else if (featured !== undefined) {
    rows = await sql`
      SELECT p.*, c.name AS category_name
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.is_active = TRUE
        AND p.is_featured = ${featured === 'true'}
      ORDER BY p.is_featured DESC, p.created_at DESC
      LIMIT ${parseInt(limit)} OFFSET ${offset}
    `
  } else {
    rows = await sql`
      SELECT p.*, c.name AS category_name
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.is_active = TRUE
      ORDER BY p.is_featured DESC, p.created_at DESC
      LIMIT ${parseInt(limit)} OFFSET ${offset}
    `
  }

  return c.json({ products: rows, page: parseInt(page), limit: parseInt(limit) })
})

products.get('/:slug', async (c) => {
  const sql = getDb(c.env)
  const [product] = await sql`
    SELECT p.*, c.name AS category_name, c.slug AS category_slug
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.slug = ${c.req.param('slug')} AND p.is_active = TRUE
  `
  if (!product) throw new HTTPException(404, { message: 'Product not found' })

  const variants = await sql`
    SELECT id, name, options, price_cents, sku, stock_qty
    FROM variants WHERE product_id = ${product.id} AND is_active = TRUE
    ORDER BY created_at
  `
  return c.json({ ...product, variants })
})

// ─── CART routes ──────────────────────────────────────────────────────────────

const cart = new Hono<{ Bindings: Env }>()

async function resolveCart(c: any, sql: any, create = false) {
  const userId = c.get('userId') as string | undefined
  const sessionToken = c.req.header('X-Cart-Token')

  let cartRow
  if (userId) {
    ;[cartRow] = await sql`SELECT * FROM carts WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 1`
    if (!cartRow && create) {
      ;[cartRow] = await sql`INSERT INTO carts (user_id) VALUES (${userId}) RETURNING *`
    }
  } else if (sessionToken) {
    ;[cartRow] = await sql`SELECT * FROM carts WHERE session_token = ${sessionToken}`
    if (!cartRow && create) {
      ;[cartRow] = await sql`INSERT INTO carts (session_token) VALUES (${sessionToken}) RETURNING *`
    }
  } else if (create) {
    const token = crypto.randomUUID()
    ;[cartRow] = await sql`INSERT INTO carts (session_token) VALUES (${token}) RETURNING *`
  }

  return cartRow
}

async function getCartWithItems(cartId: string, sql: any) {
  const items = await sql`
    SELECT ci.*, p.name AS product_name, p.slug AS product_slug,
           p.images->>0 AS image, v.name AS variant_name
    FROM cart_items ci
    JOIN products p ON p.id = ci.product_id
    LEFT JOIN variants v ON v.id = ci.variant_id
    WHERE ci.cart_id = ${cartId}
    ORDER BY ci.created_at
  `
  const subtotal = items.reduce((s: number, i: any) => s + i.price_cents * i.quantity, 0)
  return { items, subtotal, item_count: items.reduce((s: number, i: any) => s + i.quantity, 0) }
}

cart.get('/', optionalAuth, async (c) => {
  const sql = getDb(c.env)
  const cartRow = await resolveCart(c, sql, false)
  if (!cartRow) return c.json({ items: [], subtotal: 0, item_count: 0 })
  const data = await getCartWithItems(cartRow.id, sql)
  return c.json({ cart_id: cartRow.id, session_token: cartRow.session_token, ...data })
})

cart.post('/items', optionalAuth, async (c) => {
  const sql = getDb(c.env)
  const { product_id, variant_id, quantity = 1 } = await c.req.json()
  if (!product_id) throw new HTTPException(400, { message: 'product_id required' })

  const [product] = await sql`SELECT id, price_cents FROM products WHERE id = ${product_id} AND is_active = TRUE`
  if (!product) throw new HTTPException(404, { message: 'Product not found' })

  let price_cents = product.price_cents
  if (variant_id) {
    const [variant] = await sql`SELECT price_cents, stock_qty FROM variants WHERE id = ${variant_id}`
    if (!variant) throw new HTTPException(404, { message: 'Variant not found' })
    if (variant.stock_qty < quantity) throw new HTTPException(400, { message: 'Insufficient stock' })
    if (variant.price_cents !== null) price_cents = variant.price_cents
  }

  const cartRow = await resolveCart(c, sql, true)

  // Use separate insert paths to avoid null UUID type ambiguity
  let item
  if (variant_id) {
    ;[item] = await sql`
      INSERT INTO cart_items (cart_id, product_id, variant_id, quantity, price_cents)
      VALUES (${cartRow.id}, ${product_id}, ${variant_id}, ${quantity}, ${price_cents})
      ON CONFLICT (cart_id, product_id, variant_id)
      DO UPDATE SET quantity = cart_items.quantity + ${quantity}, updated_at = NOW()
      RETURNING *
    `
  } else {
    ;[item] = await sql`
      INSERT INTO cart_items (cart_id, product_id, quantity, price_cents)
      VALUES (${cartRow.id}, ${product_id}, ${quantity}, ${price_cents})
      ON CONFLICT (cart_id, product_id, variant_id)
      DO UPDATE SET quantity = cart_items.quantity + ${quantity}, updated_at = NOW()
      RETURNING *
    `
  }

  const data = await getCartWithItems(cartRow.id, sql)
  const headers: Record<string, string> = {}
  if (cartRow.session_token) headers['X-Cart-Token'] = cartRow.session_token

  return c.json({ item, ...data }, 201, headers)
})

cart.patch('/items/:itemId', optionalAuth, async (c) => {
  const sql = getDb(c.env)
  const { quantity } = await c.req.json()
  if (quantity < 1) throw new HTTPException(400, { message: 'quantity must be ≥ 1' })

  const cartRow = await resolveCart(c, sql, false)
  if (!cartRow) throw new HTTPException(404, { message: 'Cart not found' })

  await sql`
    UPDATE cart_items SET quantity = ${quantity}, updated_at = NOW()
    WHERE id = ${c.req.param('itemId')} AND cart_id = ${cartRow.id}
  `
  const data = await getCartWithItems(cartRow.id, sql)
  return c.json(data)
})

cart.delete('/items/:itemId', optionalAuth, async (c) => {
  const sql = getDb(c.env)
  const cartRow = await resolveCart(c, sql, false)
  if (!cartRow) throw new HTTPException(404, { message: 'Cart not found' })

  await sql`DELETE FROM cart_items WHERE id = ${c.req.param('itemId')} AND cart_id = ${cartRow.id}`
  const data = await getCartWithItems(cartRow.id, sql)
  return c.json(data)
})

// ─── CHECKOUT routes ──────────────────────────────────────────────────────────

const checkout = new Hono<{ Bindings: Env }>()

checkout.post('/session', optionalAuth, async (c) => {
  const sql = getDb(c.env)
  const { success_url, cancel_url } = await c.req.json()

  const cartRow = await resolveCart(c, sql, false)
  if (!cartRow) throw new HTTPException(400, { message: 'Cart is empty' })

  const { items } = await getCartWithItems(cartRow.id, sql)
  if (!items.length) throw new HTTPException(400, { message: 'Cart is empty' })

  const stripe = new Stripe(c.env.STRIPE_SECRET_KEY)

  const lineItems = items.map((item: any) => ({
    price_data: {
      currency: 'usd',
      unit_amount: item.price_cents,
      product_data: {
        name: item.product_name + (item.variant_name ? ` — ${item.variant_name}` : ''),
        images: item.image ? [item.image] : [],
        metadata: { product_id: item.product_id, variant_id: item.variant_id ?? '' },
      },
    },
    quantity: item.quantity,
  }))

  let customer: string | undefined
  const userId = c.get('userId')
  if (userId) {
    const [user] = await sql`SELECT stripe_customer_id FROM users WHERE id = ${userId}`
    if (user?.stripe_customer_id) customer = user.stripe_customer_id
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: lineItems,
    customer,
    customer_creation: customer ? undefined : 'always',
    payment_intent_data: {
      metadata: { cart_id: cartRow.id, user_id: userId ?? 'anonymous' },
    },
    metadata: { cart_id: cartRow.id, user_id: userId ?? 'anonymous' },
    success_url: success_url + '?session_id={CHECKOUT_SESSION_ID}',
    cancel_url,
    shipping_address_collection: { allowed_countries: ['US', 'CA', 'GB', 'AU', 'NZ'] },
    automatic_tax: { enabled: true },
  })

  await sql`UPDATE carts SET stripe_session_id = ${session.id} WHERE id = ${cartRow.id}`

  return c.json({ session_id: session.id, url: session.url })
})

// ─── ORDERS routes ────────────────────────────────────────────────────────────

const orders = new Hono<{ Bindings: Env }>()

orders.get('/', requireAuth, async (c) => {
  const sql = getDb(c.env)
  const rows = await sql`
    SELECT id, status, total_cents, currency, customer_email, created_at
    FROM orders WHERE user_id = ${c.get('userId')}
    ORDER BY created_at DESC LIMIT 50
  `
  return c.json(rows)
})

orders.get('/:id', requireAuth, async (c) => {
  const sql = getDb(c.env)
  const [order] = await sql`
    SELECT * FROM orders WHERE id = ${c.req.param('id')} AND user_id = ${c.get('userId')}
  `
  if (!order) throw new HTTPException(404, { message: 'Order not found' })

  const items = await sql`SELECT * FROM order_items WHERE order_id = ${order.id}`
  return c.json({ ...order, items })
})

// ─── STRIPE WEBHOOK ───────────────────────────────────────────────────────────

const webhooks = new Hono<{ Bindings: Env }>()

webhooks.post('/stripe', async (c) => {
  const stripe = new Stripe(c.env.STRIPE_SECRET_KEY)
  const sql = getDb(c.env)

  const body = await c.req.text()
  const sig = c.req.header('stripe-signature')!

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, c.env.STRIPE_WEBHOOK_SECRET)
  } catch (err: any) {
    throw new HTTPException(400, { message: `Webhook error: ${err.message}` })
  }

  const existing = await sql`SELECT id FROM stripe_webhook_events WHERE id = ${event.id}`
  if (existing.length) return c.json({ received: true, duplicate: true })

  try {
    await processStripeEvent(event, sql, stripe)
    await sql`
      INSERT INTO stripe_webhook_events (id, type, payload)
      VALUES (${event.id}, ${event.type}, ${JSON.stringify(event)})
    `
  } catch (err: any) {
    await sql`
      INSERT INTO stripe_webhook_events (id, type, payload, error)
      VALUES (${event.id}, ${event.type}, ${JSON.stringify(event)}, ${err.message})
      ON CONFLICT (id) DO UPDATE SET error = ${err.message}
    `
    throw new HTTPException(500, { message: 'Webhook processing failed' })
  }

  return c.json({ received: true })
})

async function processStripeEvent(event: Stripe.Event, sql: any, stripe: Stripe) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const cartId = session.metadata?.cart_id
      const userId = session.metadata?.user_id !== 'anonymous' ? session.metadata?.user_id : null

      if (!cartId) break

      const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
        expand: ['line_items.data.price.product'],
      })

      const lineItems = fullSession.line_items?.data ?? []

      const [order] = await sql`
        INSERT INTO orders (
          user_id, status, stripe_session_id, stripe_payment_intent_id,
          subtotal_cents, total_cents, currency,
          customer_email, customer_name, shipping_address
        ) VALUES (
          ${userId}, 'paid', ${session.id}, ${session.payment_intent as string},
          ${session.amount_subtotal ?? 0}, ${session.amount_total ?? 0},
          ${session.currency?.toUpperCase() ?? 'USD'},
          ${session.customer_details?.email ?? ''},
          ${session.customer_details?.name ?? null},
          ${JSON.stringify(session.shipping_details?.address ?? {})}
        ) RETURNING id
      `

      for (const li of lineItems) {
        const product = li.price?.product as Stripe.Product
        await sql`
          INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price_cents, total_cents)
          VALUES (
            ${order.id},
            ${product?.metadata?.product_id ?? null},
            ${li.description ?? ''},
            ${li.quantity ?? 1},
            ${li.price?.unit_amount ?? 0},
            ${(li.price?.unit_amount ?? 0) * (li.quantity ?? 1)}
          )
        `
        if (product?.metadata?.variant_id) {
          await sql`
            UPDATE variants SET stock_qty = GREATEST(0, stock_qty - ${li.quantity ?? 1})
            WHERE id = ${product.metadata.variant_id}
          `
        }
      }

      if (userId && session.customer) {
        await sql`UPDATE users SET stripe_customer_id = ${session.customer as string} WHERE id = ${userId}`
      }

      await sql`DELETE FROM cart_items WHERE cart_id = ${cartId}`
      break
    }

    case 'payment_intent.payment_failed': {
      const pi = event.data.object as Stripe.PaymentIntent
      await sql`
        UPDATE orders SET status = 'pending', updated_at = NOW()
        WHERE stripe_payment_intent_id = ${pi.id}
      `
      break
    }

    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge
      await sql`
        UPDATE orders SET status = 'refunded', updated_at = NOW()
        WHERE stripe_payment_intent_id = ${charge.payment_intent as string}
      `
      break
    }
  }
}

// ─── Mount routes ─────────────────────────────────────────────────────────────

app.route('/auth', auth)
app.route('/products', products)
app.route('/cart', cart)
app.route('/checkout', checkout)
app.route('/orders', orders)
app.route('/webhooks', webhooks)
app.route('/admin', admin)

// Health check
app.get('/health', (c) => c.json({ ok: true, env: c.env.ENVIRONMENT }))

// DB health check — useful for debugging
app.get('/health/db', async (c) => {
  try {
    const sql = getDb(c.env)
    await sql`SELECT 1`
    return c.json({ ok: true, db: 'connected' })
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500)
  }
})

// Global error handler
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status)
  }
  console.error('Unhandled error:', err)
  return c.json({ error: 'Internal server error', detail: err.message }, 500)
})

export default app


// ─── GOOGLE OAUTH ─────────────────────────────────────────────────────────────
// Add these env vars (wrangler secret put):
//   GOOGLE_CLIENT_ID      — from Google Cloud Console → OAuth 2.0 Credentials
//   GOOGLE_CLIENT_SECRET  — from Google Cloud Console → OAuth 2.0 Credentials
//   ADMIN_EMAILS          — comma-separated list of emails allowed as admin
//                           e.g. "you@gmail.com,colleague@gmail.com"
//
// In Google Cloud Console → APIs & Services → Credentials → OAuth 2.0:
//   Authorised redirect URI: https://bizify.jmi.workers.dev/auth/google/callback

type OAuthEnv = Env & {
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  ADMIN_EMAILS: string   // comma-separated whitelist
}

// Step 1 — redirect browser to Google consent screen
app.get('/auth/google', (c) => {
  const env = c.env as OAuthEnv
  const returnTo = c.req.query('return_to') || ''

  const params = new URLSearchParams({
    client_id:     env.GOOGLE_CLIENT_ID,
    redirect_uri:  `${new URL(c.req.url).origin}/auth/google/callback`,
    response_type: 'code',
    scope:         'openid email profile',
    access_type:   'offline',
    prompt:        'select_account',
    state:         Buffer.from(returnTo).toString('base64'),
  })

  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
})

// Step 2 — Google redirects back here with ?code=...
app.get('/auth/google/callback', async (c) => {
  const env = c.env as OAuthEnv
  const { code, state, error } = c.req.query()

  // Decode return_to URL (where to redirect the browser after login)
  let returnTo = '/'
  try { returnTo = Buffer.from(state || '', 'base64').toString('utf-8') || '/' } catch {}

  const errorRedirect = (msg: string) =>
    c.redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=${encodeURIComponent(msg)}`)

  if (error || !code) return errorRedirect('Google sign-in was cancelled or failed.')

  try {
    const origin = new URL(c.req.url).origin

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri:  `${origin}/auth/google/callback`,
        grant_type:    'authorization_code',
      }),
    })

    const tokens = await tokenRes.json() as any
    if (!tokenRes.ok || !tokens.id_token) {
      return errorRedirect('Failed to exchange Google code for token.')
    }

    // Decode the id_token JWT (no signature verification needed — came directly from Google)
    const [, payloadB64] = tokens.id_token.split('.')
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')))
    const { email, name, picture, sub: googleId } = payload

    if (!email) return errorRedirect('Google did not return an email address.')

    // Check admin whitelist
    const adminEmails = (env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase())
    if (!adminEmails.includes(email.toLowerCase())) {
      return errorRedirect(`${email} is not authorised as an admin. Contact your administrator.`)
    }

    const sql = getDb(c.env)

    // Upsert user
    const [user] = await sql`
      INSERT INTO users (email, full_name, avatar_url, email_verified)
      VALUES (${email.toLowerCase()}, ${name ?? null}, ${picture ?? null}, TRUE)
      ON CONFLICT (email) DO UPDATE SET
        full_name     = COALESCE(EXCLUDED.full_name, users.full_name),
        avatar_url    = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
        email_verified = TRUE,
        updated_at    = NOW()
      RETURNING id, email
    `

    // Ensure role column exists and set admin
    await sql`
      UPDATE users SET role = 'admin' WHERE id = ${user.id}
    `

    const jwt = await createToken(user.id, env.JWT_SECRET, 'admin')

    // Redirect back to admin page with token in URL — page JS picks it up and stores in localStorage
    return c.redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}token=${jwt}`)

  } catch (err: any) {
    console.error('Google OAuth error:', err)
    return errorRedirect('An unexpected error occurred during sign-in.')
  }
})
