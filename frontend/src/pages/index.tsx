/**
 * index.tsx — Homepage
 */
import React, { useEffect, useState } from 'react'
import { Helmet } from 'react-helmet'
import { Link } from 'gatsby'

const API_BASE = process.env.GATSBY_API_URL || ''

interface Product {
  id: string
  slug: string
  name: string
  short_description: string | null
  price_cents: number
  compare_at_cents: number | null
  category_name: string | null
  images: Array<{ url: string; alt?: string }> | string
  is_featured: boolean
}

function fmt(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

function parseImages(raw: any): Array<{ url: string; alt?: string }> {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try { return JSON.parse(raw) } catch { return [] }
}

const S = {
  bg: '#0a0a0a', surface: '#111', border: '#222',
  gold: '#c8a96e', text: '#e8e4dc', muted: '#6a6560',
}

export default function IndexPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('All')
  const [categories, setCategories] = useState<string[]>(['All'])

  useEffect(() => {
    if (!API_BASE) {
      setError('GATSBY_API_URL is not set. Add it to your Cloudflare Pages environment variables.')
      setLoading(false)
      return
    }

    const url = `${API_BASE}/products?limit=100`
    fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(`API returned ${r.status} from ${url}`)
        return r.json()
      })
      .then(data => {
        const prods: Product[] = data.products || []
        if (prods.length === 0) {
          setError(`API responded OK but returned 0 products. Check your Neon database has seed data. (URL: ${url})`)
        }
        setProducts(prods)
        const cats = ['All', ...new Set(prods.map(p => p.category_name).filter(Boolean) as string[])]
        setCategories(cats)
      })
      .catch(err => {
        setError(`Failed to load products: ${err.message} — URL attempted: ${url}`)
      })
      .finally(() => setLoading(false))
  }, [])

  const filtered = filter === 'All' ? products : products.filter(p => p.category_name === filter)

  return (
    <>
      <Helmet>
        <title>Shop — STRATUM</title>
        <meta name="description" content="Precision-crafted apparel and accessories." />
      </Helmet>

      <div style={{ background: S.bg, minHeight: '100vh', color: S.text, fontFamily: "'Courier New', monospace" }}>

        {/* Header */}
        <header style={{ borderBottom: `1px solid ${S.border}`, padding: '0 32px', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: 'rgba(10,10,10,.95)', backdropFilter: 'blur(12px)', zIndex: 10 }}>
          <span style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 22, color: S.gold, letterSpacing: '0.1em' }}>STRATUM</span>
          <nav style={{ display: 'flex', gap: 24 }}>
            <Link to="/" style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: S.text, textDecoration: 'none' }}>Shop</Link>
            <Link to="/admin" style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: S.muted, textDecoration: 'none' }}>Admin</Link>
          </nav>
        </header>

        <main style={{ maxWidth: 1280, margin: '0 auto', padding: '48px 32px' }}>

          {/* Hero */}
          <div style={{ marginBottom: 56, paddingBottom: 48, borderBottom: `1px solid ${S.border}` }}>
            <p style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: S.gold, marginBottom: 12 }}>New Collection — SS26</p>
            <h1 style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 'clamp(2.5rem, 6vw, 5rem)', fontWeight: 300, lineHeight: 1.05, maxWidth: 640, color: S.text }}>
              Precision-crafted apparel for the considered life
            </h1>
          </div>

          {/* Error banner */}
          {error && (
            <div style={{ background: '#1a0a0a', border: '1px solid #c0392b', padding: '16px 20px', marginBottom: 32, fontSize: 12, color: '#e74c3c', lineHeight: 1.7 }}>
              <strong>Error:</strong> {error}
              <br />
              <span style={{ color: S.muted, marginTop: 8, display: 'block' }}>
                Fix: Go to <strong>Cloudflare Pages → jmshop → Settings → Environment Variables</strong> and add:
                <br />
                <code style={{ color: S.gold }}>GATSBY_API_URL = https://bizify.jmi.workers.dev</code>
                <br />
                Then trigger a new deployment.
              </span>
            </div>
          )}

          {/* Category filters */}
          {products.length > 0 && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 36, flexWrap: 'wrap' }}>
              {categories.map(cat => (
                <button key={cat} onClick={() => setFilter(cat)} style={{
                  padding: '7px 18px', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase',
                  border: `1px solid ${filter === cat ? S.gold : S.border}`,
                  background: 'none', color: filter === cat ? S.gold : S.muted,
                  cursor: 'pointer', fontFamily: 'inherit', transition: 'all .2s',
                }}>{cat}</button>
              ))}
            </div>
          )}

          {/* States */}
          {loading && <p style={{ color: S.muted, fontSize: 13 }}>Loading products…</p>}

          {/* Grid */}
          {!loading && !error && filtered.length === 0 && (
            <p style={{ color: S.muted, fontSize: 13 }}>No products found.</p>
          )}

          {!loading && filtered.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 2 }}>
              {filtered.map(product => {
                const imgs = parseImages(product.images)
                const img = imgs[0]?.url
                return (
                  <Link key={product.id} to={`/products/${product.slug}`} style={{ textDecoration: 'none', color: 'inherit', background: S.surface, display: 'block' }}>
                    <div style={{ overflow: 'hidden' }}>
                      {img ? (
                        <img
                          src={img} alt={product.name}
                          style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover', display: 'block', transition: 'transform .5s' }}
                          onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.04)')}
                          onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
                        />
                      ) : (
                        <div style={{ width: '100%', aspectRatio: '3/4', background: '#181818' }} />
                      )}
                    </div>
                    <div style={{ padding: '16px 20px 20px' }}>
                      {product.category_name && (
                        <p style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: S.gold, marginBottom: 6 }}>{product.category_name}</p>
                      )}
                      <h2 style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 20, fontWeight: 300, marginBottom: 6 }}>{product.name}</h2>
                      {product.short_description && (
                        <p style={{ fontSize: 12, color: S.muted, marginBottom: 12, lineHeight: 1.6 }}>{product.short_description}</p>
                      )}
                      <p style={{ fontFamily: 'Georgia, serif', fontSize: 18 }}>
                        {fmt(product.price_cents)}
                        {product.compare_at_cents && (
                          <span style={{ fontSize: 13, color: S.muted, textDecoration: 'line-through', marginLeft: 10 }}>{fmt(product.compare_at_cents)}</span>
                        )}
                        {product.compare_at_cents && (
                          <span style={{ fontSize: 10, background: S.gold, color: '#0a0a0a', padding: '2px 6px', marginLeft: 8, letterSpacing: '0.08em' }}>SALE</span>
                        )}
                      </p>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </main>

        <footer style={{ borderTop: `1px solid ${S.border}`, marginTop: 80 }}>
          <div style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <span style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', color: S.gold }}>STRATUM</span>
            <span style={{ fontSize: 11, color: S.muted }}>© {new Date().getFullYear()} Stratum. All rights reserved.</span>
          </div>
        </footer>
      </div>
    </>
  )
}
