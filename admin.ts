/**
 * admin.ts — Admin API routes (mount at /admin/*)
 *
 * All routes require a valid JWT with role='admin'.
 * Mount in index.ts: app.route('/admin', admin)
 *
 * Routes:
 *   GET    /admin/stats                  — dashboard KPIs
 *   GET    /admin/products               — paginated product list
 *   POST   /admin/products               — create product
 *   PUT    /admin/products/:id           — update product
 *   DELETE /admin/products/:id           — soft-delete product
 *   GET    /admin/products/:id/variants  — list variants
 *   POST   /admin/products/:id/variants  — create variant
 *   PATCH  /admin/variants/:id/stock     — update stock qty
 *   GET    /admin/orders                 — paginated order list
 *   GET    /admin/orders/:id             — order detail
 *   PATCH  /admin/orders/:id/status      — update order status
 *   GET    /admin/users                  — paginated user list
 */

import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { neon } from '@neondatabase/serverless'
import { jwtVerify } from 'jose'

type Env = {
  DATABASE_URL: string
  JWT_SECRET: string
}

const admin = new Hono<{ Bindings: Env }>()

// ─── Admin auth middleware ────────────────────────────────────────────────────

admin.use('*', async (c, next) => {
  const authHeader = c.req.header('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/, '')
  if (!token) throw new HTTPException(401, { message: 'Missing auth token' })

  try {
    const key = new TextEncoder().encode(c.env.JWT_SECRET)
    const { payload } = await jwtVerify(token, key)

    if (payload.role !== 'admin') {
      throw new HTTPException(403, { message: 'Admin access required' })
    }

    c.set('adminId', payload.sub as string)
    await next()
  } catch (err: any) {
    if (err instanceof HTTPException) throw err
    throw new HTTPException(401, { message: 'Invalid or expired token' })
  }
})

const getDb = (env: Env) => neon(env.DATABASE_URL)

// ─── STATS — dashboard KPIs ───────────────────────────────────────────────────

admin.get('/stats', async (c) => {
  const sql = getDb(c.env)

  const [revenue] = await sql`
    SELECT
      COALESCE(SUM(total_cents) FILTER (WHERE status = 'paid'), 0)         AS revenue_total,
      COALESCE(SUM(total_cents) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days' AND status = 'paid'), 0) AS revenue_30d,
      COUNT(*) FILTER (WHERE status NOT IN ('cancelled','refunded'))        AS order_count,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')     AS orders_30d
    FROM orders
  `

  const [users] = await sql`
    SELECT
      COUNT(*)                                                              AS user_count,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')     AS users_30d
    FROM users
  `

  const [inventory] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE stock_qty = 0)   AS out_of_stock,
      COUNT(*) FILTER (WHERE stock_qty < 5 AND stock_qty > 0) AS low_stock,
      COUNT(*)                                AS variant_count
    FROM variants WHERE is_active = TRUE
  `

  const recentOrders = await sql`
    SELECT id, status, total_cents, customer_email, created_at
    FROM orders ORDER BY created_at DESC LIMIT 5
  `

  const topProducts = await sql`
    SELECT p.name, p.slug, SUM(oi.quantity) AS units_sold, SUM(oi.total_cents) AS revenue
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    JOIN orders o ON o.id = oi.order_id
    WHERE o.status NOT IN ('cancelled', 'refunded')
    GROUP BY p.id, p.name, p.slug
    ORDER BY units_sold DESC
    LIMIT 5
  `

  return c.json({
    revenue: {
      total: revenue.revenue_total,
      last_30_days: revenue.revenue_30d,
    },
    orders: {
      total: revenue.order_count,
      last_30_days: revenue.orders_30d,
    },
    users: {
      total: users.user_count,
      last_30_days: users.users_30d,
    },
    inventory: {
      out_of_stock: inventory.out_of_stock,
      low_stock: inventory.low_stock,
      total_variants: inventory.variant_count,
    },
    recent_orders: recentOrders,
    top_products: topProducts,
  })
})

// ─── PRODUCTS ─────────────────────────────────────────────────────────────────

admin.get('/products', async (c) => {
  const sql = getDb(c.env)
  const { page = '1', limit = '25', search, category } = c.req.query()
  const offset = (parseInt(page) - 1) * parseInt(limit)

  const rows = await sql`
    SELECT p.*, c.name AS category_name,
      (SELECT COUNT(*) FROM variants v WHERE v.product_id = p.id AND v.is_active = TRUE) AS variant_count,
      (SELECT COALESCE(SUM(v.stock_qty), 0) FROM variants v WHERE v.product_id = p.id)  AS total_stock
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE (${search ?? null} IS NULL OR p.name ILIKE ${'%' + (search ?? '') + '%'})
      AND (${category ?? null} IS NULL OR c.slug = ${category ?? null})
    ORDER BY p.created_at DESC
    LIMIT ${parseInt(limit)} OFFSET ${offset}
  `

  const [{ count }] = await sql`SELECT COUNT(*) FROM products`
  return c.json({ products: rows, total: parseInt(count), page: parseInt(page), limit: parseInt(limit) })
})

admin.post('/products', async (c) => {
  const sql = getDb(c.env)
  const body = await c.req.json()
  const { slug, name, description, short_description, category_id, price_cents, compare_at_cents, images, tags, is_active, is_featured, stripe_price_id } = body

  if (!slug || !name || !price_cents) {
    throw new HTTPException(400, { message: 'slug, name, and price_cents are required' })
  }

  const [product] = await sql`
    INSERT INTO products (slug, name, description, short_description, category_id, price_cents, compare_at_cents, images, tags, is_active, is_featured, stripe_price_id)
    VALUES (
      ${slug}, ${name}, ${description ?? null}, ${short_description ?? null},
      ${category_id ?? null}, ${price_cents}, ${compare_at_cents ?? null},
      ${JSON.stringify(images ?? [])}, ${tags ?? []},
      ${is_active ?? true}, ${is_featured ?? false}, ${stripe_price_id ?? null}
    )
    RETURNING *
  `
  return c.json(product, 201)
})

admin.put('/products/:id', async (c) => {
  const sql = getDb(c.env)
  const body = await c.req.json()
  const id = c.req.param('id')
  const { name, description, short_description, price_cents, compare_at_cents, images, tags, is_active, is_featured, stripe_price_id, category_id } = body

  const [product] = await sql`
    UPDATE products SET
      name              = COALESCE(${name ?? null}, name),
      description       = COALESCE(${description ?? null}, description),
      short_description = COALESCE(${short_description ?? null}, short_description),
      price_cents       = COALESCE(${price_cents ?? null}, price_cents),
      compare_at_cents  = ${compare_at_cents ?? null},
      images            = COALESCE(${images ? JSON.stringify(images) : null}::jsonb, images),
      tags              = COALESCE(${tags ?? null}, tags),
      is_active         = COALESCE(${is_active ?? null}, is_active),
      is_featured       = COALESCE(${is_featured ?? null}, is_featured),
      stripe_price_id   = COALESCE(${stripe_price_id ?? null}, stripe_price_id),
      category_id       = COALESCE(${category_id ?? null}, category_id),
      updated_at        = NOW()
    WHERE id = ${id}
    RETURNING *
  `
  if (!product) throw new HTTPException(404, { message: 'Product not found' })
  return c.json(product)
})

admin.delete('/products/:id', async (c) => {
  const sql = getDb(c.env)
  // Soft delete — set is_active = false
  await sql`UPDATE products SET is_active = FALSE, updated_at = NOW() WHERE id = ${c.req.param('id')}`
  return c.json({ deleted: true })
})

// ─── VARIANTS ─────────────────────────────────────────────────────────────────

admin.get('/products/:id/variants', async (c) => {
  const sql = getDb(c.env)
  const rows = await sql`
    SELECT * FROM variants WHERE product_id = ${c.req.param('id')} ORDER BY created_at
  `
  return c.json(rows)
})

admin.post('/products/:id/variants', async (c) => {
  const sql = getDb(c.env)
  const { sku, name, options, price_cents, stock_qty, weight_grams, stripe_price_id } = await c.req.json()

  if (!sku || !name) throw new HTTPException(400, { message: 'sku and name are required' })

  const [variant] = await sql`
    INSERT INTO variants (product_id, sku, name, options, price_cents, stock_qty, weight_grams, stripe_price_id)
    VALUES (
      ${c.req.param('id')}, ${sku}, ${name},
      ${JSON.stringify(options ?? {})}, ${price_cents ?? null},
      ${stock_qty ?? 0}, ${weight_grams ?? null}, ${stripe_price_id ?? null}
    )
    RETURNING *
  `
  return c.json(variant, 201)
})

admin.patch('/variants/:id/stock', async (c) => {
  const sql = getDb(c.env)
  const { stock_qty, adjustment } = await c.req.json()

  let updated
  if (typeof stock_qty === 'number') {
    // Absolute set
    ;[updated] = await sql`
      UPDATE variants SET stock_qty = ${stock_qty}, updated_at = NOW()
      WHERE id = ${c.req.param('id')} RETURNING id, sku, name, stock_qty
    `
  } else if (typeof adjustment === 'number') {
    // Relative +/-
    ;[updated] = await sql`
      UPDATE variants SET stock_qty = GREATEST(0, stock_qty + ${adjustment}), updated_at = NOW()
      WHERE id = ${c.req.param('id')} RETURNING id, sku, name, stock_qty
    `
  } else {
    throw new HTTPException(400, { message: 'Provide stock_qty (absolute) or adjustment (relative)' })
  }

  if (!updated) throw new HTTPException(404, { message: 'Variant not found' })
  return c.json(updated)
})

// ─── ORDERS ───────────────────────────────────────────────────────────────────

admin.get('/orders', async (c) => {
  const sql = getDb(c.env)
  const { page = '1', limit = '25', status, search } = c.req.query()
  const offset = (parseInt(page) - 1) * parseInt(limit)

  const rows = await sql`
    SELECT o.id, o.status, o.total_cents, o.currency, o.customer_email, o.customer_name,
           o.created_at, o.shipped_at,
           u.email AS user_email,
           (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    WHERE (${status ?? null} IS NULL OR o.status = ${status ?? null})
      AND (${search ?? null} IS NULL OR o.customer_email ILIKE ${'%' + (search ?? '') + '%'})
    ORDER BY o.created_at DESC
    LIMIT ${parseInt(limit)} OFFSET ${offset}
  `

  const [{ count }] = await sql`
    SELECT COUNT(*) FROM orders
    WHERE (${status ?? null} IS NULL OR status = ${status ?? null})
  `

  return c.json({ orders: rows, total: parseInt(count), page: parseInt(page), limit: parseInt(limit) })
})

admin.get('/orders/:id', async (c) => {
  const sql = getDb(c.env)
  const [order] = await sql`SELECT * FROM orders WHERE id = ${c.req.param('id')}`
  if (!order) throw new HTTPException(404, { message: 'Order not found' })

  const items = await sql`
    SELECT oi.*, p.slug AS product_slug, p.images->0->>'url' AS product_image
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = ${order.id}
  `
  return c.json({ ...order, items })
})

admin.patch('/orders/:id/status', async (c) => {
  const sql = getDb(c.env)
  const { status, tracking_number } = await c.req.json()

  const validStatuses = ['pending', 'payment_processing', 'paid', 'fulfilling', 'shipped', 'delivered', 'cancelled', 'refunded']
  if (!validStatuses.includes(status)) {
    throw new HTTPException(400, { message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` })
  }

  const extraFields = status === 'shipped'
    ? sql`, shipped_at = NOW(), metadata = metadata || ${JSON.stringify({ tracking_number: tracking_number ?? null })}`
    : status === 'delivered'
    ? sql`, delivered_at = NOW()`
    : status === 'cancelled'
    ? sql`, cancelled_at = NOW()`
    : sql``

  const [order] = await sql`
    UPDATE orders SET status = ${status}, updated_at = NOW() ${extraFields}
    WHERE id = ${c.req.param('id')}
    RETURNING id, status, shipped_at, delivered_at, cancelled_at, metadata
  `
  if (!order) throw new HTTPException(404, { message: 'Order not found' })
  return c.json(order)
})

// ─── USERS ────────────────────────────────────────────────────────────────────

admin.get('/users', async (c) => {
  const sql = getDb(c.env)
  const { page = '1', limit = '25', search } = c.req.query()
  const offset = (parseInt(page) - 1) * parseInt(limit)

  const rows = await sql`
    SELECT u.id, u.email, u.full_name, u.created_at, u.email_verified, u.stripe_customer_id,
      (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id)                               AS order_count,
      (SELECT COALESCE(SUM(total_cents),0) FROM orders o WHERE o.user_id = u.id AND o.status = 'paid') AS lifetime_value
    FROM users u
    WHERE (${search ?? null} IS NULL OR u.email ILIKE ${'%' + (search ?? '') + '%'} OR u.full_name ILIKE ${'%' + (search ?? '') + '%'})
    ORDER BY u.created_at DESC
    LIMIT ${parseInt(limit)} OFFSET ${offset}
  `

  const [{ count }] = await sql`SELECT COUNT(*) FROM users`
  return c.json({ users: rows, total: parseInt(count), page: parseInt(page), limit: parseInt(limit) })
})

// ─── CATEGORIES ───────────────────────────────────────────────────────────────

admin.get('/categories', async (c) => {
  const sql = getDb(c.env)
  const rows = await sql`
    SELECT c.*, COUNT(p.id) AS product_count
    FROM categories c
    LEFT JOIN products p ON p.category_id = c.id AND p.is_active = TRUE
    GROUP BY c.id ORDER BY c.sort_order, c.name
  `
  return c.json(rows)
})

admin.post('/categories', async (c) => {
  const sql = getDb(c.env)
  const { slug, name, description, parent_id, sort_order } = await c.req.json()
  if (!slug || !name) throw new HTTPException(400, { message: 'slug and name are required' })

  const [cat] = await sql`
    INSERT INTO categories (slug, name, description, parent_id, sort_order)
    VALUES (${slug}, ${name}, ${description ?? null}, ${parent_id ?? null}, ${sort_order ?? 0})
    RETURNING *
  `
  return c.json(cat, 201)
})

export default admin
