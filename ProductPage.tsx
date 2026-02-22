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
import { Product, Variant } from '../lib/api'
import { useCart } from '../hooks/useCart'
import Layout from '../components/Layout'

interface Props {
  pageContext: { product: Product }
}

function formatPrice(cents: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)
}

export default function ProductPage({ pageContext }: Props) {
  const { product } = pageContext
  const { addItem, loading: cartLoading } = useCart()

  const [selectedVariant, setSelectedVariant] = useState<Variant | null>(
    product.variants?.[0] ?? null
  )
  const [qty, setQty] = useState(1)
  const [activeImage, setActiveImage] = useState(0)
  const [added, setAdded] = useState(false)

  const price = selectedVariant?.price_cents ?? product.price_cents
  const inStock = selectedVariant ? selectedVariant.stock_qty > 0 : true

  const handleAddToCart = useCallback(async () => {
    await addItem(product.id, selectedVariant?.id, qty)
    setAdded(true)
    setTimeout(() => setAdded(false), 2000)
  }, [addItem, product.id, selectedVariant, qty])

  // Group variants by option key (e.g. color, size)
  const optionKeys = product.variants?.length
    ? [...new Set(product.variants.flatMap((v) => Object.keys(v.options)))]
    : []

  const firstImage = product.images?.[activeImage]?.url ?? '/images/placeholder.jpg'
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description,
    image: product.images?.map((i) => i.url),
    offers: {
      '@type': 'Offer',
      priceCurrency: product.currency,
      price: (price / 100).toFixed(2),
      availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    },
  }

  return (
    <Layout>
      <Helmet>
        <title>{product.name} — STRATUM</title>
        <meta name="description" content={product.short_description ?? product.description ?? ''} />
        <meta property="og:title" content={product.name} />
        <meta property="og:description" content={product.short_description ?? ''} />
        {firstImage && <meta property="og:image" content={firstImage} />}
        <script type="application/ld+json">{JSON.stringify(structuredData)}</script>
      </Helmet>

      <article className="product-page">
        {/* ── Image gallery ── */}
        <div className="product-gallery">
          <div className="product-main-image">
            <img src={firstImage} alt={product.images?.[activeImage]?.alt ?? product.name} />
            {product.compare_at_cents && (
              <span className="sale-badge">SALE</span>
            )}
          </div>

          {product.images?.length > 1 && (
            <div className="product-thumbnails">
              {product.images.map((img, i) => (
                <button
                  key={i}
                  className={`thumb ${activeImage === i ? 'active' : ''}`}
                  onClick={() => setActiveImage(i)}
                  aria-label={`View image ${i + 1}`}
                >
                  <img src={img.url} alt={img.alt} />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Product info ── */}
        <div className="product-info">
          {product.category_name && (
            <Link to={`/category/${product.category_slug}`} className="product-category">
              {product.category_name}
            </Link>
          )}

          <h1 className="product-name">{product.name}</h1>

          <div className="product-pricing">
            <span className="price-current">{formatPrice(price)}</span>
            {product.compare_at_cents && (
              <span className="price-was">{formatPrice(product.compare_at_cents)}</span>
            )}
          </div>

          {product.short_description && (
            <p className="product-tagline">{product.short_description}</p>
          )}

          {/* ── Variant selectors ── */}
          {optionKeys.map((key) => {
            const values = [...new Set(product.variants?.map((v) => v.options[key]).filter(Boolean))]
            return (
              <div key={key} className="variant-group">
                <label className="variant-label">
                  {key}: <strong>{selectedVariant?.options[key]}</strong>
                </label>
                <div className="variant-options">
                  {values.map((val) => {
                    const match = product.variants?.find((v) => v.options[key] === val)
                    const isSelected = selectedVariant?.options[key] === val
                    return (
                      <button
                        key={val}
                        className={`variant-btn ${isSelected ? 'selected' : ''} ${match?.stock_qty === 0 ? 'oos' : ''}`}
                        onClick={() => match && setSelectedVariant(match)}
                        disabled={match?.stock_qty === 0}
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

          {/* ── Quantity ── */}
          <div className="qty-row">
            <label className="variant-label">Quantity</label>
            <div className="qty-control">
              <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease">−</button>
              <span>{qty}</span>
              <button onClick={() => setQty((q) => q + 1)} aria-label="Increase">+</button>
            </div>
          </div>

          {/* ── Add to cart ── */}
          <button
            className={`btn-atc ${added ? 'added' : ''}`}
            onClick={handleAddToCart}
            disabled={!inStock || cartLoading}
            aria-live="polite"
          >
            {!inStock ? 'Out of Stock' : added ? 'Added ✓' : cartLoading ? 'Adding…' : 'Add to Cart'}
          </button>

          {/* ── Description ── */}
          {product.description && (
            <div className="product-description">
              <h3>Details</h3>
              <p>{product.description}</p>
            </div>
          )}

          {/* ── Tags ── */}
          {product.tags?.length > 0 && (
            <div className="product-tags">
              {product.tags.map((tag) => (
                <span key={tag} className="tag">{tag}</span>
              ))}
            </div>
          )}
        </div>
      </article>
    </Layout>
  )
}
