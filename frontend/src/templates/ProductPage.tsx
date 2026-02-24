/**
 * ProductPage.tsx — Static Gatsby template
 *
 * Rendered at BUILD TIME from gatsby-node.js context.
 * The product data comes from the API during build — no client fetch needed.
 * Add-to-cart is a client-side action via CartContext.
 */

import React, { useState, useCallback } from 'react'
import { Helmet } from 'react-helmet'
import { Link } from 'gatsby'

// ── Types ──────────────────────────────────────────────────────────────────────
interface ProductImage {
  url: string
  alt?: string
}

interface Variant {
  id: string
  name: string
  options: Record<string, string>
  price_cents: number | null
  sku: string
  stock_qty: number
}

interface Product {
  id: string
  slug: string
  name: string
  description: string | null
  short_description: string | null
  price_cents: number
  compare_at_cents: number | null
  currency: string
  images: ProductImage[] | string   // Postgres JSONB may arrive as string
  tags: string[]
  is_featured: boolean
  category_name: string | null
  category_slug: string | null
  variants: Variant[]
}

interface Props {
  pageContext: { product: Product }
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function formatPrice(cents: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)
}

/** Safely parse images whether they arrive as array or JSON string */
function parseImages(raw: ProductImage[] | string): ProductImage[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try { return JSON.parse(raw) } catch { return [] }
}

// ── Cart hook (browser-only, safe during SSR) ──────────────────────────────────
function useClientCart() {
  const [loading, setLoading] = useState(false)
  const [added, setAdded] = useState(false)

  const addItem = useCallback(async (productId: string, variantId?: string, qty = 1) => {
    if (typeof window === 'undefined') return
    setLoading(true)
    try {
      const apiBase = process.env.GATSBY_API_URL || ''
      const token = localStorage.getItem('auth_token')
      const cartToken = localStorage.getItem('cart_token')

      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`
      if (cartToken) headers['X-Cart-Token'] = cartToken

      const res = await fetch(`${apiBase}/cart/items`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ product_id: productId, variant_id: variantId, quantity: qty }),
      })

      const newCartToken = res.headers.get('X-Cart-Token')
      if (newCartToken) localStorage.setItem('cart_token', newCartToken)

      if (res.ok) {
        setAdded(true)
        setTimeout(() => setAdded(false), 2000)
        // Notify other components (e.g. nav cart count) via a custom event
        window.dispatchEvent(new Event('cart-updated'))
      }
    } catch (err) {
      console.error('Failed to add item to cart', err)
    } finally {
      setLoading(false)
    }
  }, [])

  return { addItem, loading, added }
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function ProductPage({ pageContext }: Props) {
  const { product } = pageContext
  const { addItem, loading: cartLoading, added } = useClientCart()

  const images = parseImages(product.images)
  const tags = Array.isArray(product.tags) ? product.tags : []
  const variants: Variant[] = Array.isArray(product.variants) ? product.variants : []

  const [selectedVariant, setSelectedVariant] = useState<Variant | null>(
    variants.find(v => v.stock_qty > 0) ?? variants[0] ?? null
  )
  const [qty, setQty] = useState(1)
  const [activeImage, setActiveImage] = useState(0)

  const price = selectedVariant?.price_cents ?? product.price_cents
  const inStock = selectedVariant ? selectedVariant.stock_qty > 0 : true
  const mainImage = images[activeImage]?.url ?? ''

  // Group variant option keys (e.g. "color", "size")
  const optionKeys = variants.length
    ? [...new Set(variants.flatMap(v => Object.keys(v.options ?? {})))]
    : []

  const handleAddToCart = useCallback(() => {
    addItem(product.id, selectedVariant?.id, qty)
  }, [addItem, product.id, selectedVariant, qty])

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description ?? '',
    image: images.map(i => i.url),
    offers: {
      '@type': 'Offer',
      priceCurrency: product.currency ?? 'USD',
      price: (price / 100).toFixed(2),
      availability: inStock
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
    },
  }

  return (
    <>
      <Helmet>
        <title>{product.name} — Store</title>
        <meta name="description" content={product.short_description ?? product.description ?? ''} />
        <meta property="og:title" content={product.name} />
        {mainImage && <meta property="og:image" content={mainImage} />}
        <script type="application/ld+json">{JSON.stringify(structuredData)}</script>
      </Helmet>

      <article style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 24px' }}>
        <Link to="/products" style={{ fontSize: 12, color: '#888', textDecoration: 'none', display: 'block', marginBottom: 32 }}>
          ← Back to products
        </Link>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 64, alignItems: 'start' }}>

          {/* ── Gallery ── */}
          <div>
            {mainImage ? (
              <img
                src={mainImage}
                alt={images[activeImage]?.alt ?? product.name}
                style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover', display: 'block', background: '#111' }}
              />
            ) : (
              <div style={{ width: '100%', aspectRatio: '3/4', background: '#111' }} />
            )}

            {images.length > 1 && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                {images.map((img, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveImage(i)}
                    style={{ width: 72, height: 90, padding: 0, border: `1px solid ${activeImage === i ? '#c8a96e' : '#333'}`, background: 'none', cursor: 'pointer', overflow: 'hidden' }}
                    aria-label={`View image ${i + 1}`}
                  >
                    <img src={img.url} alt={img.alt} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Info ── */}
          <div>
            {product.category_name && (
              <Link to={`/category/${product.category_slug}`} style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#c8a96e', textDecoration: 'none', display: 'block', marginBottom: 12 }}>
                {product.category_name}
              </Link>
            )}

            <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 42, fontWeight: 300, fontStyle: 'italic', lineHeight: 1.1, marginBottom: 16 }}>
              {product.name}
            </h1>

            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 20 }}>
              <span style={{ fontFamily: 'Georgia, serif', fontSize: 28 }}>{formatPrice(price)}</span>
              {product.compare_at_cents && (
                <span style={{ fontSize: 16, color: '#666', textDecoration: 'line-through' }}>
                  {formatPrice(product.compare_at_cents)}
                </span>
              )}
            </div>

            {product.short_description && (
              <p style={{ fontSize: 14, color: '#888', lineHeight: 1.8, marginBottom: 28, paddingBottom: 28, borderBottom: '1px solid #222' }}>
                {product.short_description}
              </p>
            )}

            {/* Variant selectors */}
            {optionKeys.map(key => {
              const values = [...new Set(variants.map(v => v.options?.[key]).filter(Boolean))]
              return (
                <div key={key} style={{ marginBottom: 20 }}>
                  <label style={{ display: 'block', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#666', marginBottom: 10 }}>
                    {key}: <strong style={{ color: '#e8e4dc' }}>{selectedVariant?.options?.[key]}</strong>
                  </label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {values.map(val => {
                      const match = variants.find(v => v.options?.[key] === val)
                      const isSelected = selectedVariant?.options?.[key] === val
                      const isOos = (match?.stock_qty ?? 0) === 0
                      return (
                        <button
                          key={val}
                          onClick={() => match && !isOos && setSelectedVariant(match)}
                          disabled={isOos}
                          style={{
                            minWidth: 48, padding: '8px 14px',
                            border: `1px solid ${isSelected ? '#c8a96e' : '#333'}`,
                            background: 'none', fontSize: 12, cursor: isOos ? 'not-allowed' : 'pointer',
                            color: isSelected ? '#c8a96e' : isOos ? '#444' : '#888',
                            opacity: isOos ? 0.4 : 1,
                            textDecoration: isOos ? 'line-through' : 'none',
                          }}
                          aria-pressed={isSelected}
                        >
                          {val}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}

            {/* Quantity */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
              <span style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#666' }}>Qty</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, border: '1px solid #333', padding: '4px 10px' }}>
                <button onClick={() => setQty(q => Math.max(1, q - 1))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: 18, lineHeight: 1 }}>−</button>
                <span style={{ minWidth: 24, textAlign: 'center', fontSize: 13 }}>{qty}</span>
                <button onClick={() => setQty(q => q + 1)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: 18, lineHeight: 1 }}>+</button>
              </div>
            </div>

            {/* Add to cart */}
            <button
              onClick={handleAddToCart}
              disabled={!inStock || cartLoading}
              style={{
                width: '100%', padding: '14px 0',
                background: added ? '#27ae60' : '#c8a96e',
                color: '#0a0a0a', fontSize: 12, letterSpacing: '0.15em',
                textTransform: 'uppercase', fontWeight: 500, border: 'none',
                cursor: !inStock ? 'not-allowed' : 'pointer',
                opacity: !inStock || cartLoading ? 0.6 : 1,
                transition: 'background 0.3s', fontFamily: 'monospace',
                marginBottom: 28,
              }}
              aria-live="polite"
            >
              {!inStock ? 'Out of Stock' : added ? 'Added to Cart ✓' : cartLoading ? 'Adding…' : 'Add to Cart'}
            </button>

            {/* Description */}
            {product.description && (
              <div style={{ borderTop: '1px solid #222', paddingTop: 24 }}>
                <p style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#666', marginBottom: 12 }}>Details</p>
                <p style={{ fontSize: 13, color: '#888', lineHeight: 1.9 }}>{product.description}</p>
              </div>
            )}

            {/* Tags */}
            {tags.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 20 }}>
                {tags.map(tag => (
                  <span key={tag} style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#444', border: '1px solid #2a2a2a', padding: '3px 8px' }}>
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </article>
    </>
  )
}
