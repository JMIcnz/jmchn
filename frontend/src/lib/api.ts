/**
 * api.ts — typed client for the Cloudflare Worker API
 * Used by both Gatsby SSR (gatsby-node.js) and client-side React components.
 */

const API_BASE = process.env.GATSBY_API_URL ?? 'https://api.yourstore.com'

// ─── Token & Cart storage ────────────────────────────────────────────────────

const isBrowser = typeof window !== 'undefined'

export const storage = {
  getToken: () => (isBrowser ? localStorage.getItem('auth_token') : null),
  setToken: (t: string) => isBrowser && localStorage.setItem('auth_token', t),
  clearToken: () => isBrowser && localStorage.removeItem('auth_token'),
  getCartToken: () => (isBrowser ? localStorage.getItem('cart_token') : null),
  setCartToken: (t: string) => isBrowser && localStorage.setItem('cart_token', t),
}

// ─── Core fetch wrapper ──────────────────────────────────────────────────────

interface FetchOptions extends RequestInit {
  auth?: boolean
}

async function apiFetch<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const { auth = false, ...rest } = opts
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(rest.headers as Record<string, string>),
  }

  if (auth) {
    const token = storage.getToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
  }

  const cartToken = storage.getCartToken()
  if (cartToken) headers['X-Cart-Token'] = cartToken

  const res = await fetch(`${API_BASE}${path}`, { ...rest, headers })

  // Capture new cart token if server issued one
  const newCartToken = res.headers.get('X-Cart-Token')
  if (newCartToken) storage.setCartToken(newCartToken)

  const data = await res.json()
  if (!res.ok) throw new ApiError(data.error ?? 'Request failed', res.status)
  return data as T
}

// ─── Error type ──────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message)
    this.name = 'ApiError'
  }
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export interface User {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  created_at: string
}

export const authApi = {
  register: (email: string, password: string, full_name?: string) =>
    apiFetch<{ user: User; token: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, full_name }),
    }),

  login: (email: string, password: string) =>
    apiFetch<{ user: User; token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  me: () => apiFetch<User>('/auth/me', { auth: true }),
}

// ─── Products ────────────────────────────────────────────────────────────────

export interface ProductImage {
  url: string
  alt: string
  width?: number
  height?: number
}

export interface Variant {
  id: string
  name: string
  options: Record<string, string>
  price_cents: number | null
  sku: string
  stock_qty: number
}

export interface Product {
  id: string
  slug: string
  name: string
  description: string | null
  short_description: string | null
  price_cents: number
  compare_at_cents: number | null
  currency: string
  images: ProductImage[]
  tags: string[]
  is_featured: boolean
  category_name: string | null
  category_slug: string | null
  variants: Variant[]
}

export interface ProductsResponse {
  products: Product[]
  page: number
  limit: number
}

export const productsApi = {
  list: (params?: { category?: string; featured?: boolean; search?: string; page?: number }) =>
    apiFetch<ProductsResponse>('/products?' + new URLSearchParams(
      Object.fromEntries(Object.entries(params ?? {}).map(([k, v]) => [k, String(v)]))
    )),

  get: (slug: string) =>
    apiFetch<Product>(`/products/${slug}`),

  /** Called at Gatsby build time — all product slugs for static generation */
  getAllSlugs: async () => {
    const { products } = await apiFetch<ProductsResponse>('/products?limit=1000')
    return products.map((p) => p.slug)
  },
}

// ─── Cart ────────────────────────────────────────────────────────────────────

export interface CartItem {
  id: string
  cart_id: string
  product_id: string
  variant_id: string | null
  quantity: number
  price_cents: number
  product_name: string
  product_slug: string
  image: string | null
  variant_name: string | null
}

export interface CartState {
  cart_id?: string
  session_token?: string
  items: CartItem[]
  subtotal: number
  item_count: number
}

export const cartApi = {
  get: () => apiFetch<CartState>('/cart', { auth: true }),

  addItem: (product_id: string, variant_id?: string, quantity = 1) =>
    apiFetch<CartState>('/cart/items', {
      method: 'POST',
      auth: true,
      body: JSON.stringify({ product_id, variant_id, quantity }),
    }),

  updateItem: (itemId: string, quantity: number) =>
    apiFetch<CartState>(`/cart/items/${itemId}`, {
      method: 'PATCH',
      auth: true,
      body: JSON.stringify({ quantity }),
    }),

  removeItem: (itemId: string) =>
    apiFetch<CartState>(`/cart/items/${itemId}`, { method: 'DELETE', auth: true }),
}

// ─── Checkout ────────────────────────────────────────────────────────────────

export const checkoutApi = {
  createSession: (success_url: string, cancel_url: string) =>
    apiFetch<{ session_id: string; url: string }>('/checkout/session', {
      method: 'POST',
      auth: true,
      body: JSON.stringify({ success_url, cancel_url }),
    }),
}

// ─── Orders ──────────────────────────────────────────────────────────────────

export interface Order {
  id: string
  status: string
  total_cents: number
  currency: string
  customer_email: string
  created_at: string
}

export interface OrderDetail extends Order {
  items: Array<{
    id: string
    product_name: string
    variant_name: string | null
    quantity: number
    unit_price_cents: number
    total_cents: number
  }>
  shipping_address: {
    line1: string
    city: string
    state: string
    zip: string
    country: string
  }
}

export const ordersApi = {
  list: () => apiFetch<Order[]>('/orders', { auth: true }),
  get: (id: string) => apiFetch<OrderDetail>(`/orders/${id}`, { auth: true }),
}
