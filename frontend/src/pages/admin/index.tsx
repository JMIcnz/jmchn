/**
 * admin/index.tsx — Admin Dashboard
 *
 * Protected client-side page. Requires admin JWT.
 * Sections: Dashboard KPIs | Products | Orders | Inventory | Users
 *
 * Add to gatsby-config.js onCreatePage to redirect non-admins.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Helmet } from 'react-helmet'

const API_BASE = process.env.GATSBY_API_URL ?? 'https://api.yourstore.com'

// ─── Token helper ─────────────────────────────────────────────────────────────
const getToken = () => typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null

// ─── API helper ───────────────────────────────────────────────────────────────
async function adminFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken()
  const res = await fetch(`${API_BASE}/admin${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Request failed')
  return data as T
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface Stats {
  revenue: { total: number; last_30_days: number }
  orders:  { total: number; last_30_days: number }
  users:   { total: number; last_30_days: number }
  inventory: { out_of_stock: number; low_stock: number; total_variants: number }
  recent_orders: Order[]
  top_products: { name: string; slug: string; units_sold: number; revenue: number }[]
}

interface Product {
  id: string; slug: string; name: string; price_cents: number
  compare_at_cents: number | null; is_active: boolean; is_featured: boolean
  category_name: string | null; variant_count: number; total_stock: number
  created_at: string
}

interface Variant {
  id: string; sku: string; name: string; stock_qty: number
  price_cents: number | null; is_active: boolean
}

interface Order {
  id: string; status: string; total_cents: number; currency: string
  customer_email: string; customer_name: string | null
  item_count: number; created_at: string
}

interface User {
  id: string; email: string; full_name: string | null
  created_at: string; order_count: number; lifetime_value: number
}

// ─── Utils ────────────────────────────────────────────────────────────────────
const fmt = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

const STATUS_COLORS: Record<string, string> = {
  pending: '#8a6f3e', payment_processing: '#8a6f3e', paid: '#27ae60',
  fulfilling: '#2980b9', shipped: '#8e44ad', delivered: '#27ae60',
  cancelled: '#c0392b', refunded: '#7f8c8d',
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = {
  bg: '#0a0a0a', surface: '#111', surface2: '#181818', border: '#222',
  gold: '#c8a96e', text: '#e8e4dc', muted: '#6a6560', dim: '#3a3530',
  success: '#27ae60', error: '#c0392b', info: '#2980b9',
  font: "'Georgia', serif", mono: "'Courier New', monospace",
}

const base: React.CSSProperties = {
  background: S.bg, minHeight: '100vh', color: S.text,
  fontFamily: S.mono, fontSize: 13,
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KPICard({ label, value, sub, color = S.gold }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: S.surface, border: `1px solid ${S.border}`, padding: '24px 28px' }}>
      <p style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: S.muted, marginBottom: 10 }}>{label}</p>
      <p style={{ fontFamily: S.font, fontSize: 32, color, marginBottom: 4, fontStyle: 'italic' }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: S.muted }}>{sub}</p>}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span style={{
      fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
      color: STATUS_COLORS[status] ?? S.muted,
      border: `1px solid ${STATUS_COLORS[status] ?? S.border}`,
      padding: '3px 8px',
    }}>{status}</span>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: '10px 16px', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: S.muted, textAlign: 'left', borderBottom: `1px solid ${S.border}`, fontWeight: 400 }}>{children}</th>
}
function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return <td style={{ padding: '12px 16px', borderBottom: `1px solid ${S.border}`, fontSize: 13, fontFamily: mono ? S.mono : undefined }}>{children}</td>
}

function Input({ label, value, onChange, type = 'text', placeholder }: any) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: S.muted, marginBottom: 6 }}>{label}</label>
      <input
        type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: '100%', background: S.surface2, border: `1px solid ${S.border}`, color: S.text, padding: '9px 12px', fontSize: 13, fontFamily: S.mono, outline: 'none', boxSizing: 'border-box' }}
      />
    </div>
  )
}

function Btn({ children, onClick, variant = 'primary', small, disabled }: any) {
  const styles: React.CSSProperties = {
    padding: small ? '6px 14px' : '10px 20px',
    fontSize: small ? 11 : 12,
    letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: S.mono,
    cursor: disabled ? 'not-allowed' : 'pointer', border: 'none', opacity: disabled ? .5 : 1,
    background: variant === 'primary' ? S.gold : variant === 'danger' ? S.error : 'transparent',
    color: variant === 'ghost' ? S.muted : S.bg,
    border: variant === 'ghost' ? `1px solid ${S.border}` : 'none',
  } as any
  return <button onClick={onClick} disabled={disabled} style={styles}>{children}</button>
}

// ─── Panels ───────────────────────────────────────────────────────────────────

function DashboardPanel() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    adminFetch<Stats>('/stats').then(setStats).finally(() => setLoading(false))
  }, [])

  if (loading) return <p style={{ color: S.muted }}>Loading…</p>
  if (!stats) return <p style={{ color: S.error }}>Failed to load stats.</p>

  return (
    <div>
      <h2 style={{ fontFamily: S.font, fontStyle: 'italic', fontSize: 28, marginBottom: 28 }}>Dashboard</h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 2, marginBottom: 40 }}>
        <KPICard label="Total Revenue" value={fmt(stats.revenue.total)} sub={`${fmt(stats.revenue.last_30_days)} last 30d`} />
        <KPICard label="Total Orders" value={String(stats.orders.total)} sub={`${stats.orders.last_30_days} last 30d`} color={S.text} />
        <KPICard label="Customers" value={String(stats.users.total)} sub={`+${stats.users.last_30_days} last 30d`} color={S.text} />
        <KPICard label="Out of Stock" value={String(stats.inventory.out_of_stock)} sub={`${stats.inventory.low_stock} low stock`} color={stats.inventory.out_of_stock > 0 ? S.error : S.success} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Recent orders */}
        <div>
          <p style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: S.muted, marginBottom: 14 }}>Recent Orders</p>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: S.surface }}>
            <tbody>
              {stats.recent_orders.map(o => (
                <tr key={o.id}>
                  <Td><span style={{ fontSize: 11, color: S.gold, fontFamily: S.mono }}>{o.id.slice(0, 8)}…</span></Td>
                  <Td>{o.customer_email}</Td>
                  <Td><StatusBadge status={o.status} /></Td>
                  <Td mono>{fmt(o.total_cents)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Top products */}
        <div>
          <p style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: S.muted, marginBottom: 14 }}>Top Products</p>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: S.surface }}>
            <tbody>
              {stats.top_products.map(p => (
                <tr key={p.slug}>
                  <Td>{p.name}</Td>
                  <Td mono>{p.units_sold} sold</Td>
                  <Td mono>{fmt(p.revenue)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function ProductsPanel() {
  const [products, setProducts] = useState<Product[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editProduct, setEditProduct] = useState<Product | null>(null)
  const [showVariants, setShowVariants] = useState<Product | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    const q = new URLSearchParams({ page: String(page), limit: '20', ...(search ? { search } : {}) })
    adminFetch<{ products: Product[]; total: number }>(`/products?${q}`)
      .then(d => { setProducts(d.products); setTotal(d.total) })
      .finally(() => setLoading(false))
  }, [page, search])

  useEffect(() => { load() }, [load])

  const toggleActive = async (p: Product) => {
    await adminFetch(`/products/${p.id}`, { method: 'PUT', body: JSON.stringify({ is_active: !p.is_active }) })
    load()
  }

  const softDelete = async (p: Product) => {
    if (!window.confirm(`Archive "${p.name}"?`)) return
    await adminFetch(`/products/${p.id}`, { method: 'DELETE' })
    load()
  }

  if (showVariants) return <VariantsPanel product={showVariants} onBack={() => { setShowVariants(null); load() }} />

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ fontFamily: S.font, fontStyle: 'italic', fontSize: 28 }}>Products <span style={{ fontFamily: S.mono, fontSize: 14, color: S.muted, fontStyle: 'normal' }}>({total})</span></h2>
        <Btn onClick={() => { setEditProduct(null); setShowForm(true) }}>+ New Product</Btn>
      </div>

      <input
        placeholder="Search products…"
        value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
        style={{ width: '100%', background: S.surface2, border: `1px solid ${S.border}`, color: S.text, padding: '10px 14px', fontSize: 13, fontFamily: S.mono, outline: 'none', marginBottom: 20, boxSizing: 'border-box' }}
      />

      {showForm && (
        <ProductForm
          initial={editProduct}
          onSave={() => { setShowForm(false); load() }}
          onCancel={() => setShowForm(false)}
        />
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', background: S.surface }}>
        <thead>
          <tr>
            <Th>Name</Th><Th>Category</Th><Th>Price</Th>
            <Th>Stock</Th><Th>Variants</Th><Th>Status</Th><Th>Actions</Th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={7} style={{ padding: 24, color: S.muted, textAlign: 'center' }}>Loading…</td></tr>
          ) : products.map(p => (
            <tr key={p.id} style={{ transition: 'background .15s' }}
              onMouseEnter={e => (e.currentTarget.style.background = S.surface2)}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <Td>
                <p style={{ fontFamily: S.font, fontStyle: 'italic', fontSize: 16 }}>{p.name}</p>
                <p style={{ fontSize: 11, color: S.muted }}>{p.slug}</p>
              </Td>
              <Td>{p.category_name ?? '—'}</Td>
              <Td mono>
                {fmt(p.price_cents)}
                {p.compare_at_cents && <span style={{ color: S.muted, textDecoration: 'line-through', marginLeft: 8 }}>{fmt(p.compare_at_cents)}</span>}
              </Td>
              <Td>
                <span style={{ color: p.total_stock === 0 ? S.error : p.total_stock < 5 ? S.gold : S.success }}>
                  {p.total_stock} units
                </span>
              </Td>
              <Td>
                <button onClick={() => setShowVariants(p)} style={{ fontSize: 11, color: S.gold, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                  {p.variant_count} variants
                </button>
              </Td>
              <Td>
                <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: p.is_active ? S.success : S.muted }}>
                  {p.is_active ? 'Active' : 'Inactive'}
                </span>
              </Td>
              <Td>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Btn small variant="ghost" onClick={() => { setEditProduct(p); setShowForm(true) }}>Edit</Btn>
                  <Btn small variant="ghost" onClick={() => toggleActive(p)}>{p.is_active ? 'Disable' : 'Enable'}</Btn>
                  <Btn small variant="danger" onClick={() => softDelete(p)}>Archive</Btn>
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
        <span style={{ fontSize: 12, color: S.muted }}>Showing {products.length} of {total}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn small variant="ghost" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>← Prev</Btn>
          <Btn small variant="ghost" onClick={() => setPage(p => p + 1)} disabled={products.length < 20}>Next →</Btn>
        </div>
      </div>
    </div>
  )
}

function ProductForm({ initial, onSave, onCancel }: { initial: Product | null; onSave: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    name: initial?.name ?? '', slug: initial?.slug ?? '',
    price_cents: initial ? String(initial.price_cents / 100) : '',
    compare_at_cents: initial?.compare_at_cents ? String(initial.compare_at_cents / 100) : '',
    is_active: initial?.is_active ?? true, is_featured: initial?.is_featured ?? false,
  })
  const [saving, setSaving] = useState(false)
  const set = (k: string) => (v: any) => setForm(f => ({ ...f, [k]: v }))

  const save = async () => {
    setSaving(true)
    const body = {
      name: form.name, slug: form.slug,
      price_cents: Math.round(parseFloat(form.price_cents) * 100),
      compare_at_cents: form.compare_at_cents ? Math.round(parseFloat(form.compare_at_cents) * 100) : null,
      is_active: form.is_active, is_featured: form.is_featured,
    }
    try {
      if (initial) {
        await adminFetch(`/products/${initial.id}`, { method: 'PUT', body: JSON.stringify(body) })
      } else {
        await adminFetch('/products', { method: 'POST', body: JSON.stringify(body) })
      }
      onSave()
    } finally { setSaving(false) }
  }

  return (
    <div style={{ background: S.surface2, border: `1px solid ${S.border}`, padding: 28, marginBottom: 24 }}>
      <h3 style={{ fontFamily: S.font, fontStyle: 'italic', fontSize: 22, marginBottom: 20 }}>{initial ? 'Edit Product' : 'New Product'}</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Input label="Name" value={form.name} onChange={set('name')} />
        <Input label="Slug" value={form.slug} onChange={set('slug')} placeholder="url-friendly-slug" />
        <Input label="Price (USD)" value={form.price_cents} onChange={set('price_cents')} type="number" placeholder="0.00" />
        <Input label="Compare-at Price" value={form.compare_at_cents} onChange={set('compare_at_cents')} type="number" placeholder="0.00" />
      </div>
      <div style={{ display: 'flex', gap: 24, marginBottom: 20 }}>
        {(['is_active', 'is_featured'] as const).map(key => (
          <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: S.muted, cursor: 'pointer' }}>
            <input type="checkbox" checked={form[key] as boolean} onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))} />
            {key === 'is_active' ? 'Active' : 'Featured'}
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <Btn onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Product'}</Btn>
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  )
}

function VariantsPanel({ product, onBack }: { product: Product; onBack: () => void }) {
  const [variants, setVariants] = useState<Variant[]>([])
  const [stockEdit, setStockEdit] = useState<Record<string, string>>({})
  const [newVariant, setNewVariant] = useState({ sku: '', name: '', stock_qty: '0', price_cents: '' })
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    adminFetch<Variant[]>(`/products/${product.id}/variants`).then(setVariants)
  }, [product.id])

  useEffect(() => { load() }, [load])

  const updateStock = async (variantId: string) => {
    const val = stockEdit[variantId]
    if (val === undefined) return
    await adminFetch(`/variants/${variantId}/stock`, { method: 'PATCH', body: JSON.stringify({ stock_qty: parseInt(val) }) })
    setStockEdit(s => { const n = { ...s }; delete n[variantId]; return n })
    load()
  }

  const addVariant = async () => {
    setSaving(true)
    await adminFetch(`/products/${product.id}/variants`, {
      method: 'POST',
      body: JSON.stringify({ sku: newVariant.sku, name: newVariant.name, stock_qty: parseInt(newVariant.stock_qty), price_cents: newVariant.price_cents ? Math.round(parseFloat(newVariant.price_cents) * 100) : null }),
    })
    setNewVariant({ sku: '', name: '', stock_qty: '0', price_cents: '' })
    setSaving(false)
    load()
  }

  return (
    <div>
      <button onClick={onBack} style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: S.muted, background: 'none', border: 'none', cursor: 'pointer', marginBottom: 24 }}>← Back to Products</button>
      <h2 style={{ fontFamily: S.font, fontStyle: 'italic', fontSize: 28, marginBottom: 6 }}>Variants — {product.name}</h2>
      <p style={{ fontSize: 12, color: S.muted, marginBottom: 28 }}>Manage stock levels and variant options</p>

      <table style={{ width: '100%', borderCollapse: 'collapse', background: S.surface, marginBottom: 32 }}>
        <thead>
          <tr><Th>SKU</Th><Th>Name</Th><Th>Price</Th><Th>Stock</Th><Th>Status</Th><Th>Update Stock</Th></tr>
        </thead>
        <tbody>
          {variants.map(v => (
            <tr key={v.id}>
              <Td mono>{v.sku}</Td>
              <Td>{v.name}</Td>
              <Td mono>{v.price_cents ? fmt(v.price_cents) : <span style={{ color: S.muted }}>Inherited</span>}</Td>
              <Td>
                <span style={{ color: v.stock_qty === 0 ? S.error : v.stock_qty < 5 ? S.gold : S.success, fontFamily: S.mono }}>
                  {v.stock_qty}
                </span>
              </Td>
              <Td>
                <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: v.is_active ? S.success : S.muted }}>
                  {v.is_active ? 'Active' : 'Inactive'}
                </span>
              </Td>
              <Td>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="number" min="0"
                    value={stockEdit[v.id] ?? v.stock_qty}
                    onChange={e => setStockEdit(s => ({ ...s, [v.id]: e.target.value }))}
                    style={{ width: 72, background: S.surface2, border: `1px solid ${S.border}`, color: S.text, padding: '5px 8px', fontSize: 12, fontFamily: S.mono, outline: 'none' }}
                  />
                  <Btn small onClick={() => updateStock(v.id)} disabled={stockEdit[v.id] === undefined}>Save</Btn>
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Add variant */}
      <div style={{ background: S.surface2, border: `1px solid ${S.border}`, padding: 24 }}>
        <p style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: S.muted, marginBottom: 16 }}>Add Variant</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Input label="SKU" value={newVariant.sku} onChange={(v: string) => setNewVariant(f => ({ ...f, sku: v }))} />
          <Input label="Name" value={newVariant.name} onChange={(v: string) => setNewVariant(f => ({ ...f, name: v }))} placeholder="e.g. Blue / L" />
          <Input label="Stock" value={newVariant.stock_qty} onChange={(v: string) => setNewVariant(f => ({ ...f, stock_qty: v }))} type="number" />
          <Input label="Price (blank = inherit)" value={newVariant.price_cents} onChange={(v: string) => setNewVariant(f => ({ ...f, price_cents: v }))} type="number" />
        </div>
        <Btn onClick={addVariant} disabled={saving || !newVariant.sku || !newVariant.name}>{saving ? 'Adding…' : 'Add Variant'}</Btn>
      </div>
    </div>
  )
}

function OrdersPanel() {
  const [orders, setOrders] = useState<Order[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    const q = new URLSearchParams({ page: String(page), limit: '25', ...(statusFilter ? { status: statusFilter } : {}), ...(search ? { search } : {}) })
    adminFetch<{ orders: Order[]; total: number }>(`/orders?${q}`)
      .then(d => { setOrders(d.orders); setTotal(d.total) })
      .finally(() => setLoading(false))
  }, [page, statusFilter, search])

  useEffect(() => { load() }, [load])

  const updateStatus = async (orderId: string, status: string) => {
    setUpdatingId(orderId)
    await adminFetch(`/orders/${orderId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })
    setUpdatingId(null)
    load()
  }

  const STATUSES = ['', 'paid', 'fulfilling', 'shipped', 'delivered', 'cancelled', 'refunded']

  return (
    <div>
      <h2 style={{ fontFamily: S.font, fontStyle: 'italic', fontSize: 28, marginBottom: 24 }}>Orders <span style={{ fontFamily: S.mono, fontSize: 14, color: S.muted, fontStyle: 'normal' }}>({total})</span></h2>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <input
          placeholder="Search by email…" value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
          style={{ flex: 1, background: S.surface2, border: `1px solid ${S.border}`, color: S.text, padding: '9px 12px', fontSize: 13, fontFamily: S.mono, outline: 'none' }}
        />
        <select
          value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
          style={{ background: S.surface2, border: `1px solid ${S.border}`, color: S.text, padding: '9px 12px', fontSize: 12, fontFamily: S.mono, outline: 'none' }}
        >
          {STATUSES.map(s => <option key={s} value={s}>{s || 'All statuses'}</option>)}
        </select>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', background: S.surface }}>
        <thead>
          <tr><Th>Order ID</Th><Th>Customer</Th><Th>Items</Th><Th>Total</Th><Th>Status</Th><Th>Date</Th><Th>Update Status</Th></tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={7} style={{ padding: 24, color: S.muted, textAlign: 'center' }}>Loading…</td></tr>
          ) : orders.map(o => (
            <tr key={o.id}
              onMouseEnter={e => (e.currentTarget.style.background = S.surface2)}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <Td><span style={{ fontFamily: S.mono, fontSize: 11, color: S.gold }}>{o.id.slice(0, 8)}…</span></Td>
              <Td>
                <p>{o.customer_name ?? '—'}</p>
                <p style={{ fontSize: 11, color: S.muted }}>{o.customer_email}</p>
              </Td>
              <Td mono>{o.item_count}</Td>
              <Td mono>{fmt(o.total_cents)}</Td>
              <Td><StatusBadge status={o.status} /></Td>
              <Td>{fmtDate(o.created_at)}</Td>
              <Td>
                <select
                  value={o.status}
                  disabled={updatingId === o.id}
                  onChange={e => updateStatus(o.id, e.target.value)}
                  style={{ background: S.surface2, border: `1px solid ${S.border}`, color: S.text, padding: '5px 8px', fontSize: 11, fontFamily: S.mono, outline: 'none', cursor: 'pointer' }}
                >
                  {STATUSES.filter(Boolean).map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
        <span style={{ fontSize: 12, color: S.muted }}>Showing {orders.length} of {total}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn small variant="ghost" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>← Prev</Btn>
          <Btn small variant="ghost" onClick={() => setPage(p => p + 1)} disabled={orders.length < 25}>Next →</Btn>
        </div>
      </div>
    </div>
  )
}

function UsersPanel() {
  const [users, setUsers] = useState<User[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    const q = new URLSearchParams({ page: String(page), limit: '25', ...(search ? { search } : {}) })
    adminFetch<{ users: User[]; total: number }>(`/users?${q}`)
      .then(d => { setUsers(d.users); setTotal(d.total) })
      .finally(() => setLoading(false))
  }, [page, search])

  useEffect(() => { load() }, [load])

  return (
    <div>
      <h2 style={{ fontFamily: S.font, fontStyle: 'italic', fontSize: 28, marginBottom: 24 }}>Customers <span style={{ fontFamily: S.mono, fontSize: 14, color: S.muted, fontStyle: 'normal' }}>({total})</span></h2>

      <input
        placeholder="Search by email or name…" value={search}
        onChange={e => { setSearch(e.target.value); setPage(1) }}
        style={{ width: '100%', background: S.surface2, border: `1px solid ${S.border}`, color: S.text, padding: '10px 14px', fontSize: 13, fontFamily: S.mono, outline: 'none', marginBottom: 20, boxSizing: 'border-box' }}
      />

      <table style={{ width: '100%', borderCollapse: 'collapse', background: S.surface }}>
        <thead>
          <tr><Th>Customer</Th><Th>Orders</Th><Th>Lifetime Value</Th><Th>Joined</Th><Th>Stripe ID</Th></tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={5} style={{ padding: 24, color: S.muted, textAlign: 'center' }}>Loading…</td></tr>
          ) : users.map(u => (
            <tr key={u.id}
              onMouseEnter={e => (e.currentTarget.style.background = S.surface2)}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <Td>
                <p>{u.full_name ?? '—'}</p>
                <p style={{ fontSize: 11, color: S.muted }}>{u.email}</p>
              </Td>
              <Td mono>{u.order_count}</Td>
              <Td mono style={{ color: u.lifetime_value > 0 ? S.gold : S.muted }}>{fmt(u.lifetime_value)}</Td>
              <Td>{fmtDate(u.created_at)}</Td>
              <Td><span style={{ fontSize: 11, color: S.muted, fontFamily: S.mono }}>{u.stripe_customer_id ? u.stripe_customer_id.slice(0, 14) + '…' : '—'}</span></Td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
        <span style={{ fontSize: 12, color: S.muted }}>Showing {users.length} of {total}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn small variant="ghost" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>← Prev</Btn>
          <Btn small variant="ghost" onClick={() => setPage(p => p + 1)} disabled={users.length < 25}>Next →</Btn>
        </div>
      </div>
    </div>
  )
}

// ─── Login gate ───────────────────────────────────────────────────────────────

function AdminLogin({ onLogin }: { onLogin: () => void }) {
  const [tab, setTab] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  // Handle Google OAuth callback — token returned as ?token=... in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')
    const oauthError = params.get('error')
    if (token) {
      localStorage.setItem('admin_token', token)
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname)
      onLogin()
    }
    if (oauthError) setError(decodeURIComponent(oauthError))
  }, [onLogin])

  const submitEmailAuth = async () => {
    setLoading(true); setError('')
    try {
      const endpoint = tab === 'login' ? '/auth/login' : '/auth/register'
      const body = tab === 'login'
        ? { email, password }
        : { email, password, full_name: name }

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      if (data.user?.role !== 'admin') throw new Error('This account does not have admin access. Ask your administrator to grant access.')
      localStorage.setItem('admin_token', data.token)
      onLogin()
    } catch (err: any) {
      setError(err.message)
    } finally { setLoading(false) }
  }

  const loginWithGoogle = () => {
    setGoogleLoading(true)
    // Redirect to Worker OAuth initiation endpoint
    const returnTo = encodeURIComponent(window.location.href)
    window.location.href = `${API_BASE}/auth/google?return_to=${returnTo}`
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') submitEmailAuth()
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: S.bg }}>
      <div style={{ width: 400, background: S.surface, border: `1px solid ${S.border}`, padding: '48px 44px' }}>

        {/* Logo */}
        <h1 style={{ fontFamily: S.font, fontStyle: 'italic', fontSize: 32, color: S.gold, marginBottom: 4 }}>STRATUM</h1>
        <p style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: S.muted, marginBottom: 36 }}>Admin Panel</p>

        {/* Google OAuth button */}
        <button
          onClick={loginWithGoogle}
          disabled={googleLoading}
          style={{
            width: '100%', padding: '11px 0', marginBottom: 20,
            background: '#fff', color: '#3c4043', border: '1px solid #dadce0',
            fontSize: 13, fontFamily: S.mono, cursor: googleLoading ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            opacity: googleLoading ? 0.7 : 1, transition: 'box-shadow .2s',
          }}
          onMouseEnter={e => !googleLoading && ((e.currentTarget as HTMLButtonElement).style.boxShadow = '0 1px 6px rgba(0,0,0,.3)')}
          onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.boxShadow = 'none')}
        >
          {/* Google G logo */}
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#4285F4" d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z"/>
            <path fill="#34A853" d="M6.3 14.7l7 5.1C15 16.1 19.1 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 16.3 2 9.7 7.4 6.3 14.7z"/>
            <path fill="#FBBC05" d="M24 46c5.5 0 10.5-1.9 14.3-5.1l-6.6-5.4C29.6 37 26.9 38 24 38c-6 0-10.6-3.1-11.7-8.5l-7 5.4C8.4 42.1 15.6 46 24 46z"/>
            <path fill="#EA4335" d="M44.5 20H24v8.5h11.8c-.9 2.8-2.8 5-5.3 6.5l6.6 5.4C41.1 37.3 45 31.3 45 24c0-1.3-.2-2.7-.5-4z"/>
          </svg>
          {googleLoading ? 'Redirecting…' : 'Continue with Google'}
        </button>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div style={{ flex: 1, height: 1, background: S.border }} />
          <span style={{ fontSize: 11, color: S.dim, letterSpacing: '0.06em' }}>OR</span>
          <div style={{ flex: 1, height: 1, background: S.border }} />
        </div>

        {/* Tab switcher */}
        <div style={{ display: 'flex', marginBottom: 24, border: `1px solid ${S.border}` }}>
          {(['login', 'register'] as const).map(t => (
            <button key={t} onClick={() => { setTab(t); setError('') }} style={{
              flex: 1, padding: '9px 0', fontSize: 11, letterSpacing: '0.1em',
              textTransform: 'uppercase', background: tab === t ? S.surface2 : 'none',
              color: tab === t ? S.gold : S.muted, border: 'none', cursor: 'pointer',
              fontFamily: S.mono, borderBottom: `2px solid ${tab === t ? S.gold : 'transparent'}`,
              transition: 'all .2s',
            }}>
              {t === 'login' ? 'Sign In' : 'Register'}
            </button>
          ))}
        </div>

        {/* Form */}
        {tab === 'register' && (
          <Input label="Full Name" value={name} onChange={setName} placeholder="Your name" />
        )}
        <Input label="Email" value={email} onChange={setEmail} type="email" placeholder="admin@yourstore.com" />
        <div onKeyDown={handleKeyDown}>
          <Input label="Password" value={password} onChange={setPassword} type="password" placeholder="••••••••" />
        </div>

        {error && (
          <div style={{ background: '#1a0808', border: `1px solid ${S.error}`, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: '#e74c3c', lineHeight: 1.5 }}>
            {error}
          </div>
        )}

        <Btn onClick={submitEmailAuth} disabled={loading}>
          {loading ? 'Please wait…' : tab === 'login' ? 'Sign In' : 'Create Account'}
        </Btn>

        <p style={{ fontSize: 11, color: S.dim, marginTop: 20, lineHeight: 1.6, textAlign: 'center' }}>
          {tab === 'register'
            ? 'New accounts require admin role to be granted by an existing admin.'
            : 'Only accounts with admin role can access this panel.'}
        </p>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type Panel = 'dashboard' | 'products' | 'orders' | 'users'

export default function AdminPage() {
  const [authed, setAuthed] = useState(false)
  const [panel, setPanel] = useState<Panel>('dashboard')

  useEffect(() => {
    setAuthed(!!getToken())
  }, [])

  if (!authed) return <AdminLogin onLogin={() => setAuthed(true)} />

  const NAV: { key: Panel; label: string }[] = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'products',  label: 'Products'  },
    { key: 'orders',    label: 'Orders'    },
    { key: 'users',     label: 'Customers' },
  ]

  return (
    <>
      <Helmet>
        <title>Admin — STRATUM</title>
        <meta name="robots" content="noindex,nofollow" />
      </Helmet>

      <div style={base}>
        {/* Sidebar */}
        <div style={{ display: 'flex', minHeight: '100vh' }}>
          <aside style={{ width: 220, background: S.surface, borderRight: `1px solid ${S.border}`, padding: '28px 0', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '0 24px 32px' }}>
              <p style={{ fontFamily: S.font, fontStyle: 'italic', fontSize: 22, color: S.gold }}>STRATUM</p>
              <p style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: S.muted }}>Admin Panel</p>
            </div>

            <nav style={{ flex: 1 }}>
              {NAV.map(({ key, label }) => (
                <button key={key} onClick={() => setPanel(key)} style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '12px 24px', fontSize: 12, letterSpacing: '0.08em',
                  textTransform: 'uppercase', background: panel === key ? S.surface2 : 'none',
                  color: panel === key ? S.gold : S.muted, border: 'none', cursor: 'pointer',
                  borderLeft: `2px solid ${panel === key ? S.gold : 'transparent'}`,
                  transition: 'all .2s', fontFamily: S.mono,
                }}>
                  {label}
                </button>
              ))}
            </nav>

            <div style={{ padding: '0 24px' }}>
              <button onClick={() => { localStorage.removeItem('admin_token'); setAuthed(false) }}
                style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: S.muted, background: 'none', border: 'none', cursor: 'pointer', fontFamily: S.mono }}>
                Sign Out
              </button>
            </div>
          </aside>

          {/* Content */}
          <main style={{ flex: 1, padding: '40px 48px', overflowY: 'auto' }}>
            {panel === 'dashboard' && <DashboardPanel />}
            {panel === 'products'  && <ProductsPanel />}
            {panel === 'orders'    && <OrdersPanel />}
            {panel === 'users'     && <UsersPanel />}
          </main>
        </div>
      </div>
    </>
  )
}
