/**
 * Layout.tsx — wraps every page with nav + cart drawer
 */
import React, { useState } from 'react'
import { Link } from 'gatsby'
import { Helmet } from 'react-helmet'
import { AuthProvider } from '../hooks/useAuth'
import { CartProvider, useCart } from '../hooks/useCart'
import CartDrawer from './CartDrawer'
import '../styles/global.css'

function NavBar() {
  const [cartOpen, setCartOpen] = useState(false)
  const { cart } = useCart()

  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <Link to="/" className="site-logo">STRATUM</Link>

          <nav className="site-nav" aria-label="Main navigation">
            <Link to="/products" activeClassName="active">Shop</Link>
            <Link to="/category/apparel" activeClassName="active">Apparel</Link>
            <Link to="/category/accessories" activeClassName="active">Accessories</Link>
            <Link to="/category/footwear" activeClassName="active">Footwear</Link>
          </nav>

          <div className="header-actions">
            <Link to="/account" className="nav-icon" aria-label="Account">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            </Link>

            <button
              className="nav-icon cart-trigger"
              onClick={() => setCartOpen(true)}
              aria-label={`Cart (${cart.item_count} items)`}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
                <line x1="3" y1="6" x2="21" y2="6"/>
                <path d="M16 10a4 4 0 0 1-8 0"/>
              </svg>
              {cart.item_count > 0 && (
                <span className="cart-badge">{cart.item_count}</span>
              )}
            </button>
          </div>
        </div>
      </header>

      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />
    </>
  )
}

interface Props {
  children: React.ReactNode
  title?: string
  description?: string
}

export default function Layout({ children, title, description }: Props) {
  return (
    <AuthProvider>
      <CartProvider>
        <Helmet>
          {title && <title>{title} — STRATUM</title>}
          {description && <meta name="description" content={description} />}
        </Helmet>

        <NavBar />

        <main className="site-main">
          {children}
        </main>

        <footer className="site-footer">
          <div className="footer-inner">
            <p className="footer-brand">STRATUM</p>
            <nav className="footer-nav" aria-label="Footer navigation">
              <Link to="/about">About</Link>
              <Link to="/shipping">Shipping</Link>
              <Link to="/returns">Returns</Link>
              <Link to="/privacy">Privacy</Link>
            </nav>
            <p className="footer-copy">© {new Date().getFullYear()} Stratum. All rights reserved.</p>
          </div>
        </footer>
      </CartProvider>
    </AuthProvider>
  )
}
