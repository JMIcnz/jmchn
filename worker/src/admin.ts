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

/**
 * admin.ts — Admin API routes (mounted at /admin/*)
 * All routes require a valid JWT with role='admin'.
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
const getDb = (env: Env) => neon(env.DATABASE_URL)

// ─── Admin auth middleware ────────────────────────────────────────────────────

admin.use('*', async (c, next) => {
  const authHeader = c.req.header('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/, '')
  if (!token) throw new HTTPException(401, { message: 'Missing auth token' })
  try {
    const key = new TextEncoder().encode(c.env.JWT_SECRET)
    const { payload } = await jwtVerify(token, key)
    if (payload.role !== 'admin') throw new HTTPException(403, { message: 'Admin access required' })
    c.set('adminId', payload.sub as string)
    await next()
  } catch (err: any) {
    if (err instanceof HTTPException) throw err
    throw new HTTPException(401, { message: 'Invalid or expired token' })
  }
})

// ─── STATS ────────────────────────────────────────────────────────────────────

admin.get('/stats', async (c) => {
  const sql = getDb(c.env)

  const [revenue] = await sql`
    SELECT
      COALESCE(SUM(total_cents) FILTER (WHERE status = 'paid'), 0)                                                      AS revenue_total,
      COALESCE(SUM(total_cents) FILTER (WHERE status = 'paid' AND created_at >= NOW() - INTERVAL '30 days'), 0)         AS revenue_30d,
      COUNT(*)                FILTER (WHERE status NOT IN ('cancelled','refunded'))                                     AS order_count,
      COUNT(*)                FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')                                   AS orders_30d
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
      COUNT(*) FILTER (WHERE stock_qty = 0)              AS out_of_stock,
      COUNT(*) FILTER (WHERE stock_qty > 0 AND stock_qty < 5) AS low_stock,
      COUNT(*)                                           AS variant_count
    FROM variants WHERE is_active = TRUE
  `

  const recentOrders = await sql`
    SELECT id, status, total_cents, customer_email, created_at
    FROM orders ORDER BY created_at DESC LIMIT 5
  `

  const topProducts = await sql`
    SELECT p.name, p.slug,
           SUM(oi.quantity)   AS units_sold,
           SUM(oi.total_cents) AS revenue
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    JOIN orders   o ON o.id = oi.order_id
    WHERE o.status NOT IN ('cancelled', 'refunded')
    GROUP BY p.id, p.name, p.slug
    ORDER BY units_sold DESC
    LIMIT 5
  `

  return c.json({
    revenue:        { total: Number(revenue.revenue_total), last_30_days: Number(revenue.revenue_30d) },
    orders:         { total: Number(revenue.order_count),   last_30_days: Number(revenue.orders_30d)  },
    users:          { total: Number(users.user_count),      last_30_days: Number(users.users_30d)     },
    inventory:      { out_of_stock: Number(inventory.out_of_stock), low_stock: Number(inventory.low_stock), total_variants: Number(inventory.variant_count) },
    recent_orders:  recentOrders,
    top_products:   topProducts,
  })
})

// ─── PRODUCTS ─────────────────────────────────────────────────────────────────

admin.get('/products', async (c) => {
  const sql = getDb(c.env)
  const { page = '1', limit = '25', search, category } = c.req.query()
  const offset = (parseInt(page) - 1) * parseInt(limit)

  // Build query conditionally — avoid null parameters Neon can't type
  let rows
  if (search && category) {
    const pattern = '%' + search + '%'
    rows = await sql`
      SELECT p.*, c.name AS category_name,
        (SELECT COUNT(*) FROM variants v WHERE v.product_id = p.id AND v.is_active = TRUE) AS variant_count,
        (SELECT COALESCE(SUM(v.stock_qty), 0) FROM variants v WHERE v.product_id = p.id)  AS total_stock
      FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE c.slug = ${category} AND (p.name ILIKE ${pattern} OR p.slug ILIKE ${pattern})
      ORDER BY p.created_at DESC LIMIT ${parseInt(limit)} OFFSET ${offset}
    `
  } else if (search) {
    const pattern = '%' + search + '%'
    rows = await sql`
      SELECT p.*, c.name AS category_name,
        (SELECT COUNT(*) FROM variants v WHERE v.product_id = p.id AND v.is_active = TRUE) AS variant_count,
        (SELECT COALESCE(SUM(v.stock_qty), 0) FROM variants v WHERE v.product_id = p.id)  AS total_stock
      FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.name ILIKE ${pattern} OR p.slug ILIKE ${pattern}
      ORDER BY p.created_at DESC LIMIT ${parseInt(limit)} OFFSET ${offset}
    `
  } else if (category) {
    rows = await sql`
      SELECT p.*, c.name AS category_name,
        (SELECT COUNT(*) FROM variants v WHERE v.product_id = p.id AND v.is_active = TRUE) AS variant_count,
        (SELECT COALESCE(SUM(v.stock_qty), 0) FROM variants v WHERE v.product_id = p.id)  AS total_stock
      FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE c.slug = ${category}
      ORDER BY p.created_at DESC LIMIT ${parseInt(limit)} OFFSET ${offset}
    `
  } else {
    rows = await sql`
      SELECT p.*, c.name AS category_name,
        (SELECT COUNT(*) FROM variants v WHERE v.product_id = p.id AND v.is_active = TRUE) AS variant_count,
        (SELECT COALESCE(SUM(v.stock_qty), 0) FROM variants v WHERE v.product_id = p.id)  AS total_stock
      FROM products p LEFT JOIN categories c ON c.id = p.category_id
      ORDER BY p.created_at DESC LIMIT ${parseInt(limit)} OFFSET ${offset}
    `
  }

  const [{ count }] = await sql`SELECT COUNT(*) FROM products`
  return c.json({ products: rows, total: parseInt(count), page: parseInt(page), limit: parseInt(limit) })
})

admin.post('/products', async (c) => {
  const sql = getDb(c.env)
  const { slug, name, description, short_description, category_id, price_cents,
          compare_at_cents, images, tags, is_active, is_featured, stripe_price_id } = await c.req.json()

  if (!slug || !name || !price_cents) {
    throw new HTTPException(400, { message: 'slug, name, and price_cents are required' })
  }

  const [product] = await sql`
    INSERT INTO products (slug, name, description, short_description, category_id, price_cents,
      compare_at_cents, images, tags, is_active, is_featured, stripe_price_id)
    VALUES (
      ${slug}, ${name}, ${description ?? null}, ${short_description ?? null},
      ${category_id ?? null}, ${price_cents}, ${compare_at_cents ?? null},
      ${JSON.stringify(images ?? [])}::jsonb, ${tags ?? []}::text[],
      ${is_active ?? true}, ${is_featured ?? false}, ${stripe_price_id ?? null}
    ) RETURNING *
  `
  return c.json(product, 201)
})

admin.put('/products/:id', async (c) => {
  const sql = getDb(c.env)
  const id = c.req.param('id')
  const body = await c.req.json()

  // Fetch current values then merge — avoids null parameter type issues
  const [current] = await sql`SELECT * FROM products WHERE id = ${id}`
  if (!current) throw new HTTPException(404, { message: 'Product not found' })

  const [product] = await sql`
    UPDATE products SET
      name              = ${body.name              ?? current.name},
      description       = ${body.description       ?? current.description},
      short_description = ${body.short_description ?? current.short_description},
      price_cents       = ${body.price_cents        ?? current.price_cents},
      compare_at_cents  = ${body.compare_at_cents   ?? current.compare_at_cents},
      is_active         = ${body.is_active          ?? current.is_active},
      is_featured       = ${body.is_featured        ?? current.is_featured},
      category_id       = ${body.category_id        ?? current.category_id},
      updated_at        = NOW()
    WHERE id = ${id} RETURNING *
  `
  return c.json(product)
})

admin.delete('/products/:id', async (c) => {
  const sql = getDb(c.env)
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
      ${JSON.stringify(options ?? {})}::jsonb,
      ${price_cents ?? null}, ${stock_qty ?? 0},
      ${weight_grams ?? null}, ${stripe_price_id ?? null}
    ) RETURNING *
  `
  return c.json(variant, 201)
})

admin.patch('/variants/:id/stock', async (c) => {
  const sql = getDb(c.env)
  const { stock_qty, adjustment } = await c.req.json()

  if (typeof stock_qty === 'number') {
    const [updated] = await sql`
      UPDATE variants SET stock_qty = ${stock_qty}, updated_at = NOW()
      WHERE id = ${c.req.param('id')} RETURNING id, sku, name, stock_qty
    `
    if (!updated) throw new HTTPException(404, { message: 'Variant not found' })
    return c.json(updated)
  }

  if (typeof adjustment === 'number') {
    const [updated] = await sql`
      UPDATE variants SET stock_qty = GREATEST(0, stock_qty + ${adjustment}), updated_at = NOW()
      WHERE id = ${c.req.param('id')} RETURNING id, sku, name, stock_qty
    `
    if (!updated) throw new HTTPException(404, { message: 'Variant not found' })
    return c.json(updated)
  }

  throw new HTTPException(400, { message: 'Provide stock_qty (absolute) or adjustment (relative)' })
})

// ─── ORDERS ───────────────────────────────────────────────────────────────────

admin.get('/orders', async (c) => {
  const sql = getDb(c.env)
  const { page = '1', limit = '25', status, search } = c.req.query()
  const offset = (parseInt(page) - 1) * parseInt(limit)

  let rows
  if (status && search) {
    const pattern = '%' + search + '%'
    rows = await sql`
      SELECT o.id, o.status, o.total_cents, o.currency, o.customer_email, o.customer_name,
             o.created_at, o.shipped_at,
             (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
      FROM orders o
      WHERE o.status = ${status} AND o.customer_email ILIKE ${pattern}
      ORDER BY o.created_at DESC LIMIT ${parseInt(limit)} OFFSET ${offset}
    `
  } else if (status) {
    rows = await sql`
      SELECT o.id, o.status, o.total_cents, o.currency, o.customer_email, o.customer_name,
             o.created_at, o.shipped_at,
             (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
      FROM orders o
      WHERE o.status = ${status}
      ORDER BY o.created_at DESC LIMIT ${parseInt(limit)} OFFSET ${offset}
    `
  } else if (search) {
    const pattern = '%' + search + '%'
    rows = await sql`
      SELECT o.id, o.status, o.total_cents, o.currency, o.customer_email, o.customer_name,
             o.created_at, o.shipped_at,
             (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
      FROM orders o
      WHERE o.customer_email ILIKE ${pattern}
      ORDER BY o.created_at DESC LIMIT ${parseInt(limit)} OFFSET ${offset}
    `
  } else {
    rows = await sql`
      SELECT o.id, o.status, o.total_cents, o.currency, o.customer_email, o.customer_name,
             o.created_at, o.shipped_at,
             (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
      FROM orders o
      ORDER BY o.created_at DESC LIMIT ${parseInt(limit)} OFFSET ${offset}
    `
  }

  const [{ count }] = await sql`SELECT COUNT(*) FROM orders`
  return c.json({ orders: rows, total: parseInt(count), page: parseInt(page), limit: parseInt(limit) })
})

admin.get('/orders/:id', async (c) => {
  const sql = getDb(c.env)
  const [order] = await sql`SELECT * FROM orders WHERE id = ${c.req.param('id')}`
  if (!order) throw new HTTPException(404, { message: 'Order not found' })
  const items = await sql`
    SELECT oi.* FROM order_items oi WHERE oi.order_id = ${order.id}
  `
  return c.json({ ...order, items })
})

admin.patch('/orders/:id/status', async (c) => {
  const sql = getDb(c.env)
  const { status } = await c.req.json()

  const valid = ['pending','payment_processing','paid','fulfilling','shipped','delivered','cancelled','refunded']
  if (!valid.includes(status)) {
    throw new HTTPException(400, { message: `Invalid status. Must be one of: ${valid.join(', ')}` })
  }

  const [order] = await sql`
    UPDATE orders SET status = ${status}, updated_at = NOW()
    WHERE id = ${c.req.param('id')}
    RETURNING id, status, updated_at
  `
  if (!order) throw new HTTPException(404, { message: 'Order not found' })
  return c.json(order)
})

// ─── USERS ────────────────────────────────────────────────────────────────────

admin.get('/users', async (c) => {
  const sql = getDb(c.env)
  const { page = '1', limit = '25', search } = c.req.query()
  const offset = (parseInt(page) - 1) * parseInt(limit)

  let rows
  if (search) {
    const pattern = '%' + search + '%'
    rows = await sql`
      SELECT u.id, u.email, u.full_name, u.created_at, u.email_verified, u.stripe_customer_id,
        (SELECT COUNT(*)                FROM orders o WHERE o.user_id = u.id)                               AS order_count,
        (SELECT COALESCE(SUM(total_cents),0) FROM orders o WHERE o.user_id = u.id AND o.status = 'paid')   AS lifetime_value
      FROM users u
      WHERE u.email ILIKE ${pattern} OR u.full_name ILIKE ${pattern}
      ORDER BY u.created_at DESC LIMIT ${parseInt(limit)} OFFSET ${offset}
    `
  } else {
    rows = await sql`
      SELECT u.id, u.email, u.full_name, u.created_at, u.email_verified, u.stripe_customer_id,
        (SELECT COUNT(*)                FROM orders o WHERE o.user_id = u.id)                               AS order_count,
        (SELECT COALESCE(SUM(total_cents),0) FROM orders o WHERE o.user_id = u.id AND o.status = 'paid')   AS lifetime_value
      FROM users u
      ORDER BY u.created_at DESC LIMIT ${parseInt(limit)} OFFSET ${offset}
    `
  }

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
    INSERT INTO categories (slug, name, description, sort_order)
    VALUES (${slug}, ${name}, ${description ?? null}, ${sort_order ?? 0})
    RETURNING *
  `
  return c.json(cat, 201)
})

export default admin
