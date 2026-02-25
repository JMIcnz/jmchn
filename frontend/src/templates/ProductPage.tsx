/**
 * ProductPage.tsx — Static Gatsby template
 *
 * Rendered at BUILD TIME from gatsby-node.js context.
 * The product data comes from the API during build — no client fetch needed.
 * Add-to-cart is a client-side action via CartContext.
 */

import React, { useState, useCallback, useEffect } from 'react'
import { Helmet } from 'react-helmet'
import { Link } from 'gatsby'

const API_BASE = process.env.GATSBY_API_URL || ''

// ── Types ──────────────────────────────────────────────────────────────────────
interface ProductImage { url: string; alt?: string }
interface Variant { id: string; name: string; options: Record<string, string>; price_cents: number | null; sku: string; stock_qty: number }
interface Product {
  id: string; slug: string; name: string; description: string | null
  short_description: string | null; price_cents: number; compare_at_cents: number | null
  currency: string; images: ProductImage[] | string; tags: string[]
  is_featured: boolean; category_name: string | null; category_slug: string | null
  variants: Variant[]
}
interface CartItem {
  id: string; product_id: string; variant_id: string | null; quantity: number
  price_cents: number; product_name: string; variant_name: string | null; image: string | null
}
interface CartState { items: CartItem[]; subtotal: number; item_count: number }

// ── Helpers ────────────────────────────────────────────────────────────────────
const fmt = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
const parseImages = (raw: any): ProductImage[] => {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try { return JSON.parse(raw) } catch { return [] }
}

// ── API helpers ────────────────────────────────────────────────────────────────
function getHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = localStorage.getItem('auth_token')
  const cartToken = localStorage.getItem('cart_token')
  if (token) h['Authorization'] = `Bearer ${token}`
  if (cartToken) h['X-Cart-Token'] = cartToken
  return h
}

async function fetchCart(): Promise<CartState> {
  const res = await fetch(`${API_BASE}/cart`, { headers: getHeaders() })
  if (!res.ok) return { items: [], subtotal: 0, item_count: 0 }
  return res.json()
}

async function apiAddItem(product_id: string, variant_id?: string, quantity = 1): Promise<CartState> {
  const res = await fetch(`${API_BASE}/cart/items`, {
    method: 'POST', headers: getHeaders(),
    body: JSON.stringify({ product_id, variant_id, quantity }),
  })
  const newCartToken = res.headers.get('X-Cart-Token')
  if (newCartToken) localStorage.setItem('cart_token', newCartToken)
  return res.json()
}

async function apiUpdateItem(itemId: string, quantity: number): Promise<CartState> {
  const res = await fetch(`${API_BASE}/cart/items/${itemId}`, {
    method: 'PATCH', headers: getHeaders(),
    body: JSON.stringify({ quantity }),
  })
  return res.json()
}

async function apiRemoveItem(itemId: string): Promise<CartState> {
  const res = await fetch(`${API_BASE}/cart/items/${itemId}`, {
    method: 'DELETE', headers: getHeaders(),
  })
  return res.json()
}

// ── Cart Drawer ────────────────────────────────────────────────────────────────
function CartDrawer({ open, onClose, cart, onUpdate, onRemove, onCheckout, checkingOut }: {
  open: boolean; onClose: () => void; cart: CartState
  onUpdate: (id: string, qty: number) => void
  onRemove: (id: string) => void
  onCheckout: () => void
  checkingOut: boolean
}) {
  const S = { bg: '#0a0a0a', surface: '#111', surface2: '#181818', border: '#222', gold: '#c8a96e', text: '#e8e4dc', muted: '#6a6560', error: '#c0392b' }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 199, cursor: 'pointer' }} />
      )}

      {/* Drawer */}
      <aside style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(460px, 100vw)',
        background: S.surface, borderLeft: `1px solid ${S.border}`,
        zIndex: 200, display: 'flex', flexDirection: 'column',
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.35s cubic-bezier(0.25,0.46,0.45,0.94)',
        fontFamily: "'Courier New', monospace",
      }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: `1px solid ${S.border}` }}>
          <h2 style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 24, color: S.text, display: 'flex', alignItems: 'center', gap: 10 }}>
            Cart
            <span style={{ fontFamily: "'Courier New', monospace", fontSize: 13, color: S.muted, fontStyle: 'normal' }}>{cart.item_count}</span>
          </h2>
          <button onClick={onClose} style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${S.border}`, background: 'none', color: S.muted, cursor: 'pointer', fontSize: 14, transition: 'all .2s' }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = S.muted; (e.currentTarget as HTMLButtonElement).style.color = S.text }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = S.border; (e.currentTarget as HTMLButtonElement).style.color = S.muted }}>
            ✕
          </button>
        </div>

        {/* Items */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {cart.items.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, color: S.muted, padding: 32 }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity={0.3}>
                <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>
              </svg>
              <p style={{ fontSize: 13 }}>Your cart is empty</p>
              <button onClick={onClose} style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', border: `1px solid ${S.border}`, background: 'none', color: S.muted, padding: '8px 20px', cursor: 'pointer', fontFamily: 'inherit' }}>
                Continue Shopping
              </button>
            </div>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {cart.items.map(item => (
                <li key={item.id} style={{ display: 'flex', gap: 14, padding: '16px 24px', borderBottom: `1px solid ${S.border}` }}>
                  {/* Image */}
                  <div style={{ width: 72, height: 90, background: S.surface2, flexShrink: 0, overflow: 'hidden' }}>
                    {item.image && <img src={item.image} alt={item.product_name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
                  </div>

                  {/* Details */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 16, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: S.text }}>{item.product_name}</p>
                    {item.variant_name && <p style={{ fontSize: 11, color: S.muted, marginBottom: 6 }}>{item.variant_name}</p>}
                    <p style={{ fontSize: 13, color: S.gold, marginBottom: 10 }}>{fmt(item.price_cents)}</p>

                    {/* Qty control */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, border: `1px solid ${S.border}`, width: 'fit-content', padding: '3px 8px' }}>
                      <button onClick={() => item.quantity > 1 ? onUpdate(item.id, item.quantity - 1) : onRemove(item.id)}
                        style={{ background: 'none', border: 'none', color: S.muted, cursor: 'pointer', fontSize: 16, width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                      <span style={{ fontSize: 12, minWidth: 18, textAlign: 'center' }}>{item.quantity}</span>
                      <button onClick={() => onUpdate(item.id, item.quantity + 1)}
                        style={{ background: 'none', border: 'none', color: S.muted, cursor: 'pointer', fontSize: 16, width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                    </div>
                  </div>

                  {/* Right side */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                    <span style={{ fontFamily: 'Georgia, serif', fontSize: 17, color: S.text }}>{fmt(item.price_cents * item.quantity)}</span>
                    <button onClick={() => onRemove(item.id)}
                      style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#3a3530', background: 'none', border: 'none', cursor: 'pointer', transition: 'color .2s', fontFamily: 'inherit' }}
                      onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color = S.error}
                      onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = '#3a3530'}>
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        {cart.items.length > 0 && (
          <div style={{ padding: '20px 24px', borderTop: `1px solid ${S.border}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <span style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 20, color: S.text }}>Subtotal</span>
              <span style={{ fontFamily: 'Georgia, serif', fontSize: 22, color: S.text }}>{fmt(cart.subtotal)}</span>
            </div>
            <p style={{ fontSize: 11, color: S.muted, marginBottom: 16 }}>Shipping & tax calculated at checkout</p>
            <button
              onClick={onCheckout}
              disabled={checkingOut}
              style={{ width: '100%', padding: '14px 0', background: S.gold, color: '#0a0a0a', fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 500, border: 'none', cursor: checkingOut ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: checkingOut ? 0.6 : 1, transition: 'all .2s' }}>
              {checkingOut ? 'Redirecting to Stripe…' : `Checkout — ${fmt(cart.subtotal)}`}
            </button>
          </div>
        )}
      </aside>
    </>
  )
}

// ── Main Template ──────────────────────────────────────────────────────────────
export default function ProductPage({ pageContext }: { pageContext: { product: Product } }) {
  const { product } = pageContext
  const images = parseImages(product.images)
  const variants: Variant[] = Array.isArray(product.variants) ? product.variants : []
  const tags: string[] = Array.isArray(product.tags) ? product.tags : []

  const [selectedVariant, setSelectedVariant] = useState<Variant | null>(
    variants.find(v => v.stock_qty > 0) ?? variants[0] ?? null
  )
  const [qty, setQty] = useState(1)
  const [activeImage, setActiveImage] = useState(0)
  const [cartOpen, setCartOpen] = useState(false)
  const [cart, setCart] = useState<CartState>({ items: [], subtotal: 0, item_count: 0 })
  const [addingToCart, setAddingToCart] = useState(false)
  const [justAdded, setJustAdded] = useState(false)
  const [checkingOut, setCheckingOut] = useState(false)

  const price = selectedVariant?.price_cents ?? product.price_cents
  const inStock = selectedVariant ? selectedVariant.stock_qty > 0 : true
  const mainImage = images[activeImage]?.url ?? ''
  const optionKeys = variants.length ? [...new Set(variants.flatMap(v => Object.keys(v.options ?? {})))] : []

  // Load cart on mount (browser only)
  useEffect(() => {
    if (typeof window === 'undefined') return
    fetchCart().then(setCart).catch(() => {})
  }, [])

  const handleAddToCart = useCallback(async () => {
    setAddingToCart(true)
    try {
      const updated = await apiAddItem(product.id, selectedVariant?.id, qty)
      setCart(updated)
      setJustAdded(true)
      setCartOpen(true)
      setTimeout(() => setJustAdded(false), 2000)
    } catch (err) {
      console.error('Add to cart failed', err)
    } finally {
      setAddingToCart(false)
    }
  }, [product.id, selectedVariant, qty])

  const handleUpdate = useCallback(async (itemId: string, newQty: number) => {
    const updated = await apiUpdateItem(itemId, newQty)
    setCart(updated)
  }, [])

  const handleRemove = useCallback(async (itemId: string) => {
    const updated = await apiRemoveItem(itemId)
    setCart(updated)
  }, [])

  const handleCheckout = useCallback(async () => {
    setCheckingOut(true)
    try {
      const res = await fetch(`${API_BASE}/checkout/session`, {
        method: 'POST', headers: getHeaders(),
        body: JSON.stringify({
          success_url: `${window.location.origin}/order-success`,
          cancel_url: window.location.href,
        }),
      })
      const data = await res.json()
      if (data.url) window.location.href = data.url
    } catch (err) {
      console.error('Checkout failed', err)
      setCheckingOut(false)
    }
  }, [])

  const S = { bg: '#0a0a0a', surface: '#111', border: '#222', gold: '#c8a96e', text: '#e8e4dc', muted: '#6a6560' }

  const structuredData = {
    '@context': 'https://schema.org', '@type': 'Product',
    name: product.name, description: product.description ?? '',
    image: images.map(i => i.url),
    offers: { '@type': 'Offer', priceCurrency: product.currency ?? 'USD', price: (price / 100).toFixed(2), availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock' },
  }

  return (
    <>
      <Helmet>
        <title>{product.name} — STRATUM</title>
        <meta name="description" content={product.short_description ?? product.description ?? ''} />
        <meta property="og:title" content={product.name} />
        {mainImage && <meta property="og:image" content={mainImage} />}
        <script type="application/ld+json">{JSON.stringify(structuredData)}</script>
      </Helmet>

      <div style={{ background: S.bg, minHeight: '100vh', color: S.text, fontFamily: "'Courier New', monospace" }}>

        {/* Header */}
        <header style={{ borderBottom: `1px solid ${S.border}`, padding: '0 32px', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: 'rgba(10,10,10,.95)', backdropFilter: 'blur(12px)', zIndex: 10 }}>
          <Link to="/" style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 22, color: S.gold, letterSpacing: '0.1em', textDecoration: 'none' }}>STRATUM</Link>
          <button onClick={() => setCartOpen(true)} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', color: S.muted, cursor: 'pointer', fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'inherit' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>
            </svg>
            Cart
            {cart.item_count > 0 && (
              <span style={{ position: 'absolute', top: -6, right: -10, width: 16, height: 16, background: S.gold, color: S.bg, fontSize: 10, fontWeight: 600, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {cart.item_count}
              </span>
            )}
          </button>
        </header>

        <main style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 32px' }}>
          <Link to="/" style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: S.muted, textDecoration: 'none', display: 'inline-block', marginBottom: 36 }}>← Back to Shop</Link>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 64, alignItems: 'start' }}>

            {/* Gallery */}
            <div style={{ position: 'sticky', top: 80 }}>
              <div style={{ position: 'relative', overflow: 'hidden', background: S.surface }}>
                {mainImage
                  ? <img src={mainImage} alt={images[activeImage]?.alt ?? product.name} style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover', display: 'block', transition: 'transform .5s' }}
                      onMouseEnter={e => (e.currentTarget as HTMLImageElement).style.transform = 'scale(1.03)'}
                      onMouseLeave={e => (e.currentTarget as HTMLImageElement).style.transform = 'scale(1)'} />
                  : <div style={{ width: '100%', aspectRatio: '3/4', background: S.surface }} />
                }
                {product.compare_at_cents && (
                  <span style={{ position: 'absolute', top: 16, left: 16, background: S.gold, color: S.bg, fontSize: 10, letterSpacing: '0.1em', padding: '3px 10px', fontWeight: 500 }}>SALE</span>
                )}
              </div>
              {images.length > 1 && (
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  {images.map((img, i) => (
                    <button key={i} onClick={() => setActiveImage(i)} style={{ width: 70, height: 88, padding: 0, border: `1px solid ${activeImage === i ? S.gold : S.border}`, background: 'none', cursor: 'pointer', overflow: 'hidden', opacity: activeImage === i ? 1 : 0.5, transition: 'all .2s' }}>
                      <img src={img.url} alt={img.alt} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Info */}
            <div>
              {product.category_name && (
                <Link to={`/category/${product.category_slug}`} style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: S.gold, textDecoration: 'none', display: 'block', marginBottom: 12 }}>
                  {product.category_name}
                </Link>
              )}

              <h1 style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 42, fontWeight: 300, lineHeight: 1.1, marginBottom: 20 }}>{product.name}</h1>

              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 20 }}>
                <span style={{ fontFamily: 'Georgia, serif', fontSize: 28 }}>{fmt(price)}</span>
                {product.compare_at_cents && <span style={{ fontSize: 16, color: S.muted, textDecoration: 'line-through' }}>{fmt(product.compare_at_cents)}</span>}
              </div>

              {product.short_description && (
                <p style={{ fontSize: 14, color: S.muted, lineHeight: 1.8, marginBottom: 28, paddingBottom: 28, borderBottom: `1px solid ${S.border}` }}>{product.short_description}</p>
              )}

              {/* Variant selectors */}
              {optionKeys.map(key => {
                const values = [...new Set(variants.map(v => v.options?.[key]).filter(Boolean))]
                return (
                  <div key={key} style={{ marginBottom: 20 }}>
                    <label style={{ display: 'block', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: S.muted, marginBottom: 10 }}>
                      {key}: <strong style={{ color: S.text }}>{selectedVariant?.options?.[key]}</strong>
                    </label>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {values.map(val => {
                        const match = variants.find(v => v.options?.[key] === val)
                        const isSelected = selectedVariant?.options?.[key] === val
                        const isOos = (match?.stock_qty ?? 0) === 0
                        return (
                          <button key={val} onClick={() => match && !isOos && setSelectedVariant(match)} disabled={isOos}
                            style={{ minWidth: 48, padding: '8px 14px', border: `1px solid ${isSelected ? S.gold : S.border}`, background: 'none', fontSize: 12, cursor: isOos ? 'not-allowed' : 'pointer', color: isSelected ? S.gold : isOos ? '#333' : S.muted, opacity: isOos ? 0.4 : 1, textDecoration: isOos ? 'line-through' : 'none', transition: 'all .2s' }}>
                            {val}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}

              {/* Qty */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
                <span style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: S.muted }}>Qty</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, border: `1px solid ${S.border}`, padding: '5px 12px' }}>
                  <button onClick={() => setQty(q => Math.max(1, q - 1))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: S.muted, fontSize: 18, lineHeight: 1, display: 'flex', alignItems: 'center' }}>−</button>
                  <span style={{ minWidth: 24, textAlign: 'center', fontSize: 14 }}>{qty}</span>
                  <button onClick={() => setQty(q => q + 1)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: S.muted, fontSize: 18, lineHeight: 1, display: 'flex', alignItems: 'center' }}>+</button>
                </div>
              </div>

              {/* Add to cart */}
              <button onClick={handleAddToCart} disabled={!inStock || addingToCart}
                style={{ width: '100%', padding: '15px 0', background: justAdded ? '#27ae60' : S.gold, color: '#0a0a0a', fontSize: 12, letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 500, border: 'none', cursor: !inStock ? 'not-allowed' : 'pointer', opacity: !inStock || addingToCart ? 0.6 : 1, transition: 'all .3s', fontFamily: 'inherit', marginBottom: 28 }}
                aria-live="polite">
                {!inStock ? 'Out of Stock' : addingToCart ? 'Adding…' : justAdded ? 'Added to Cart ✓' : 'Add to Cart'}
              </button>

              {/* Description */}
              {product.description && (
                <div style={{ borderTop: `1px solid ${S.border}`, paddingTop: 24, marginBottom: 20 }}>
                  <p style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: S.muted, marginBottom: 12 }}>Details</p>
                  <p style={{ fontSize: 13, color: S.muted, lineHeight: 1.9 }}>{product.description}</p>
                </div>
              )}

              {/* Tags */}
              {tags.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {tags.map(tag => (
                    <span key={tag} style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#3a3530', border: `1px solid ${S.border}`, padding: '3px 8px' }}>{tag}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* Cart Drawer — always rendered, slides in/out */}
      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        cart={cart}
        onUpdate={handleUpdate}
        onRemove={handleRemove}
        onCheckout={handleCheckout}
        checkingOut={checkingOut}
      />
    </>
  )
}
